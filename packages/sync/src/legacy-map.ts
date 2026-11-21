import { normalizeSku } from "./engine.js";

/**
 * Mapeo SKU de WooCommerce → SKU de Alegra para migrar la metadata de Woo (slug/URL, fotos, categorías,
 * descripción) al producto correcto. Alegra es la fuente de verdad del SKU.
 *
 * Hallazgos 2026-11-21 que motivan las reglas:
 *  - Woo guardó SKUs con entidades HTML (&#8217; &amp; &#038;) o "?" donde Alegra tiene ’ & '.
 *  - En Alegra los decants se renombraron con sufijo _ARB / _DIS (670 de 694 decants de Woo).
 * Reglas, en orden (la primera que da un único candidato gana):
 *   exact → entities → suffix (+_ARB/_DIS) → wildcard ("?" = 1 carácter) → name (nombre normalizado)
 * Si hay más de un candidato, no se adivina: queda como "ambiguous" para revisión manual.
 */

export type MatchRule = "exact" | "entities" | "suffix" | "wildcard" | "name";

const ENTITIES: Record<string, string> = { "&amp;": "&", "&#038;": "&", "&#38;": "&", "&#8217;": "’", "&#8216;": "‘", "&#039;": "'", "&#39;": "'", "&quot;": '"', "&#8211;": "–", "&#8220;": "“", "&#8221;": "”" };

export function decodeEntities(s: string) {
  return s.replace(/&(#\d+|[a-z]+);/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);
}

/** Para comparar: apóstrofos tipográficos y rectos unificados. */
const canon = (s: string) => normalizeSku(decodeEntities(s)).replace(/[’‘´`]/g, "'");

export const normalizeName = (s: string) =>
  decodeEntities(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\bDEACNT\b/g, "DECANT").replace(/[^A-Z0-9]+/g, " ").trim();

export interface LegacyMatch<W, A> {
  woo: W;
  alegra: A | null;
  rule: MatchRule | "ambiguous" | "unmatched";
  candidates?: A[];
}

export function mapWooToAlegra<W extends { sku: string; name: string }, A extends { sku: string; name: string }>(woo: W[], alegra: A[]): LegacyMatch<W, A>[] {
  const bySku = new Map<string, A[]>();
  const byName = new Map<string, A[]>();
  for (const a of alegra) {
    bySku.set(canon(a.sku), [...(bySku.get(canon(a.sku)) ?? []), a]);
    byName.set(normalizeName(a.name), [...(byName.get(normalizeName(a.name)) ?? []), a]);
  }
  const exactMap = new Map<string, A[]>();
  for (const a of alegra) exactMap.set(normalizeSku(a.sku), [...(exactMap.get(normalizeSku(a.sku)) ?? []), a]);
  const used = new Set<A>();
  const free = (cands: A[] | undefined) => (cands ?? []).filter((c) => !used.has(c));

  // Cada regla se aplica a TODAS las fichas antes de pasar a la siguiente: así una ficha huérfana
  // (p.ej. SKU numérico 637) nunca le gana por nombre el producto a la ficha que coincide por SKU.
  const rules: Array<[MatchRule, (w: W) => A[]]> = [
    ["exact", (w) => free(exactMap.get(normalizeSku(w.sku)))],
    ["entities", (w) => free(bySku.get(canon(w.sku)))],
    ["suffix", (w) => [...free(bySku.get(canon(w.sku) + "_ARB")), ...free(bySku.get(canon(w.sku) + "_DIS"))]],
    ["wildcard", (w) => {
      if (!w.sku.includes("?")) return [];
      const re = new RegExp("^" + canon(w.sku).replace(/[.*+^${}()|[\]\\]/g, "\\$&").replace(/\?/g, ".") + "(_ARB|_DIS)?$");
      return alegra.filter((a) => !used.has(a) && re.test(canon(a.sku)));
    }],
    ["name", (w) => free(byName.get(normalizeName(w.name)))],
  ];
  const result: Array<LegacyMatch<W, A> | null> = woo.map(() => null);
  for (const [rule, find] of rules) {
    woo.forEach((w, i) => {
      if (result[i]) return;
      const cands = find(w);
      if (cands.length === 1) {
        used.add(cands[0]!);
        result[i] = { woo: w, alegra: cands[0]!, rule };
      } else if (cands.length > 1) {
        result[i] = { woo: w, alegra: null, rule: "ambiguous", candidates: cands };
      }
    });
  }
  return result.map((r, i) => r ?? { woo: woo[i]!, alegra: null, rule: "unmatched" as const });
}
