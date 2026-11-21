import { createHash } from "node:crypto";
import { validateImage, type ImageLimits, DEFAULT_IMAGE_LIMITS } from "@franzebi/domain";
import type { CatalogRecord, CatalogSource, CatalogStore, ImageFetcher, SyncStats, ValidatedImage } from "./types.js";

/**
 * Motor de sincronización idempotente.
 *  - Clave: SKU normalizado (trim + upper). Nunca se crea una ficha sin SKU de origen.
 *  - Hash de contenido: si no cambió, no se escribe nada (idempotente / re-ejecutable).
 *  - Dry-run: calcula el plan completo y registra errores, pero no persiste productos.
 *  - Un error en un ítem (p.ej. imagen inválida) NUNCA aborta el job: se registra con stage/código/payload resumido.
 *  - Imagen inválida: el producto se publica con placeholder controlado SOLO si `placeholderOnImageError`;
 *    si no, se omite la actualización de imágenes y queda el error visible con reintento.
 *  - Productos que desaparecen del origen NO se borran: se cuentan en `missingInSource` para revisión humana.
 */

export interface SyncOptions {
  dryRun: boolean;
  trigger: string; // "cron" | "manual:<userId>" | "retry:<jobId>"
  placeholderOnImageError: boolean;
  imageLimits?: ImageLimits;
  maxPages?: number;
  /** Escrituras en paralelo (default 8). */
  concurrency?: number;
  onlySkus?: string[]; // reintentos puntuales
}

export const normalizeSku = (s: string) => s.trim().toUpperCase();

export function contentHash(r: CatalogRecord): string {
  const stable = {
    sku: normalizeSku(r.sku),
    name: r.name,
    retail: r.retailPriceCents,
    wholesale: r.wholesalePriceCents,
    stock: r.stock,
    cat: r.categoryPath,
    img: r.imageUrls,
    active: r.active,
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

export interface SyncPlanEntry {
  sku: string;
  action: "create" | "update" | "unchanged" | "skip";
  reason?: string;
}

export async function runCatalogSync(
  source: CatalogSource,
  store: CatalogStore,
  images: ImageFetcher,
  opts: SyncOptions,
): Promise<{ jobId: string; stats: SyncStats; plan: SyncPlanEntry[] }> {
  const stats: SyncStats = { seen: 0, created: 0, updated: 0, unchanged: 0, skipped: 0, errors: 0, imageErrors: 0, placeholders: 0, missingInSource: 0 };
  const plan: SyncPlanEntry[] = [];
  const jobId = await store.startJob({ source: source.name, dryRun: opts.dryRun, trigger: opts.trigger });
  const only = opts.onlySkus ? new Set(opts.onlySkus.map(normalizeSku)) : null;

  // 1) Leer todo el origen (el catálogo es chico: ~2k ítems) para detectar SKUs duplicados antes de escribir.
  const all: CatalogRecord[] = [];
  let cursor: string | null = null;
  let pages = 0;
  try {
    do {
      const page = await source.fetchPage(cursor);
      for (const r of page.rejects) {
        stats.errors++;
        await store.recordError(jobId, { stage: "normalize", sourceId: r.sourceId, sku: r.sku, code: r.code, message: r.message, retryable: false, payloadSummary: r.payload });
      }
      all.push(...page.records);
      cursor = page.next;
      pages++;
    } while (cursor && pages < (opts.maxPages ?? 1000));
  } catch (e) {
    stats.errors++;
    await store.recordError(jobId, { stage: "source", code: "source_unavailable", message: (e as Error).message, retryable: true });
    await store.finishJob(jobId, { status: "failed", stats, summary: { pages } });
    return { jobId, stats, plan };
  }

  const bySku = new Map<string, CatalogRecord[]>();
  for (const r of all) {
    const k = normalizeSku(r.sku);
    if (only && !only.has(k)) continue;
    bySku.set(k, [...(bySku.get(k) ?? []), r]);
  }

  const states = await store.getStates([...bySku.keys()]);
  const work: Array<() => Promise<void>> = [];

  for (const [sku, recs] of bySku) {
    stats.seen++;
    if (recs.length > 1) {
      stats.skipped++;
      stats.errors++;
      plan.push({ sku, action: "skip", reason: "duplicate_sku_in_source" });
      await store.recordError(jobId, {
        stage: "validate", sku, code: "duplicate_sku_in_source", retryable: false,
        message: `SKU repetido en Alegra (${recs.length} ítems: ${recs.map((r) => r.sourceId).join(", ")}). No se publica hasta resolverlo en origen.`,
      });
      continue;
    }
    const rec = { ...recs[0]!, sku };
    if (!rec.name) {
      stats.skipped++; stats.errors++;
      plan.push({ sku, action: "skip", reason: "missing_name" });
      await store.recordError(jobId, { stage: "validate", sku, code: "missing_name", message: "Ítem sin nombre", retryable: false });
      continue;
    }
    if (rec.retailPriceCents == null && rec.active) {
      // Se registra pero no se bloquea: la ficha puede existir "a pedido"/sin precio (diseñador). La regla de venta se decide en la tienda.
      await store.recordError(jobId, { stage: "validate", sku, code: "missing_retail_price", message: "Sin precio ARS en la lista minorista", retryable: false });
    }

    const hash = contentHash(rec);
    const prev = states.get(sku);
    if (prev && prev.contentHash === hash) {
      stats.unchanged++;
      plan.push({ sku, action: "unchanged" });
      continue;
    }

    work.push(async () => {
      // Imágenes: validar antes de procesar
      const valid: ValidatedImage[] = [];
      let imageFailed = false;
      for (const url of rec.imageUrls) {
        try {
          const res = await images.fetch(url);
          if (res.status < 200 || res.status >= 300) throw Object.assign(new Error(`HTTP ${res.status} al descargar imagen`), { code: "image_http_error" });
          const v = validateImage(res.bytes, res.contentType, opts.imageLimits ?? DEFAULT_IMAGE_LIMITS);
          if (!v.ok) throw Object.assign(new Error(v.message), { code: `image_${v.code}` });
          valid.push({ sourceUrl: url, sha256: createHash("sha256").update(res.bytes).digest("hex"), mime: v.mime, width: v.width, height: v.height, bytes: res.bytes });
        } catch (e) {
          imageFailed = true;
          stats.imageErrors++;
          stats.errors++;
          await store.recordError(jobId, {
            stage: "image", sku, code: (e as { code?: string }).code ?? "image_fetch_failed", message: `${rec.name}: ${(e as Error).message}`,
            retryable: true, payloadSummary: { url: url.slice(0, 300) },
          });
        }
      }
      // Placeholder sólo si el origen trajo imágenes y TODAS fallaron. Si el origen no trae imágenes (Alegra hoy),
      // `valid` queda vacío y el store conserva las fotos existentes (migradas de Woo o cargadas en el admin).
      const usePlaceholder = imageFailed && valid.length === 0 && opts.placeholderOnImageError;
      if (usePlaceholder) stats.placeholders++;

      const action = prev ? "update" : "create";
      plan.push({ sku, action, reason: imageFailed ? "with_image_errors" : undefined });
      if (opts.dryRun) {
        action === "create" ? stats.created++ : stats.updated++;
        return;
      }
      try {
        // Si hubo errores de imagen se guarda un hash "pendiente" para que la próxima corrida reintente sola.
        const r = await store.upsertProduct(rec, imageFailed ? `${hash}:image-retry` : hash, valid, usePlaceholder);
        r.created ? stats.created++ : stats.updated++;
      } catch (e) {
        stats.errors++;
        await store.recordError(jobId, { stage: "persist", sku, code: "persist_failed", message: (e as Error).message, retryable: true });
      }

    });
  }

  // Escritura con concurrencia limitada (cada SKU es independiente): ~8x más rápido que en serie.
  const queue = [...work];
  const lanes = Math.max(1, opts.concurrency ?? 8);
  await Promise.all(Array.from({ length: Math.min(lanes, queue.length) }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) await job();
  }));

  if (!only) {
    const known = await store.listAllSkus();
    stats.missingInSource = known.filter((s) => !bySku.has(normalizeSku(s))).length;
  }

  const status = stats.errors === 0 ? "succeeded" : stats.created + stats.updated + stats.unchanged > 0 ? "partial" : "failed";
  await store.finishJob(jobId, { status, stats, summary: { pages, dryRun: opts.dryRun, planSample: plan.filter((p) => p.action !== "unchanged").slice(0, 50) } });
  return { jobId, stats, plan };
}
