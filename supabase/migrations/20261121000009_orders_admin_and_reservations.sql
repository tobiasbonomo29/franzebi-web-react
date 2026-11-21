-- 1) Reservas de stock pendientes de facturar en Alegra.
--    place_order descuenta stock local al instante, pero Alegra recién lo descuenta cuando se emite la factura
--    (AstroSelling o sink "alegra"). Si el sync corre en el medio, sin esto "devolvería" ese stock y se podría
--    sobrevender. El sync resta estas cantidades al stock que trae de Alegra.
create or replace function public.pending_stock_reservations()
returns table (sku text, quantity bigint)
language sql stable security definer set search_path = public as $$
  select oi.sku, sum(oi.quantity)::bigint
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where o.status not in ('cancelled', 'refunded', 'failed')
    and o.placed_at > now() - interval '14 days'
    and not exists (
      select 1 from public.order_events e
      where e.order_id = o.id and e.event = 'order.created' and e.status = 'sent')
  group by oi.sku
$$;
revoke all on function public.pending_stock_reservations() from public, anon, authenticated;
grant execute on function public.pending_stock_reservations() to service_role;

-- 2) Panel de pedidos: seguimiento de envío y notas internas (como las "notas del pedido" de Woo)
alter table public.orders add column if not exists tracking_number text;
alter table public.orders add column if not exists shipped_at timestamptz;

create table if not exists public.order_notes (
  id bigserial primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  author_email text,
  note text not null check (length(note) between 1 and 2000),
  customer_visible boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists order_notes_order on public.order_notes (order_id, created_at desc);
alter table public.order_notes enable row level security;
drop policy if exists order_notes_staff on public.order_notes;
create policy order_notes_staff on public.order_notes for select using (public.is_staff());
drop policy if exists order_notes_customer on public.order_notes;
create policy order_notes_customer on public.order_notes for select
  using (customer_visible and exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid()));
revoke insert, update, delete on public.order_notes from anon, authenticated; -- se escriben sólo desde el servidor (service role)

-- 3) "Más recientes": los productos nuevos (sin ficha Woo) primero, luego por id de Woo
create or replace function public.catalog_page(
  p_category_ids uuid[] default null, p_search text default null, p_orderby text default 'menu_order',
  p_min_cents bigint default null, p_max_cents bigint default null, p_limit int default 9, p_offset int default 0
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
    select cp.*, p.search_text, p.created_at,
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
    case when p_orderby = 'date' then (c.legacy_woo_id is null) end desc,
    case when p_orderby = 'date' then coalesce(c.legacy_woo_id, extract(epoch from c.created_at)::bigint) end desc,
    case when p_search is not null and p_orderby = 'menu_order' then c.score end desc,
    lower(c.name) asc
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
$$;
grant execute on function public.catalog_page(uuid[], text, text, bigint, bigint, int, int) to anon, authenticated, service_role;
