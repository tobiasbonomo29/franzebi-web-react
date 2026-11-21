import "server-only";
import { cache } from "react";
import { publicClient } from "../supabase";
import type { GalleryImage, LoopProduct } from "./render";

export interface Category {
  id: string;
  parent_id: string | null;
  slug: string;
  name: string;
  path: string;
  legacy_woo_id: number | null;
  h1: string | null;
  seo_title: string | null;
  seo_description: string | null;
}

/** Categorías visibles (RLS oculta Electrónica). Cacheado por request. */
export const allCategories = cache(async (): Promise<Category[]> => {
  const { data, error } = await publicClient().from("categories").select("id,parent_id,slug,name,path,legacy_woo_id,h1,seo_title,seo_description").order("sort_name");
  if (error) throw error;
  return data as Category[];
});

export async function categoryByPath(path: string) {
  const cats = await allCategories();
  const cat = cats.find((c) => c.path === path);
  if (!cat) return null;
  const trail: Category[] = [];
  for (let c: Category | undefined = cat; c; c = cats.find((x) => x.id === c!.parent_id)) trail.unshift(c);
  const subtree = new Set([cat.id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const c of cats) if (c.parent_id && subtree.has(c.parent_id) && !subtree.has(c.id)) { subtree.add(c.id); grew = true; }
  }
  return { cat, trail, subtreeIds: [...subtree] };
}

export async function categoryIdsBySlugs(slugs: string[]) {
  const cats = await allCategories();
  const roots = cats.filter((c) => slugs.includes(c.slug));
  const ids = new Set(roots.map((c) => c.id));
  for (let grew = true; grew; ) {
    grew = false;
    for (const c of cats) if (c.parent_id && ids.has(c.parent_id) && !ids.has(c.id)) { ids.add(c.id); grew = true; }
  }
  return [...ids];
}

interface PageRow {
  id: string; legacy_woo_id: number | null; sku: string; slug: string; name: string; sale_mode: LoopProduct["sale_mode"];
  in_stock: boolean; stock_qty: number; retail_price_cents: number | null; hide_price: boolean;
  thumb_src: string | null; thumb_srcset: string | null; thumb_alt: string | null; cat_slugs: string[] | null; total_count: number;
}

export interface ListQuery {
  categoryIds?: string[] | null;
  search?: string | null;
  orderby?: string;
  minCents?: number | null;
  maxCents?: number | null;
  limit: number;
  offset?: number;
}

export async function listProducts(q: ListQuery): Promise<{ items: LoopProduct[]; total: number }> {
  const { data, error } = await publicClient().rpc("catalog_page", {
    p_category_ids: q.categoryIds ?? null,
    p_search: q.search ?? null,
    p_orderby: q.orderby ?? "menu_order",
    p_min_cents: q.minCents ?? null,
    p_max_cents: q.maxCents ?? null,
    p_limit: q.limit,
    p_offset: q.offset ?? 0,
  });
  if (error) throw error;
  const rows = (data ?? []) as PageRow[];
  return {
    total: rows[0]?.total_count ?? 0,
    items: rows.map((r) => ({
      id: r.id, legacy_woo_id: r.legacy_woo_id, sku: r.sku, slug: r.slug, name: r.name, sale_mode: r.sale_mode, in_stock: r.in_stock,
      stock_qty: r.stock_qty, retail_price_cents: r.retail_price_cents, hide_price: r.hide_price,
      thumb: r.thumb_src ? { src: r.thumb_src, srcset: r.thumb_srcset, alt: r.thumb_alt } : null,
      catSlugs: r.cat_slugs ?? [],
    })),
  };
}

export async function priceRange(categoryIds: string[] | null) {
  const { data } = await publicClient().rpc("catalog_price_range", { p_category_ids: categoryIds });
  const r = (data as Array<{ min_cents: number | null; max_cents: number | null }> | null)?.[0];
  return { min: (r?.min_cents ?? 0) / 100, max: (r?.max_cents ?? 0) / 100 };
}

export interface ProductDetail extends LoopProduct {
  description: string | null;
  short_description: string | null;
  seo_title: string | null;
  seo_description: string | null;
  primary_category_id: string | null;
  images: GalleryImage[];
}

export const productBySlug = cache(async (slug: string): Promise<ProductDetail | null> => {
  const sb = publicClient();
  const { data, error } = await sb.from("catalog_products").select("*").eq("slug", slug).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const [{ data: imgs }, { data: links }] = await Promise.all([
    sb.from("product_images").select("source_url, storage_path, srcset, alt, thumb_url, status, position").eq("product_id", data.id).eq("status", "ok").order("position"),
    sb.from("product_categories").select("categories(slug)").eq("product_id", data.id),
  ]);
  const storage = (p: string) => `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/product-images/${p}`;
  const images: GalleryImage[] = (imgs ?? []).map((i) => ({
    src: i.storage_path ? storage(i.storage_path) : i.source_url,
    srcset: i.storage_path ? null : i.srcset,
    alt: i.alt,
    thumb: i.thumb_url,
  }));
  return {
    ...(data as Omit<ProductDetail, "images" | "thumb" | "catSlugs">),
    images,
    thumb: images[0] ? { src: images[0].thumb ?? images[0].src, srcset: null, alt: images[0].alt } : null,
    catSlugs: ((links ?? []) as unknown as Array<{ categories: { slug: string } | null }>).map((l) => l.categories?.slug).filter(Boolean) as string[],
  };
});

export async function settingValue<T>(key: string): Promise<T | null> {
  const { data } = await publicClient().from("settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as T) ?? null;
}
