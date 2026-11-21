import { LegacyPage } from "@/components/LegacyPage";
import { archiveValues, type SearchParams } from "@/lib/legacy/archive";

/** Resultados de /?s=term&post_type=product (y /page/N/?s=...), con la plantilla de búsqueda de WP. */
export async function SearchResults({ sp, term, page }: { sp: SearchParams; term: string; page: number }) {
  const { values } = await archiveValues({
    title: `Resultados de búsqueda para: ${term}`,
    crumbs: [{ name: "Shop", href: "/shop/" }, { name: `Resultados de búsqueda para “${term}”` }],
    categoryIds: null,
    search: term,
    page,
    sp,
    pageHref: (n) => (n === 1 ? "/" : `/page/${n}/`),
  });
  return <LegacyPage name="search" values={values} />;
}
