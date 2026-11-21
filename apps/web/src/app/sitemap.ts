import type { MetadataRoute } from "next";
import { absoluteUrl, categoryUrl, listCategories, productUrl } from "@/lib/catalog";
import { publicClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** Sólo URLs indexables y visibles (sin Electrónica, carrito, checkout, cuenta ni búsqueda). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [cats, prods] = await Promise.all([
    listCategories(),
    (async () => {
      const out: Array<{ slug: string; updated_at: string }> = [];
      for (let from = 0; ; from += 1000) {
        const { data } = await publicClient().from("catalog_products").select("slug, updated_at").range(from, from + 999);
        out.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      return out;
    })(),
  ]);
  return [
    { url: absoluteUrl("/"), changeFrequency: "daily", priority: 1 },
    { url: absoluteUrl("/faq/") },
    { url: absoluteUrl("/contacto/") },
    ...cats.map((c) => ({ url: absoluteUrl(categoryUrl(c.path)), changeFrequency: "daily" as const, priority: 0.7 })),
    ...prods.map((p) => ({ url: absoluteUrl(productUrl(p.slug)), lastModified: p.updated_at, priority: 0.6 })),
  ];
}
