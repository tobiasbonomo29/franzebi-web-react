import type { Cents } from "@franzebi/domain";

/** Registro normalizado, independiente del proveedor (Alegra hoy; otro ERP mañana). */
export interface CatalogRecord {
  sku: string; // identidad inmutable
  name: string;
  retailPriceCents: Cents | null; // lista principal ARS
  wholesalePriceCents: Cents | null; // lista MAYORISTA ARS
  stock: number;
  categoryPath: string[]; // p.ej. ["Perfumería","Fragancias Masculinas","Diseñador - Masculinas","Jo Milano - Dis Masc"]
  imageUrls: string[];
  active: boolean;
  sourceId: string;
}

export interface SourcePage {
  records: CatalogRecord[];
  /** Ítems que no pudieron normalizarse (sin SKU, sin precio ARS, etc.). */
  rejects: Array<{ sourceId: string; sku?: string; code: string; message: string; payload?: unknown }>;
  next: string | null;
}

/** Puerto de origen de catálogo. */
export interface CatalogSource {
  readonly name: string; // "alegra"
  fetchPage(cursor: string | null): Promise<SourcePage>;
}

export interface StoredProductState {
  productId: string;
  sku: string;
  contentHash: string;
  imageHashes: string[];
}

export type SyncAction = "create" | "update" | "unchanged" | "skip";

export interface SyncErrorInput {
  sku?: string;
  sourceId?: string;
  stage: "normalize" | "validate" | "image" | "persist" | "source";
  code: string;
  message: string;
  retryable: boolean;
  payloadSummary?: unknown;
}

/** Puerto de persistencia (Supabase en prod, memoria en tests). */
export interface CatalogStore {
  startJob(input: { source: string; dryRun: boolean; trigger: string }): Promise<string>;
  finishJob(jobId: string, result: { status: "succeeded" | "partial" | "failed"; stats: SyncStats; summary: unknown }): Promise<void>;
  getStates(skus: string[]): Promise<Map<string, StoredProductState>>;
  upsertProduct(record: CatalogRecord, contentHash: string, images: ValidatedImage[], usePlaceholder: boolean): Promise<{ productId: string; created: boolean }>;
  recordError(jobId: string, e: SyncErrorInput): Promise<void>;
  listAllSkus(): Promise<string[]>;
}

export interface ValidatedImage {
  sourceUrl: string;
  sha256: string;
  mime: string;
  width: number;
  height: number;
  bytes: Uint8Array;
}

export interface ImageFetcher {
  fetch(url: string): Promise<{ bytes: Uint8Array; contentType: string | null; status: number }>;
}

export interface SyncStats {
  seen: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  errors: number;
  imageErrors: number;
  placeholders: number;
  missingInSource: number;
}
