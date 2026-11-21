-- Publicación controlada (D-23). El sync de Alegra crea/actualiza productos pero NUNCA los publica:
-- sólo se publican los que vienen de la migración de Woo (mapeo por SKU) o los que el admin publique.
-- Así los ~1.100 ítems de Alegra sin ficha en Woo (testers, VS, Karseell, decants extra) no aparecen solos.
alter table public.products add column if not exists published boolean not null default false;
create index if not exists products_published on public.products (published) where published;

-- Política pública: además de activo / no oculto / no en categoría oculta, debe estar publicado
drop policy if exists products_public on public.products;
create policy products_public on public.products for select
  using ((status = 'active' and published and sale_mode <> 'hidden' and not public.product_in_hidden_category(id)) or public.is_staff());

-- ¿Visible al público? (usada por vista, precios, carrito y alta de pedido)
create or replace function public.product_is_public(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.products p
                 where p.id = pid and p.status = 'active' and p.published and p.sale_mode <> 'hidden')
     and not public.product_in_hidden_category(pid)
$$;

drop policy if exists prices_public_retail on public.product_prices;
create policy prices_public_retail on public.product_prices for select using (
  public.is_staff()
  or (price_list_id = (select id from public.price_lists where code = 'retail')
      and not exists (select 1 from public.products p where p.id = product_id and p.hide_price)
      and public.product_is_public(product_id))
);

create or replace view public.catalog_products with (security_invoker = true) as
select p.id, p.sku, p.slug, p.name, p.short_description, p.description, p.brand_id, p.primary_category_id,
       p.sale_mode, p.wholesale_group, p.has_placeholder_image,
       (p.stock_qty > 0) as in_stock,
       case when p.hide_price then null else rp.amount_cents end as retail_price_cents,
       p.seo_title, p.seo_description, p.updated_at
from public.products p
left join public.product_prices rp on rp.product_id = p.id and rp.price_list_id = (select id from public.price_lists where code = 'retail')
where p.status = 'active' and p.published and p.sale_mode <> 'hidden'
  and not public.product_in_hidden_category(p.id);

-- El carrito trata como "hidden" a lo no publicado
create or replace function public.hidden_product_ids(ids uuid[]) returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from unnest(ids) as id where not public.product_is_public(id)
$$;
revoke all on function public.hidden_product_ids(uuid[]) from public, anon, authenticated;
grant execute on function public.hidden_product_ids(uuid[]) to service_role;

-- place_order: sólo productos públicos
create or replace function public.place_order(p jsonb) returns table (order_id uuid, order_number bigint)
language plpgsql security definer set search_path = public as $$
declare
  v_order uuid;
  v_number bigint;
  it jsonb;
  v_updated int;
begin
  for it in select * from jsonb_array_elements(p->'items') loop
    update public.products
       set stock_qty = stock_qty - (it->>'quantity')::int
     where id = (it->>'product_id')::uuid
       and sale_mode = 'purchasable'
       and public.product_is_public(id)
       and stock_qty >= (it->>'quantity')::int;
    get diagnostics v_updated = row_count;
    if v_updated = 0 then
      raise exception 'STOCK_INSUFICIENTE:%', it->>'sku' using errcode = 'P0001';
    end if;
  end loop;

  insert into public.orders (user_id, email, status, payment_method, delivery_kind, delivery_option_id, delivery_label,
      moto_zone_id, estimated_delivery, billing, shipping_address, subtotal_cents, shipping_cents, cash_discount_cents,
      total_cents, wholesale_applied, wholesale_points, wholesale_threshold, wholesale_rules_version, pricing_snapshot, customer_note)
  values (nullif(p->>'user_id','')::uuid, p->>'email', (p->>'status')::public.order_status, p->>'payment_method', p->>'delivery_kind',
      p->>'delivery_option_id', p->>'delivery_label', nullif(p->>'moto_zone_id',''), p->>'estimated_delivery', p->'billing', p->'shipping_address',
      (p->>'subtotal_cents')::bigint, (p->>'shipping_cents')::bigint, (p->>'cash_discount_cents')::bigint, (p->>'total_cents')::bigint,
      (p->>'wholesale_applied')::boolean, (p->>'wholesale_points')::numeric, (p->>'wholesale_threshold')::numeric,
      nullif(p->>'wholesale_rules_version','')::int, p->'pricing_snapshot', p->>'customer_note')
  returning id, number into v_order, v_number;

  insert into public.order_items (order_id, product_id, sku, name, quantity, unit_price_cents, retail_unit_price_cents, line_total_cents, wholesale_applied, wholesale_group)
  select v_order, (x->>'product_id')::uuid, x->>'sku', x->>'name', (x->>'quantity')::int, (x->>'unit_price_cents')::bigint,
         (x->>'retail_unit_price_cents')::bigint, (x->>'line_total_cents')::bigint, (x->>'wholesale_applied')::boolean,
         nullif(x->>'wholesale_group','')::public.wholesale_group
  from jsonb_array_elements(p->'items') x;

  insert into public.payment_attempts (order_id, method, status, amount_cents)
  values (v_order, p->>'payment_method', case when p->>'payment_method' = 'bank_transfer' then 'awaiting_validation' else 'pending' end, (p->>'total_cents')::bigint);

  if p ? 'cart_id' then
    update public.carts set status = 'converted' where id = (p->>'cart_id')::uuid;
  end if;

  return query select v_order, v_number;
end $$;
revoke all on function public.place_order(jsonb) from public, anon, authenticated;
grant execute on function public.place_order(jsonb) to service_role;
