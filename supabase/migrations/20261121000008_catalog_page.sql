-- Listado paginado de catálogo para las grillas heredadas de Woo (categoría, shop, búsqueda, home).
-- SECURITY INVOKER sobre la vista catalog_products: respeta RLS (publicado, no oculto, sin Electrónica).
-- Evita pasar cientos de UUIDs por la URL de PostgREST.
create or replace function public.catalog_page(
  p_category_ids uuid[] default null,   -- productos en cualquiera de estas categorías (subárbol ya expandido)
  p_search text default null,           -- término (alias de marca aplicado: "lattfa" -> lattafa)
  p_orderby text default 'menu_order',  -- menu_order | date | price | price-desc | popularity | rating
  p_min_cents bigint default null,
  p_max_cents bigint default null,
  p_limit int default 9,
  p_offset int default 0
) returns table (
  id uuid, legacy_woo_id bigint, sku text, slug text, name text, sale_mode public.sale_mode, in_stock boolean,
  stock_qty integer, retail_price_cents bigint, hide_price boolean, thumb_src text, thumb_srcset text, thumb_alt text,
  cat_slugs text[], total_count bigint
)
language sql stable security invoker set search_path = public as $$
  with term as (
    select case when p_search is null or btrim(p_search) = '' then null else coalesce(
      (select lower(b.name) from public.brands b where lower(public.f_unaccent(btrim(p_search))) = any (b.aliases) limit 1),
      lower(public.f_unaccent(btrim(p_search)))) end as t
  ),
  base as (
    select cp.*, p.search_text,
           case when term.t is null then 0 else greatest(similarity(p.search_text, term.t), word_similarity(term.t, p.search_text)) end as score
    from public.catalog_products cp
    join public.products p on p.id = cp.id
    cross join term
    where (p_category_ids is null or exists (
             select 1 from public.product_categories pc where pc.product_id = cp.id and pc.category_id = any (p_category_ids)))
      and (term.t is null or p.search_text like '%' || term.t || '%' or term.t <% p.search_text)
      and (p_min_cents is null or cp.retail_price_cents >= p_min_cents)
      and (p_max_cents is null or cp.retail_price_cents <= p_max_cents)
  ),
  counted as (select base.*, count(*) over () as total_count from base)
  select c.id, c.legacy_woo_id, c.sku, c.slug, c.name, c.sale_mode, c.in_stock, c.stock_qty, c.retail_price_cents, c.hide_price,
         coalesce(img.thumb_url, img.source_url), img.srcset, img.alt,
         (select array_agg(cat.slug) from public.product_categories pc join public.categories cat on cat.id = pc.category_id where pc.product_id = c.id),
         c.total_count
  from counted c
  left join lateral (
    select pi.thumb_url, pi.source_url, pi.srcset, pi.alt from public.product_images pi
    where pi.product_id = c.id and pi.status = 'ok' order by pi.position limit 1
  ) img on true
  order by
    case when p_orderby = 'price' then c.retail_price_cents end asc nulls last,
    case when p_orderby = 'price-desc' then c.retail_price_cents end desc nulls last,
    case when p_orderby = 'date' then c.legacy_woo_id end desc nulls last,
    case when p_search is not null and p_orderby = 'menu_order' then c.score end desc,
    lower(c.name) asc
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
$$;
grant execute on function public.catalog_page(uuid[], text, text, bigint, bigint, int, int) to anon, authenticated, service_role;

-- Rango de precios del listado (para el filtro "Rango de precios")
create or replace function public.catalog_price_range(p_category_ids uuid[] default null)
returns table (min_cents bigint, max_cents bigint)
language sql stable security invoker set search_path = public as $$
  select min(cp.retail_price_cents), max(cp.retail_price_cents)
  from public.catalog_products cp
  where cp.retail_price_cents is not null
    and (p_category_ids is null or exists (select 1 from public.product_categories pc where pc.product_id = cp.id and pc.category_id = any (p_category_ids)))
$$;
grant execute on function public.catalog_price_range(uuid[]) to anon, authenticated, service_role;
