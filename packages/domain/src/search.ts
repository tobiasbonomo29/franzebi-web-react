import { normalizeText } from "./text.js";

/**
 * Búsqueda tolerante: normaliza tildes/mayúsculas, aplica aliases explícitos (snippet #38)
 * y corrige marcas mal tipeadas por distancia de edición contra el diccionario de marcas.
 * En la base, la búsqueda final usa pg_trgm + unaccent (ver migración SQL); esto reescribe el término.
 */

export const DEFAULT_ALIASES: Record<string, string> = {
  lattfa: "lattafa",
  latafa: "lattafa",
  lattaf: "lattafa",
  lattaffa: "lattafa",
  lataffa: "lattafa",
  "al haramein": "al haramain",
};

/** Damerau-Levenshtein (transposiciones adyacentes). */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

const maxDistance = (len: number) => (len <= 3 ? 0 : len <= 5 ? 1 : 2);

export interface RewrittenQuery {
  original: string;
  normalized: string;
  rewritten: string;
  corrections: Array<{ from: string; to: string }>;
}

export function rewriteSearchQuery(q: string, brands: string[], aliases = DEFAULT_ALIASES): RewrittenQuery {
  const normalized = normalizeText(q);
  if (aliases[normalized]) {
    return { original: q, normalized, rewritten: aliases[normalized]!, corrections: [{ from: normalized, to: aliases[normalized]! }] };
  }
  const brandTokens = [...new Set(brands.flatMap((b) => normalizeText(b).split(" ")).filter((t) => t.length > 2))];
  const corrections: RewrittenQuery["corrections"] = [];
  const tokens = normalized.split(" ").map((tok) => {
    if (aliases[tok]) {
      corrections.push({ from: tok, to: aliases[tok]! });
      return aliases[tok]!;
    }
    if (!tok || brandTokens.includes(tok)) return tok;
    let best: string | null = null;
    let bestD = Infinity;
    for (const bt of brandTokens) {
      if (Math.abs(bt.length - tok.length) > 2) continue;
      const dist = editDistance(tok, bt);
      if (dist < bestD) [best, bestD] = [bt, dist];
    }
    if (best && bestD > 0 && bestD <= maxDistance(tok.length)) {
      corrections.push({ from: tok, to: best });
      return best;
    }
    return tok;
  });
  return { original: q, normalized, rewritten: tokens.join(" "), corrections };
}
