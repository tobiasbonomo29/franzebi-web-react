import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogRecord, CatalogStore, StoredProductState, SyncErrorInput, SyncStats, ValidatedImage } from "./types.js";

/**
 * Persistencia en Supabase. Usa el cliente con SERVICE ROLE (sólo servidor/jobs; nunca en el browser).
 * - upsert por SKU (unique) => idempotente.
 * - No pisa overrides manuales: sale_mode si sale_mode_locked, SEO, descripción, slug existente.
 * - Imágenes válidas se suben a Storage con nombre por sha256 (dedupe natural).
 */
export class SupabaseCatalogStore implements CatalogStore {
  constructor(private db: SupabaseClient, private opts: { bucket?: string; resolveCategory?: (path: string[]) => Promise<string | null> } = {}) {}

  private reservations: Map<string, number> | null = null;
  private priceLists: Array<{ id: string; code: string }> | null = null;
  /** Unidades vendidas en la web que Alegra todavía no descontó (pedido sin facturar). Se cargan una vez por corrida. */
  private async reserved(sku: string) {
    if (!this.reservations) {
      const r = await this.db.rpc("pending_stock_reservations");
      this.reservations = new Map(((r.data ?? []) as Array<{ sku: string; quantity: number }>).map((x) => [x.sku, Number(x.quantity)]));
    }
    return this.reservations.get(sku) ?? 0;
  }

  private must<T>(r: { data: T; error: { message: string } | null }, ctx: string): T {
    if (r.error) throw new Error(`${ctx}: ${r.error.message}`);
    return r.data;
  }

  async startJob(input: { source: string; dryRun: boolean; trigger: string }) {
    const r = await this.db.from("sync_jobs").insert({ source: input.source, dry_run: input.dryRun, trigger: input.trigger }).select("id").single();
    const row = this.must(r, "startJob") as { id: string } | null;
    if (!row) throw new Error("startJob: sin id");
    return row.id;
  }

  async finishJob(jobId: string, res: { status: string; stats: SyncStats; summary: unknown }) {
    this.must(await this.db.from("sync_jobs").update({ status: res.status, stats: res.stats, summary: res.summary, finished_at: new Date().toISOString() }).eq("id", jobId), "finishJob");
  }

  async getStates(skus: string[]) {
    const out = new Map<string, StoredProductState>();
    for (let i = 0; i < skus.length; i += 100) { // lotes chicos: SKUs largos en ?sku=in.(...) superan el límite de URL
      const r = await this.db.from("products").select("id, sku, content_hash, product_images(sha256)").in("sku", skus.slice(i, i + 100));
      for (const p of this.must(r, "getStates") as Array<{ id: string; sku: string; content_hash: string | null; product_images: Array<{ sha256: string | null }> }>) {
        out.set(p.sku, { productId: p.id, sku: p.sku, contentHash: p.content_hash ?? "", imageHashes: p.product_images.map((x) => x.sha256 ?? "") });
      }
    }
    return out;
  }

  async upsertProduct(rec: CatalogRecord, contentHash: string, images: ValidatedImage[], usePlaceholder: boolean) {
    const existing = this.must(await this.db.from("products").select("id, slug, sale_mode_locked, legacy_woo_id, primary_category_id").eq("sku", rec.sku).maybeSingle(), "lookup") as
      | { id: string; slug: string; sale_mode_locked: boolean; legacy_woo_id: number | null; primary_category_id: string | null }
      | null;
    const categoryId = this.opts.resolveCategory ? await this.opts.resolveCategory(rec.categoryPath) : null;
    // Ficha curada (importada de Woo): el contenido (nombre, categoría, slug) lo manda la ficha; Alegra manda precio, stock y estado.
    const curated = existing?.legacy_woo_id != null;
    const row: Record<string, unknown> = {
      sku: rec.sku,
      ...(curated ? {} : { name: rec.name }),
      status: rec.active ? "active" : "inactive",
      stock_qty: Math.max(0, rec.stock - (await this.reserved(rec.sku))),
      source: "alegra",
      source_id: rec.sourceId,
      content_hash: contentHash,
      last_synced_at: new Date().toISOString(),
      missing_in_source_since: null,
      ...(images.length || usePlaceholder ? { has_placeholder_image: usePlaceholder } : {}), // sin imágenes del origen: no se toca
    };
    if (categoryId && !curated && !existing?.primary_category_id) row.primary_category_id = categoryId;
    if (!existing) {
      const base = slugify(rec.name) || rec.sku.toLowerCase();
      const taken = this.must(await this.db.from("products").select("id").eq("slug", base).maybeSingle(), "slug") as { id: string } | null;
      row.slug = taken ? `${base}-${slugify(rec.sku)}`.slice(0, 160) : base;
    }
    // Existente => UPDATE (un INSERT .. ON CONFLICT exigiría las columnas NOT NULL que la ficha curada no manda)
    const up = existing
      ? (this.must(await this.db.from("products").update(row).eq("id", existing.id).select("id").single(), "update") as { id: string })
      : await this.insertWithUniqueSlug(row, rec.sku);

    // precios (sólo listas ARS conocidas; null => se elimina el precio de esa lista, nunca se inventa)
    this.priceLists ??= this.must(await this.db.from("price_lists").select("id, code"), "price_lists") as Array<{ id: string; code: string }>;
    const lists = this.priceLists;
    for (const l of lists) {
      const cents = l.code === "retail" ? rec.retailPriceCents : rec.wholesalePriceCents;
      if (cents && cents > 0) {
        this.must(await this.db.from("product_prices").upsert({ product_id: up.id, price_list_id: l.id, amount_cents: cents, synced_at: new Date().toISOString() }), "price");
      } else {
        this.must(await this.db.from("product_prices").delete().eq("product_id", up.id).eq("price_list_id", l.id), "price-del");
      }
    }
    this.must(await this.db.from("inventory_snapshots").insert({ product_id: up.id, sku: rec.sku, stock_qty: rec.stock, source: "alegra" }), "inventory");

    if (images.length) {
      const bucket = this.opts.bucket ?? "product-images";
      for (const [i, img] of images.entries()) {
        const ext = img.mime === "image/png" ? "png" : img.mime === "image/webp" ? "webp" : "jpg";
        const path = `${rec.sku}/${img.sha256.slice(0, 16)}.${ext}`;
        const upl = await this.db.storage.from(bucket).upload(path, img.bytes, { contentType: img.mime, upsert: true });
        if (upl.error) throw new Error(`storage: ${upl.error.message}`);
        this.must(await this.db.from("product_images").upsert(
          { product_id: up.id, position: i, storage_path: path, source_url: img.sourceUrl, sha256: img.sha256, mime: img.mime, width: img.width, height: img.height, bytes: img.bytes.length, status: "ok", error_code: null, error_message: null },
          { onConflict: "product_id,position" },
        ), "image");
      }
    } else if (usePlaceholder) {
      // Nunca pisar una foto buena: el placeholder sólo se inserta si el producto no tiene ninguna imagen válida.
      const { count } = await this.db.from("product_images").select("id", { count: "exact", head: true }).eq("product_id", up.id).eq("status", "ok");
      if (!count) {
        this.must(await this.db.from("product_images").upsert({ product_id: up.id, position: 0, status: "placeholder" }, { onConflict: "product_id,position" }), "placeholder");
      }
    }
    return { productId: up.id, created: !existing };
  }

  /** Alta con slug único: si dos altas concurrentes chocan por slug, reintenta con el SKU como sufijo. */
  private async insertWithUniqueSlug(row: Record<string, unknown>, sku: string): Promise<{ id: string }> {
    const r = await this.db.from("products").insert(row).select("id").single();
    if (r.error?.code === "23505" && /slug/.test(r.error.message)) {
      return this.must(await this.db.from("products").insert({ ...row, slug: `${row.slug}-${slugify(sku)}`.slice(0, 160) }).select("id").single(), "insert") as { id: string };
    }
    return this.must(r, "insert") as { id: string };
  }

  async recordError(jobId: string, e: SyncErrorInput) {
    this.must(await this.db.from("sync_errors").insert({
      job_id: jobId, sku: e.sku ?? null, source_id: e.sourceId ?? null, stage: e.stage, code: e.code,
      message: e.message.slice(0, 2000), retryable: e.retryable, payload_summary: e.payloadSummary ?? null,
    }), "recordError");
  }

  async listAllSkus() {
    const all: string[] = [];
    for (let from = 0; ; from += 1000) {
      const r = await this.db.from("products").select("sku").eq("source", "alegra").range(from, from + 999);
      const rows = this.must(r, "listAllSkus") as Array<{ sku: string }>;
      all.push(...rows.map((x) => x.sku));
      if (rows.length < 1000) break;
    }
    return all;
  }
}

export function slugify(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " y ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
}
