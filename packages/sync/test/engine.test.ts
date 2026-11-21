import { describe, expect, it } from "vitest";
import { MemoryCatalogStore, runCatalogSync, type CatalogRecord, type CatalogSource, type ImageFetcher } from "../src/index.js";

function png(w = 800, h = 800) {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
}

const rec = (sku: string, o: Partial<CatalogRecord> = {}): CatalogRecord => ({
  sku, sourceId: sku, name: `Producto ${sku}`, retailPriceCents: 1000000, wholesalePriceCents: 800000, stock: 3,
  categoryPath: ["Perfumería"], imageUrls: [`https://img/${sku}.png`], active: true, ...o,
});

const sourceOf = (pages: CatalogRecord[][]): CatalogSource => ({
  name: "test",
  async fetchPage(cursor) {
    const i = Number(cursor ?? 0);
    return { records: pages[i] ?? [], rejects: i === 0 ? [{ sourceId: "99", code: "missing_sku", message: "sin SKU" }] : [], next: i + 1 < pages.length ? String(i + 1) : null };
  },
});

const images = (bad: Set<string> = new Set()): ImageFetcher => ({
  async fetch(url) {
    if (bad.has(url)) return { bytes: new TextEncoder().encode("<html>not an image</html>"), contentType: "image/jpeg", status: 200 };
    return { bytes: png(), contentType: "image/png", status: 200 };
  },
});

describe("sync de catálogo", () => {
  it("dry-run no escribe productos pero registra job, plan y errores", async () => {
    const store = new MemoryCatalogStore();
    const r = await runCatalogSync(sourceOf([[rec("A"), rec("B")]]), store, images(), { dryRun: true, trigger: "test", placeholderOnImageError: true });
    expect(store.writes).toBe(0);
    expect(r.stats.created).toBe(2);
    expect(store.errors.map((e) => e.code)).toEqual(["missing_sku"]);
    expect(store.jobs.get(r.jobId)?.status).toBe("partial");
  });

  it("idempotente: segunda corrida sin cambios no escribe", async () => {
    const store = new MemoryCatalogStore();
    const src = sourceOf([[rec("A")], [rec("B")]]);
    await runCatalogSync(src, store, images(), { dryRun: false, trigger: "t", placeholderOnImageError: true });
    const w = store.writes;
    const r2 = await runCatalogSync(src, store, images(), { dryRun: false, trigger: "t", placeholderOnImageError: true });
    expect(store.writes).toBe(w);
    expect(r2.stats.unchanged).toBe(2);
  });

  it("SKU con espacios/minúsculas no genera duplicado", async () => {
    const store = new MemoryCatalogStore();
    await runCatalogSync(sourceOf([[rec("per_arb_x ")]]), store, images(), { dryRun: false, trigger: "t", placeholderOnImageError: true });
    await runCatalogSync(sourceOf([[rec("PER_ARB_X")]]), store, images(), { dryRun: false, trigger: "t", placeholderOnImageError: true });
    expect([...store.products.keys()]).toEqual(["PER_ARB_X"]);
  });

  it("SKU repetido en origen: no se publica ninguno y queda error claro", async () => {
    const store = new MemoryCatalogStore();
    const r = await runCatalogSync(sourceOf([[rec("DUP", { sourceId: "1" }), rec("dup", { sourceId: "2" })]]), store, images(), { dryRun: false, trigger: "t", placeholderOnImageError: true });
    expect(store.products.size).toBe(0);
    expect(r.plan[0]).toMatchObject({ action: "skip", reason: "duplicate_sku_in_source" });
  });

  it("caso RIFFS FREEZE: imagen inválida no tumba el job; placeholder + error reintentable; se reintenta sola", async () => {
    const store = new MemoryCatalogStore();
    const riffs = rec("RIFFS_FREEZE_100ML", { name: "RIFFS FREEZE 100ML" });
    const bad = new Set(riffs.imageUrls);
    const r = await runCatalogSync(sourceOf([[riffs, rec("OK")]]), store, images(bad), { dryRun: false, trigger: "t", placeholderOnImageError: true });
    expect(store.products.get("RIFFS_FREEZE_100ML")?.placeholder).toBe(true);
    expect(store.products.get("OK")?.placeholder).toBe(false);
    const err = store.errors.find((e) => e.stage === "image")!;
    expect(err).toMatchObject({ sku: "RIFFS_FREEZE_100ML", code: "image_unsupported_format", retryable: true });
    expect(r.stats).toMatchObject({ created: 2, imageErrors: 1, placeholders: 1 });

    // la imagen se corrige en origen => próxima corrida la reintenta y quita placeholder
    const r2 = await runCatalogSync(sourceOf([[riffs, rec("OK")]]), store, images(), { dryRun: false, trigger: "t", placeholderOnImageError: true });
    expect(r2.stats.updated).toBe(1);
    expect(store.products.get("RIFFS_FREEZE_100ML")?.placeholder).toBe(false);
  });

  it("origen sin imágenes (Alegra) no pisa fotos existentes ni pone placeholder", async () => {
    const store = new MemoryCatalogStore();
    await runCatalogSync(sourceOf([[rec("A")]]), store, images(), { dryRun: false, trigger: "t", placeholderOnImageError: true });
    const before = store.products.get("A")!.state.imageHashes;
    expect(before).toHaveLength(1);
    const r = await runCatalogSync(sourceOf([[rec("A", { imageUrls: [], stock: 9 })]]), store, images(), { dryRun: false, trigger: "t", placeholderOnImageError: true });
    expect(r.stats.placeholders).toBe(0);
    expect(store.products.get("A")!.state.imageHashes).toEqual(before);
    expect(store.products.get("A")!.placeholder).toBe(false);
    expect(store.products.get("A")!.record.stock).toBe(9);
  });

  it("origen caído => job failed con error reintentable, sin tocar productos", async () => {
    const store = new MemoryCatalogStore();
    const down: CatalogSource = { name: "x", fetchPage: async () => { throw new Error("Alegra HTTP 503"); } };
    const r = await runCatalogSync(down, store, images(), { dryRun: false, trigger: "t", placeholderOnImageError: true });
    expect(store.jobs.get(r.jobId)?.status).toBe("failed");
    expect(store.errors[0]).toMatchObject({ stage: "source", retryable: true });
  });

  it("productos ausentes en origen no se borran, sólo se reportan", async () => {
    const store = new MemoryCatalogStore();
    await runCatalogSync(sourceOf([[rec("A"), rec("B")]]), store, images(), { dryRun: false, trigger: "t", placeholderOnImageError: true });
    const r = await runCatalogSync(sourceOf([[rec("A")]]), store, images(), { dryRun: false, trigger: "t", placeholderOnImageError: true });
    expect(store.products.has("B")).toBe(true);
    expect(r.stats.missingInSource).toBe(1);
  });
});
