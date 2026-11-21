-- Alta atómica de pedido: inserta pedido + ítems + intento de pago y reserva stock con verificación.
-- Los importes los calcula @franzebi/domain en el backend; acá se re-verifican stock y coherencia.
-- Sólo service_role puede ejecutarla.
create or replace function public.place_order(p jsonb) returns table (order_id uuid, order_number bigint)
language plpgsql security definer set search_path = public as $$
declare
  v_order uuid;
  v_number bigint;
  it jsonb;
  v_updated int;
begin
  -- 1) reservar stock (falla todo el pedido si algún ítem no alcanza)
  for it in select * from jsonb_array_elements(p->'items') loop
    update public.products
       set stock_qty = stock_qty - (it->>'quantity')::int
     where id = (it->>'product_id')::uuid
       and status = 'active'
       and sale_mode = 'purchasable'
       and not public.product_in_hidden_category(id)
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

-- Devolver stock al cancelar (idempotente: sólo una vez por pedido)
alter table public.orders add column if not exists stock_released_at timestamptz;
create or replace function public.release_order_stock(p_order uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.orders set stock_released_at = now() where id = p_order and stock_released_at is null;
  if not found then return; end if;
  update public.products pr set stock_qty = pr.stock_qty + oi.quantity
  from public.order_items oi where oi.order_id = p_order and oi.product_id = pr.id;
end $$;
revoke all on function public.release_order_stock(uuid) from public, anon, authenticated;
grant execute on function public.release_order_stock(uuid) to service_role;

-- Ids (de los dados) que están en categorías ocultas: el carrito los trata como "hidden"
create or replace function public.hidden_product_ids(ids uuid[]) returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from unnest(ids) as id where public.product_in_hidden_category(id)
$$;
revoke all on function public.hidden_product_ids(uuid[]) from public, anon, authenticated;
grant execute on function public.hidden_product_ids(uuid[]) to service_role;
