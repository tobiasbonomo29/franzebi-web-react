import "server-only";
import { rewriteSearchQuery } from "@franzebi/domain";
import { env } from "./env";
import { publicClient } from "./supabase";

export interface CategoryNode {
  id: string;
  parent_id: string | null;
  slug: string;
  name: string;
  path: string;
  h1: string | null;
  seo_title: string | null;
  seo_description: string | null;
  is_featured: boolean;
  show_in_menu: boolean;
}

export interface CatalogProduct {
  id: string;
  sku: string;
  slug: string;
  name: string;
  short_description: string | null;
  description: string | null;
  sale_mode: "purchasable" | "on_request" | "hidden";
  in_stock: boolean;
  retail_price_cents: number | null;
  has_placeholder_image: boolean;
  primary_category_id: string | null;
  seo_title: string | null;
  seo_description: string | null;
  updated_at: string;
  image?: string | null;
}

export const PAGE_SIZE = 24;

export function categoryUrl(path: string) {
  return `/product-category/${path}/`;
}
export function productUrl(slug: string) {
  return `/product/${slug}/`;
}
export function absoluteUrl(path: string) {
  return new URL(path, env().SITE_URL).toString();
}
export function imageUrl(storagePath: string | null | undefined) {
  if (!storagePath) return "/placeholder-producto.svg";
  return `${env().NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/product-images/${storagePath}`;
}

/** Categorías visibles (RLS oculta Electrónica), orden alfabético sin tildes. */
export async function listCategories(): Promise<CategoryNode[]> {
  const { data, error } = await publicClient()
    .from("categories")
    .select("id,parent_id,slug,name,path,h1,seo_title,seo_description,is_featured,show_in_menu")
    .order("sort_name");
  if (error) throw error;
  return data as CategoryNode[];
}

export async function getCategoryByPath(path: string) {
  const cats = await listCategories();
  const cat = cats.find((c) => c.path === path) ?? null;
  if (!cat) return null;
  const children = cats.filter((c) => c.parent_id === cat.id);
  const trail: CategoryNode[] = [];
  for (let c: CategoryNode | undefined = cat; c; c = cats.find((x) => x.id === c!.parent_id)) trail.unshift(c);
  // ids de toda la subárbol (para listar productos de subcategorías en la categoría padre)
  const subtree = new Set([cat.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of cats) if (c.parent_id && subtree.has(c.parent_id) && !subtree.has(c.id)) { subtree.add(c.id); grew = true; }
  }
  return { cat, children, trail, subtreeIds: [...subtree] };
}

async function attachImages(products: CatalogProduct[]) {
  if (!products.length) return products;
  const { data } = await publicClient().from("product_images").select("product_id, storage_path, position").in("product_id", products.map((p) => p.id)).eq("position", 0);
  const m = new Map((data ?? []).map((i) => [i.product_id, i.storage_path]));
  return products.map((p) => ({ ...p, image: imageUrl(m.get(p.id)) }));
}

export async function listProductsInCategories(categoryIds: string[], page: number) {
  const sb = publicClient();
  const { data: links, error: e1 } = await sb.from("product_categories").select("product_id").in("category_id", categoryIds);
  if (e1) throw e1;
  const ids = [...new Set((links ?? []).map((l) => l.product_id))];
  if (!ids.length) return { products: [], total: 0 };
  const from = (page - 1) * PAGE_SIZE;
  const { data, error, count } = await sb
    .from("catalog_products")
    .select("*", { count: "exact" })
    .in("id", ids)
    .order("in_stock", { ascending: false })
    .order("name")
    .range(from, from + PAGE_SIZE - 1);
  if (error) throw error;
  return { products: await attachImages(data as CatalogProduct[]), total: count ?? 0 };
}

export async function getProductBySlug(slug: string) {
  const sb = publicClient();
  const { data, error } = await sb.from("catalog_products").select("*").eq("slug", slug).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { data: imgs } = await sb.from("product_images").select("storage_path, alt, width, height, status").eq("product_id", data.id).order("position");
  return { product: data as CatalogProduct, images: (imgs ?? []).map((i) => ({ ...i, url: imageUrl(i.storage_path) })) };
}

export async function searchProducts(q: string) {
  const sb = publicClient();
  const { data: brands } = await sb.from("brands").select("name");
  const rq = rewriteSearchQuery(q, (brands ?? []).map((b) => b.name));
  if (!rq.rewritten) return { query: rq, products: [] as CatalogProduct[] };
  const { data: hits, error } = await sb.rpc("search_products", { q: rq.rewritten, max_results: 48 });
  if (error) throw error;
  const ids = (hits ?? []).map((h: { id: string }) => h.id);
  if (!ids.length) return { query: rq, products: [] };
  const { data } = await sb.from("catalog_products").select("*").in("id", ids);
  const order = new Map<string, number>(ids.map((id: string, i: number) => [id, i] as [string, number]));
  const sorted = ((data ?? []) as CatalogProduct[]).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return { query: rq, products: await attachImages(sorted) };
}
