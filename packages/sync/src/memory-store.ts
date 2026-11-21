import type { CatalogRecord, CatalogStore, StoredProductState, SyncErrorInput, SyncStats, ValidatedImage } from "./types.js";

/** Implementación en memoria para tests y dry-runs locales sin base. */
export class MemoryCatalogStore implements CatalogStore {
  products = new Map<string, { record: CatalogRecord; state: StoredProductState; placeholder: boolean }>();
  jobs = new Map<string, { source: string; dryRun: boolean; trigger: string; status?: string; stats?: SyncStats; summary?: unknown }>();
  errors: Array<SyncErrorInput & { jobId: string }> = [];
  writes = 0;
  private seq = 0;

  async startJob(input: { source: string; dryRun: boolean; trigger: string }) {
    const id = `job_${++this.seq}`;
    this.jobs.set(id, input);
    return id;
  }
  async finishJob(jobId: string, r: { status: string; stats: SyncStats; summary: unknown }) {
    Object.assign(this.jobs.get(jobId)!, r);
  }
  async getStates(skus: string[]) {
    const m = new Map<string, StoredProductState>();
    for (const s of skus) {
      const p = this.products.get(s);
      if (p) m.set(s, p.state);
    }
    return m;
  }
  async upsertProduct(record: CatalogRecord, contentHash: string, images: ValidatedImage[], usePlaceholder: boolean) {
    this.writes++;
    const prev = this.products.get(record.sku);
    const productId = prev?.state.productId ?? `p_${record.sku}`;
    this.products.set(record.sku, {
      record,
      // sin imágenes del origen y sin fallo => se conservan las existentes
      placeholder: images.length ? false : usePlaceholder ? true : prev?.placeholder ?? false,
      state: { productId, sku: record.sku, contentHash, imageHashes: images.length ? images.map((i) => i.sha256) : prev?.state.imageHashes ?? [] },
    });
    return { productId, created: !prev };
  }
  async recordError(jobId: string, e: SyncErrorInput) {
    this.errors.push({ jobId, ...e });
  }
  async listAllSkus() {
    return [...this.products.keys()];
  }
}
