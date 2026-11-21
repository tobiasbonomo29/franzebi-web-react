-- Outbox de pedidos hacia sistemas externos (hoy AstroSelling; reemplazable). D-18.
-- Cada alta o cambio de estado de un pedido encola un evento por cada sink activo (settings.integrations.orderSinks).
-- Un job (/api/cron/orders) los despacha con reintentos y backoff, respetando el orden por pedido.
create table public.order_events (
  id bigserial primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  sink text not null,
  event text not null check (event in ('order.created','order.updated')),
  order_status public.order_status not null,
  dedupe_key text not null unique,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','dead')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  last_error text,
  external_ref text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index order_events_due on public.order_events (status, next_attempt_at);
create index on public.order_events (order_id, sink, id);
alter table public.order_events enable row level security;
create policy order_events_staff on public.order_events for select to authenticated using (public.is_staff());

create or replace function public.enqueue_order_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_sink text; v_event text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  v_event := case when tg_op = 'INSERT' then 'order.created' else 'order.updated' end;
  for v_sink in
    select jsonb_array_elements_text(coalesce((select value->'orderSinks' from public.settings where key = 'integrations'), '[]'::jsonb))
  loop
    insert into public.order_events (order_id, sink, event, order_status, dedupe_key)
    values (new.id, v_sink, v_event, new.status, v_sink || ':' || v_event || ':' || new.id || ':' || new.status || ':' || txid_current())
    on conflict (dedupe_key) do nothing;
  end loop;
  return new;
end $$;
create trigger trg_orders_outbox after insert or update of status on public.orders
for each row execute function public.enqueue_order_event();

-- Reserva eventos vencidos. No toma un evento si hay uno ANTERIOR del mismo pedido y sink sin enviar
-- (así "order.updated" nunca llega antes que "order.created"). SKIP LOCKED permite workers concurrentes.
create or replace function public.claim_order_events(p_limit int default 20) returns setof public.order_events
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.order_events e set status = 'sending', attempts = e.attempts + 1, claimed_at = now()
  where e.id in (
    select c.id from public.order_events c
    where c.status in ('pending','failed') and c.next_attempt_at <= now()
      and not exists (select 1 from public.order_events p
                      where p.order_id = c.order_id and p.sink = c.sink and p.id < c.id and p.status <> 'sent')
    order by c.id
    limit least(p_limit, 100)
    for update skip locked)
  returning e.*;
end $$;
revoke all on function public.claim_order_events(int) from public, anon, authenticated;
grant execute on function public.claim_order_events(int) to service_role;

-- "sending" colgados (worker caído) vuelven a la cola
create or replace function public.requeue_stuck_order_events(p_older_than interval default interval '10 minutes') returns int
language sql security definer set search_path = public as $$
  with u as (update public.order_events set status = 'failed', last_error = 'timeout: el worker no confirmó', next_attempt_at = now()
             where status = 'sending' and claimed_at < now() - p_older_than returning 1)
  select count(*)::int from u
$$;
revoke all on function public.requeue_stuck_order_events(interval) from public, anon, authenticated;
grant execute on function public.requeue_stuck_order_events(interval) to service_role;
