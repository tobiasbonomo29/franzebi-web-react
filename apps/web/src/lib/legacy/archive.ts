import "server-only";
import { env } from "../env";
import { breadcrumb, esc, noProducts, orderingLinks, pagination, priceFilter, productGrid, resultCount } from "./render";
import { listProducts, priceRange } from "./store";

export const PER_PAGE = 9; // igual que el sitio (3 columnas x 3)
const COLUMNS = 3;

export type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Valores para la plantilla de archivo (category/shop/search). */
export async function archiveValues(opts: {
  title: string;
  crumbs: Array<{ name: string; href?: string }>;
  categoryIds: string[] | null;
  search?: string | null;
  page: number;
  sp: SearchParams;
  pageHref: (n: number) => string; // URL de la página n (sin query)
}) {
  const orderby = one(opts.sp.orderby) ?? "menu_order";
  const minPrice = Number(one(opts.sp.min_price)) || undefined;
  const maxPrice = Number(one(opts.sp.max_price)) || undefined;
  const { items, total } = await listProducts({
    categoryIds: opts.categoryIds,
    search: opts.search,
    orderby,
    minCents: minPrice != null ? minPrice * 100 : null,
    maxCents: maxPrice != null ? maxPrice * 100 : null,
    limit: PER_PAGE,
    offset: (opts.page - 1) * PER_PAGE,
  });
  const range = await priceRange(opts.categoryIds);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));

  // Query que se conserva en paginación / orden / filtro
  const keep: Record<string, string> = {};
  for (const k of ["s", "post_type", "orderby", "min_price", "max_price"]) {
    const v = one(opts.sp[k]);
    if (v) keep[k] = v;
  }
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams({ ...keep, ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v != null)) as Record<string, string> });
    const s = p.toString();
    return s ? `?${s}` : "";
  };
  const filterKeep = { ...keep };
  delete filterKeep.min_price;
  delete filterKeep.max_price;

  return {
    values: {
      breadcrumb: breadcrumb(opts.crumbs),
      title: esc(opts.title),
      filters: priceFilter(range.min, range.max, { min: minPrice, max: maxPrice }, filterKeep),
      count: resultCount(opts.page, PER_PAGE, total),
      ordering: orderingLinks(orderby, (o) => `${opts.pageHref(1)}${qs({ orderby: o })}`),
      products: items.length ? `<ul class="products elementor-grid vamtam-wc columns-${COLUMNS}">\n${productGrid(items, COLUMNS, env().SITE_URL)}</ul>\n` : noProducts(),
      pagination: pagination(opts.page, pages, (n) => `${opts.pageHref(n)}${qs({})}`),
    },
    total,
    pages,
  };
}

/** "/x/y/page/3" -> { segments: [x,y], page: 3 } */
export function splitPaged(segments: string[]) {
  const i = segments.lastIndexOf("page");
  if (i >= 0 && i === segments.length - 2 && /^\d+$/.test(segments[i + 1]!)) {
    return { segments: segments.slice(0, i), page: Math.max(1, Number(segments[i + 1])) };
  }
  return { segments, page: 1 };
}
