-- Fichas importadas de WooCommerce: miniatura y srcset tal como los servía WordPress (mismo look en grillas).
-- Las URLs de /wp-content/uploads/ se sirven desde el propio dominio; al migrar el archivo a Storage se llena storage_path.
alter table public.product_images add column if not exists thumb_url text;
alter table public.product_images add column if not exists srcset text;

-- Destacados de Woo ("featured") para las grillas de la home.
alter table public.products add column if not exists featured boolean not null default false;

-- La vista pública expone los campos nuevos que usa la tienda
drop view if exists public.catalog_products;
create view public.catalog_products with (security_invoker = true) as
select p.id, p.sku, p.slug, p.name, p.short_description, p.description, p.brand_id, p.primary_category_id,
       p.sale_mode, p.wholesale_group, p.has_placeholder_image, p.hide_price, p.featured, p.legacy_woo_id,
       (p.stock_qty > 0) as in_stock, p.stock_qty,
       case when p.hide_price then null else rp.amount_cents end as retail_price_cents,
       p.seo_title, p.seo_description, p.updated_at
from public.products p
left join public.product_prices rp on rp.product_id = p.id and rp.price_list_id = (select id from public.price_lists where code = 'retail')
where p.status = 'active' and p.published and p.sale_mode <> 'hidden'
  and not public.product_in_hidden_category(p.id);
grant select on public.catalog_products to anon, authenticated;
