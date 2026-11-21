-- =====================================================================
-- RLS. Principio: el cliente (anon/authenticated) sólo LEE lo público o lo propio.
-- Toda escritura comercial (carrito, pedidos, precios, stock, roles) pasa por el backend
-- con SUPABASE_SERVICE_ROLE_KEY (bypassa RLS) tras validar con @franzebi/domain.
-- =====================================================================

-- Propagar visibilidad a subcategorías (ocultar "electronica" oculta todo su árbol)
create or replace function public.propagate_category_visibility() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_visible is distinct from old.is_visible then
    update public.categories set is_visible = new.is_visible
    where path like new.path || '/%' and is_visible is distinct from new.is_visible;
  end if;
  return new;
end $$;
create trigger trg_categories_visibility after update of is_visible on public.categories
for each row execute function public.propagate_category_visibility();

alter table public.roles               enable row level security;
alter table public.profiles            enable row level security;
alter table public.brands              enable row level security;
alter table public.categories          enable row level security;
alter table public.products            enable row level security;
alter table public.product_categories  enable row level security;
alter table public.product_variants    enable row level security;
alter table public.product_images      enable row level security;
alter table public.inventory_snapshots enable row level security;
alter table public.price_lists         enable row level security;
alter table public.product_prices      enable row level security;
alter table public.settings            enable row level security;
alter table public.wholesale_rules     enable row level security;
alter table public.shipping_zones      enable row level security;
alter table public.carts               enable row level security;
alter table public.cart_items          enable row level security;
alter table public.orders              enable row level security;
alter table public.order_items         enable row level security;
alter table public.payment_attempts    enable row level security;
alter table public.shipping_quotes     enable row level security;
alter table public.sync_jobs           enable row level security;
alter table public.sync_errors         enable row level security;
alter table public.audit_logs          enable row level security;
alter table public.redirects           enable row level security;

-- Roles: lectura para usuarios autenticados
create policy roles_read on public.roles for select to authenticated using (true);

-- Perfiles: cada uno ve y edita lo suyo (sin rol); staff ve todos; sólo admin cambia roles
create policy profiles_self_read on public.profiles for select to authenticated using (id = auth.uid() or public.is_staff());
create policy profiles_self_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin_update on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());
revoke update on public.profiles from authenticated;
grant update (full_name, phone, dni, default_shipping_address, marketing_opt_in) on public.profiles to authenticated;

-- Escalada de privilegios: aunque se otorgara UPDATE(role), sólo admin puede cambiarlo
create or replace function public.guard_role_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Aplica a sesiones de API de usuarios finales; service_role y el owner de la base (migraciones) quedan fuera.
  if new.role is distinct from old.role
     and (current_user in ('anon','authenticated') or coalesce(auth.role(), '') in ('anon','authenticated'))
     and not public.is_admin() then
    raise exception 'Sólo un administrador puede cambiar roles' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
create trigger trg_guard_role before update of role on public.profiles for each row execute function public.guard_role_change();

-- Catálogo público
create policy brands_public on public.brands for select using (true);
create policy categories_public on public.categories for select using (is_visible or public.is_staff());
create policy products_public on public.products for select
  using ((status = 'active' and sale_mode <> 'hidden' and not public.product_in_hidden_category(id)) or public.is_staff());
create policy product_categories_public on public.product_categories for select using (true);
create policy variants_public on public.product_variants for select using (status = 'active' or public.is_staff());
create policy images_public on public.product_images for select using (status in ('ok','placeholder') or public.is_staff());

-- Precios: sólo la lista minorista es pública (y la vista oculta diseñador si hide_price).
-- La lista MAYORISTA nunca se expone al cliente: el backend la aplica cuando el carrito califica.
create policy price_lists_public_retail on public.price_lists for select using (code = 'retail' or public.is_staff());
create policy prices_public_retail on public.product_prices for select using (
  public.is_staff()
  or (price_list_id = (select id from public.price_lists where code = 'retail')
      and not exists (select 1 from public.products p where p.id = product_id and p.hide_price)
      and not public.product_in_hidden_category(product_id))
);

-- Stock histórico, sync y auditoría: sólo staff (audit: sólo admin)
create policy inventory_staff on public.inventory_snapshots for select to authenticated using (public.is_staff());
create policy sync_jobs_staff on public.sync_jobs for select to authenticated using (public.is_staff());
create policy sync_errors_staff on public.sync_errors for select to authenticated using (public.is_staff());
create policy audit_admin on public.audit_logs for select to authenticated using (public.is_admin());
-- audit_logs append-only incluso para service_role vía API: sin policies de update/delete y revocado
revoke update, delete, truncate on public.audit_logs from anon, authenticated;

-- Configuración: pública sólo si is_public (p.ej. contacto, textos); edición sólo admin
create policy settings_public on public.settings for select using (is_public or public.is_staff());
create policy settings_admin_write on public.settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy wholesale_rules_read on public.wholesale_rules for select using (active or public.is_staff());
create policy wholesale_rules_admin on public.wholesale_rules for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy zones_read on public.shipping_zones for select using (active or public.is_staff());
create policy zones_admin on public.shipping_zones for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Carrito: el dueño lee; escrituras sólo por backend
create policy carts_owner_read on public.carts for select to authenticated using (user_id = auth.uid() or public.is_staff());
create policy cart_items_owner_read on public.cart_items for select to authenticated
  using (exists (select 1 from public.carts c where c.id = cart_id and (c.user_id = auth.uid() or public.is_staff())));

-- Pedidos: dueño lee; staff lee; operador/admin actualiza estado (columnas acotadas)
create policy orders_owner_read on public.orders for select to authenticated using (user_id = auth.uid() or public.is_staff());
create policy orders_staff_update on public.orders for update to authenticated using (public.is_staff()) with check (public.is_staff());
revoke update on public.orders from authenticated;
grant update (status, paid_at, customer_note, estimated_delivery) on public.orders to authenticated;

create policy order_items_read on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.is_staff())));
create policy payments_read on public.payment_attempts for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.is_staff())));
create policy payments_staff_update on public.payment_attempts for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy shipping_quotes_staff on public.shipping_quotes for select to authenticated using (public.is_staff());

-- Redirects: lectura pública (middleware), edición admin
create policy redirects_public on public.redirects for select using (true);
create policy redirects_admin on public.redirects for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('product-images', 'product-images', true, 8388608, array['image/jpeg','image/png','image/webp']),
  ('payment-receipts', 'payment-receipts', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

create policy "product images public read" on storage.objects for select using (bucket_id = 'product-images');
create policy "product images staff write" on storage.objects for all to authenticated
  using (bucket_id = 'product-images' and public.is_staff()) with check (bucket_id = 'product-images' and public.is_staff());
-- Comprobantes: ruta "<user_id>/<order_id>/archivo"; el dueño sube/lee los suyos, staff lee todo
create policy "receipts owner write" on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-receipts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "receipts owner or staff read" on storage.objects for select to authenticated
  using (bucket_id = 'payment-receipts' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_staff()));
