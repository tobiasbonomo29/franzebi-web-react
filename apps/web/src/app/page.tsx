import type { Metadata } from "next";
import { LegacyPage } from "@/components/LegacyPage";
import { env } from "@/lib/env";
import { SearchResults } from "@/components/SearchResults";
import type { SearchParams } from "@/lib/legacy/archive";
import { productGrid } from "@/lib/legacy/render";
import { categoryByPath, listProducts } from "@/lib/legacy/store";
import { template } from "@/lib/legacy/templates";

/**
 * Home de franzebi.ar (página Elementor 16691) + búsqueda de WordPress (/?s=term&post_type=product).
 * Grillas, igual que los widgets "Products" de Elementor en WP:
 *   0,1 "Especial Verano" / "Recomendaciones": 12 más recientes (3 columnas)
 *   2..5 pestañas "Productos Destacados": Árabes / Masculinas / Femeninas / Kids, 20 por título A-Z (5 columnas)
 *   6 "Nuevos Ingresos": 20 más recientes (5 columnas)
 */
const GRIDS: Array<{ columns: number; limit: number; orderby: string; paths?: string[] }> = [
  { columns: 3, limit: 12, orderby: "date" },
  { columns: 3, limit: 12, orderby: "date" },
  { columns: 5, limit: 20, orderby: "menu_order", paths: ["perfumeria/fragancias-masculinas/arabes-masculinas", "perfumeria/fragancias-femeninas/arabes-femeninas"] },
  { columns: 5, limit: 20, orderby: "menu_order", paths: ["perfumeria/fragancias-masculinas"] },
  { columns: 5, limit: 20, orderby: "menu_order", paths: ["perfumeria/fragancias-femeninas"] },
  { columns: 5, limit: 20, orderby: "menu_order", paths: ["perfumeria/fragancias-kids"] },
  { columns: 5, limit: 20, orderby: "date" },
];

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParams> }): Promise<Metadata> {
  const s = one((await searchParams).s);
  if (s != null) return { title: { absolute: `Resultados de la búsqueda de «${s}» – Franzebi Imports – Los Mejores Precios` }, robots: { index: false } };
  return { title: { absolute: template("home").title }, alternates: { canonical: "/" } };
}

export default async function Home({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const s = one(sp.s);
  if (s != null) return <SearchResults sp={sp} term={s} page={1} />;

  const site = env().SITE_URL;
  const values: Record<string, string> = {};
  await Promise.all(
    GRIDS.map(async (g, i) => {
      let ids: string[] | null = null;
      if (g.paths) {
        const found = await Promise.all(g.paths.map((p) => categoryByPath(p)));
        ids = found.flatMap((f) => f?.subtreeIds ?? []);
      }
      const { items } = await listProducts({ categoryIds: ids, orderby: g.orderby, limit: g.limit });
      values[`grid:${i}`] = productGrid(items, g.columns, site);
    }),
  );
  return <LegacyPage name="home" values={values} />;
}
