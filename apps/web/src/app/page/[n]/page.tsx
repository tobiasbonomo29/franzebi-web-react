import { notFound } from "next/navigation";
import { SearchResults } from "@/components/SearchResults";
import type { SearchParams } from "@/lib/legacy/archive";

export const metadata = { robots: { index: false } };

/** Paginación de la búsqueda de WordPress: /page/2/?s=term&post_type=product */
export default async function SearchPage({ params, searchParams }: { params: Promise<{ n: string }>; searchParams: Promise<SearchParams> }) {
  const [{ n }, sp] = await Promise.all([params, searchParams]);
  const s = Array.isArray(sp.s) ? sp.s[0] : sp.s;
  if (!/^\d+$/.test(n) || s == null) notFound();
  return <SearchResults sp={sp} term={s} page={Math.max(1, Number(n))} />;
}
