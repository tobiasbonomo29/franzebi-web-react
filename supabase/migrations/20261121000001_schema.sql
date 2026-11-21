-- =====================================================================
-- Franzebi Imports — esquema base
-- Dinero: SIEMPRE bigint en centavos ARS. SKU: identidad inmutable.
-- =====================================================================
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema public;
create extension if not exists unaccent with schema public;

-- unaccent() no es IMMUTABLE; wrapper para índices
create or replace function public.f_unaccent(text) returns text
language sql immutable parallel safe strict as $$ select public.unaccent('public.unaccent'::regdictionary, $1) $$;

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- ---------------------------------------------------------------------
-- Roles y perfiles
-- ---------------------------------------------------------------------
create table public.roles (
  id text primary key check (id in ('admin','operator','customer','wholesale')),
  label text not null,
  description text
);
insert into public.roles (id, label, description) values
  ('admin','Administrador','Acceso total, configuración y usuarios'),
  ('operator','Operador','Pedidos, stock sincronizado, reintentos de sync; sin configuración ni roles'),
  ('customer','Cliente','Cliente minorista'),
  ('wholesale','Mayorista','Cliente con beneficio mayorista (re-stock)');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  phone text,
  dni text,
  role text not null default 'customer' references public.roles(id),
  wholesale_since timestamptz,
  legacy_wp_user_id bigint unique,           -- trazabilidad de migración (sin contraseñas)
  password_reset_required boolean not null default false,
  default_shipping_address jsonb,
  marketing_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.profiles (role);
create trigger trg_profiles_updated before update on public.profiles for each row execute function public.set_updated_at();

-- Perfil automático al registrarse (rol siempre 'customer'; nunca desde metadata del cliente)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, nullif(new.raw_user_meta_data->>'full_name',''))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Helpers de autorización (security definer para evitar recursión de RLS)
create or replace function public.current_role_id() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('admin','operator') from public.profiles where id = auth.uid()), false)
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false)
$$;

-- ---------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------
create table public.brands (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  aliases text[] not null default '{}',      -- búsqueda tolerante ("lattfa" -> Lattafa)
  created_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.categories(id) on delete restrict,
  slug text not null,
  name text not null,
  path text not null unique,                 -- "perfumeria/fragancias-masculinas/disenador-masculinas/jo-milano-dis-masc"
  legacy_woo_id bigint unique,
  is_visible boolean not null default true,  -- Electrónica => false
  show_in_menu boolean not null default true,
  is_featured boolean not null default false,
  sort_name text generated always as (lower(public.f_unaccent(name))) stored, -- orden alfabético
  seo_title text,
  seo_description text,
  h1 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (parent_id, slug)
);
create trigger trg_categories_updated before update on public.categories for each row execute function public.set_updated_at();

create type public.sale_mode as enum ('purchasable','on_request','hidden');
create type public.wholesale_group as enum ('arabes','disenador','cosmetica');

create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique check (sku = upper(btrim(sku)) and sku <> ''),
  slug text not null unique,
  name text not null,
  short_description text,
  description text,
  brand_id uuid references public.brands(id),
  primary_category_id uuid references public.categories(id),
  status text not null default 'active' check (status in ('active','inactive','draft')),
  sale_mode public.sale_mode not null default 'purchasable',
  sale_mode_locked boolean not null default false,       -- override manual que el sync no pisa
  hide_price boolean not null default false,             -- D-08 diseñador: precios ocultos
  wholesale_group public.wholesale_group,
  stock_qty integer not null default 0 check (stock_qty >= 0),
  weight_kg numeric(8,3), length_cm numeric(8,2), width_cm numeric(8,2), height_cm numeric(8,2),
  -- sincronización
  source text not null default 'alegra',
  source_id text,
  content_hash text,
  last_synced_at timestamptz,
  missing_in_source_since timestamptz,
  has_placeholder_image boolean not null default false,
  legacy_woo_id bigint unique,
  legacy_url text,
  seo_title text, seo_description text,
  search_text text generated always as (lower(public.f_unaccent(coalesce(name,'') || ' ' || sku))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_search_trgm on public.products using gin (search_text gin_trgm_ops);
create index on public.products (primary_category_id) where status = 'active';
create index on public.products (source, source_id);
create trigger trg_products_updated before update on public.products for each row execute function public.set_updated_at();

-- SKU inmutable
create or replace function public.prevent_sku_change() returns trigger language plpgsql as $$
begin
  if new.sku is distinct from old.sku then
    raise exception 'El SKU es inmutable (% -> %)', old.sku, new.sku using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger trg_products_sku_immutable before update of sku on public.products for each row execute function public.prevent_sku_change();

create table public.product_categories (
  product_id uuid not null references public.products(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  primary key (product_id, category_id)
);
create index on public.product_categories (category_id);

-- Hoy todo el catálogo es "simple" (1.726/1.726). Se deja la tabla para tamaños futuros.
create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  sku text not null unique check (sku = upper(btrim(sku)) and sku <> ''),
  attributes jsonb not null default '{}',     -- {"Tamaño":"100ML"}
  stock_qty integer not null default 0 check (stock_qty >= 0),
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_variants_updated before update on public.product_variants for each row execute function public.set_updated_at();
create trigger trg_variants_sku_immutable before update of sku on public.product_variants for each row execute function public.prevent_sku_change();

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  position smallint not null default 0,
  storage_path text,                          -- bucket product-images
  source_url text,
  legacy_url text,                            -- URL wp-content/uploads original (301)
  sha256 text,
  mime text check (mime in ('image/jpeg','image/png','image/webp')),
  width integer, height integer, bytes integer,
  status text not null default 'ok' check (status in ('ok','invalid','placeholder','pending')),
  error_code text, error_message text,
  alt text,
  created_at timestamptz not null default now(),
  unique (product_id, position)
);

create table public.inventory_snapshots (
  id bigserial primary key,
  product_id uuid not null references public.products(id) on delete cascade,
  sku text not null,
  stock_qty integer not null,
  source text not null,
  sync_job_id uuid,
  captured_at timestamptz not null default now()
);
create index on public.inventory_snapshots (product_id, captured_at desc);

create table public.price_lists (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code in ('retail','wholesale')),
  name text not null,                         -- nombre en Alegra ("MAYORISTA")
  currency char(3) not null default 'ARS' check (currency = 'ARS'),  -- listas USD se ignoran por diseño
  source_id text,
  active boolean not null default true
);

create table public.product_prices (
  product_id uuid not null references public.products(id) on delete cascade,
  price_list_id uuid not null references public.price_lists(id) on delete cascade,
  amount_cents bigint not null check (amount_cents > 0),
  synced_at timestamptz not null default now(),
  primary key (product_id, price_list_id)
);

-- ---------------------------------------------------------------------
-- Reglas comerciales y configuración (todo configurable desde admin)
-- ---------------------------------------------------------------------
create table public.settings (
  key text primary key,                       -- 'payments', 'shipping', 'sameday', 'wholesale', 'catalog', 'contact'
  value jsonb not null,
  is_public boolean not null default false,   -- sólo claves públicas se exponen al frontend
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
create trigger trg_settings_updated before update on public.settings for each row execute function public.set_updated_at();

create table public.wholesale_rules (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique,
  active boolean not null default false,
  first_purchase_threshold numeric(5,1) not null check (first_purchase_threshold > 0),
  restock_threshold numeric(5,1) not null check (restock_threshold > 0),
  groups jsonb not null,                      -- {"arabes":{"first":1,"restock":1},...}
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create unique index wholesale_rules_one_active on public.wholesale_rules (active) where active;

create table public.shipping_zones (
  id text primary key,                        -- verde | negra | azul | roja
  label text not null,
  price_cents bigint not null check (price_cents >= 0),
  is_caba boolean not null default false,
  cities text[] not null default '{}',
  postcode_ranges int4range[] not null default '{}',
  same_day_eligible boolean not null default true,
  active boolean not null default true,
  sort smallint not null default 0,
  updated_at timestamptz not null default now()
);
create trigger trg_zones_updated before update on public.shipping_zones for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Carrito y pedidos (escrituras SÓLO vía backend con service role)
-- ---------------------------------------------------------------------
create table public.carts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  anonymous_token_hash text unique,           -- carrito invitado: hash del token de cookie httpOnly
  status text not null default 'open' check (status in ('open','converted','abandoned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (user_id is not null or anonymous_token_hash is not null)
);
create unique index carts_one_open_per_user on public.carts (user_id) where status = 'open' and user_id is not null;
create trigger trg_carts_updated before update on public.carts for each row execute function public.set_updated_at();

create table public.cart_items (
  cart_id uuid not null references public.carts(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity integer not null check (quantity between 1 and 999),
  added_at timestamptz not null default now(),
  primary key (cart_id, product_id)
);

create sequence public.order_number_seq start 30000;

create type public.order_status as enum ('pending','on_hold','processing','completed','cancelled','refunded','failed');

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  number bigint not null unique default nextval('public.order_number_seq'),
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  status public.order_status not null,
  payment_method text not null check (payment_method in ('bank_transfer','cash','mercadopago','card')),
  delivery_kind text not null check (delivery_kind in ('local_pickup','moto','moto_scheduled_caba','correo_argentino')),
  delivery_option_id text not null,
  delivery_label text not null,
  moto_zone_id text references public.shipping_zones(id),
  estimated_delivery text,
  billing jsonb not null,                     -- nombre, dni, teléfono
  shipping_address jsonb,
  subtotal_cents bigint not null check (subtotal_cents >= 0),
  shipping_cents bigint not null default 0 check (shipping_cents >= 0),
  cash_discount_cents bigint not null default 0 check (cash_discount_cents >= 0),
  total_cents bigint not null check (total_cents >= 0),
  wholesale_applied boolean not null default false,
  wholesale_points numeric(6,1),
  wholesale_threshold numeric(5,1),
  wholesale_rules_version integer,
  pricing_snapshot jsonb not null,            -- salida completa de priceCart() para auditoría
  customer_note text,
  legacy_woo_id bigint unique,
  external_refs jsonb not null default '{}',  -- {"astroselling": "...", "alegra_invoice": "..."}
  placed_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_at timestamptz not null default now(),
  check (total_cents = subtotal_cents - cash_discount_cents + shipping_cents),
  check (not (payment_method = 'cash' and delivery_kind = 'correo_argentino'))   -- regla dura en la base
);
create index on public.orders (user_id, placed_at desc);
create index on public.orders (status, placed_at desc);
create trigger trg_orders_updated before update on public.orders for each row execute function public.set_updated_at();

create table public.order_items (
  id bigserial primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  sku text not null,
  name text not null,
  quantity integer not null check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  retail_unit_price_cents bigint not null,
  line_total_cents bigint not null,
  wholesale_applied boolean not null default false,
  wholesale_group public.wholesale_group,
  check (line_total_cents = unit_price_cents * quantity)
);
create index on public.order_items (order_id);

create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  method text not null,
  status text not null check (status in ('pending','awaiting_validation','approved','rejected','cancelled')),
  amount_cents bigint not null,
  provider_ref text,
  receipt_storage_path text,                  -- comprobante de transferencia (bucket privado)
  validated_by uuid references auth.users(id),
  validated_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);
create index on public.payment_attempts (order_id);

create table public.shipping_quotes (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid references public.carts(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  destination jsonb not null,
  options jsonb not null,
  moto_unavailable_reason text,
  correo_error text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes'
);

-- ---------------------------------------------------------------------
-- Sincronización y auditoría
-- ---------------------------------------------------------------------
create table public.sync_jobs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  kind text not null default 'catalog',
  dry_run boolean not null,
  trigger text not null,
  status text not null default 'running' check (status in ('running','succeeded','partial','failed')),
  stats jsonb,
  summary jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index on public.sync_jobs (started_at desc);

create table public.sync_errors (
  id bigserial primary key,
  job_id uuid not null references public.sync_jobs(id) on delete cascade,
  sku text,
  source_id text,
  stage text not null,
  code text not null,
  message text not null,
  retryable boolean not null,
  payload_summary jsonb,                      -- resumido, nunca credenciales
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),
  retry_job_id uuid references public.sync_jobs(id),
  created_at timestamptz not null default now()
);
create index on public.sync_errors (job_id);
create index on public.sync_errors (sku) where resolved_at is null;

create table public.audit_logs (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_role text,
  action text not null,                       -- insert|update|delete|login|role_change|...
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  ip inet,
  request_id text
);
create index on public.audit_logs (entity, entity_id, at desc);

create table public.redirects (
  from_path text primary key check (from_path like '/%'),
  to_path text not null,
  status_code smallint not null default 301 check (status_code in (301,302,410)),
  source text not null default 'woo',
  hits bigint not null default 0,
  created_at timestamptz not null default now()
);

-- Auditoría genérica (append-only)
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  v_id := coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id', to_jsonb(new)->>'key', to_jsonb(old)->>'key', to_jsonb(new)->>'product_id');
  insert into public.audit_logs (actor_id, actor_role, action, entity, entity_id, before, after)
  values (auth.uid(), public.current_role_id(), lower(tg_op), tg_table_name, v_id,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

create trigger audit_products after insert or update or delete on public.products for each row execute function public.audit_row();
create trigger audit_prices after insert or update or delete on public.product_prices for each row execute function public.audit_row();
create trigger audit_orders after insert or update or delete on public.orders for each row execute function public.audit_row();
create trigger audit_payments after insert or update on public.payment_attempts for each row execute function public.audit_row();
create trigger audit_settings after insert or update or delete on public.settings for each row execute function public.audit_row();
create trigger audit_wholesale after insert or update or delete on public.wholesale_rules for each row execute function public.audit_row();
create trigger audit_zones after insert or update or delete on public.shipping_zones for each row execute function public.audit_row();
create trigger audit_profiles_role after update of role on public.profiles for each row execute function public.audit_row();

-- ---------------------------------------------------------------------
-- Búsqueda tolerante (tildes, typos, aliases de marca)
-- ---------------------------------------------------------------------
create or replace function public.search_products(q text, max_results int default 48)
returns table (id uuid, sku text, slug text, name text, score real)
language sql stable security invoker set search_path = public as $$
  with term as (select lower(public.f_unaccent(btrim(q))) as t),
  alias as (
    select coalesce(
      (select lower(b.name) from public.brands b, term where term.t = any (b.aliases) limit 1),
      (select t from term)) as t
  )
  select p.id, p.sku, p.slug, p.name,
         greatest(similarity(p.search_text, alias.t), word_similarity(alias.t, p.search_text)) as score
  from public.products p, alias
  where p.status = 'active' and p.sale_mode <> 'hidden'
    and (p.search_text like '%' || alias.t || '%' or alias.t <% p.search_text)
  order by score desc, p.name
  limit least(max_results, 100)
$$;

-- ¿El producto pertenece a alguna categoría oculta? SECURITY DEFINER: anon no puede ver categorías
-- ocultas por RLS, así que un NOT EXISTS evaluado como anon nunca las encontraría (bug detectado en tests).
create or replace function public.product_in_hidden_category(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.product_categories pc join public.categories c on c.id = pc.category_id
    where pc.product_id = pid and c.is_visible = false)
  or exists (
    select 1 from public.products p join public.categories c on c.id = p.primary_category_id
    where p.id = pid and c.is_visible = false)
$$;

-- Vista pública de catálogo: oculta categorías no visibles (Electrónica) y precios ocultos
create or replace view public.catalog_products with (security_invoker = true) as
select p.id, p.sku, p.slug, p.name, p.short_description, p.description, p.brand_id, p.primary_category_id,
       p.sale_mode, p.wholesale_group, p.has_placeholder_image,
       (p.stock_qty > 0) as in_stock,
       case when p.hide_price then null else rp.amount_cents end as retail_price_cents,
       p.seo_title, p.seo_description, p.updated_at
from public.products p
left join public.product_prices rp on rp.product_id = p.id and rp.price_list_id = (select id from public.price_lists where code = 'retail')
where p.status = 'active' and p.sale_mode <> 'hidden'
  and not public.product_in_hidden_category(p.id);
