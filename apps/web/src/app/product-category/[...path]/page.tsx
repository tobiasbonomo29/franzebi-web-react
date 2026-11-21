import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd, breadcrumbLd } from "@/components/JsonLd";
import { LegacyPage } from "@/components/LegacyPage";
import { absoluteUrl } from "@/lib/catalog";
import { archiveValues, splitPaged, type SearchParams } from "@/lib/legacy/archive";
import { categoryByPath } from "@/lib/legacy/store";
import { template } from "@/lib/legacy/templates";

type Props = { params: Promise<{ path: string[] }>; searchParams: Promise<SearchParams> };

const catUrl = (path: string) => `/product-category/${path}/`;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { segments, page } = splitPaged((await params).path);
  const r = await categoryByPath(segments.join("/"));
  if (!r) return {};
  return {
    title: { absolute: `${r.cat.seo_title ?? r.cat.name}${page > 1 ? ` – Página ${page}` : ""} – Franzebi Imports – Los Mejores Precios` },
    description: r.cat.seo_description ?? `Comprá ${r.cat.name} originales en Franzebi Imports. Envíos en el día en CABA/GBA y a todo el país.`,
    alternates: { canonical: catUrl(r.cat.path) + (page > 1 ? `page/${page}/` : "") },
  };
}

/** Archivo de categoría con la plantilla Elementor 706 (misma URL que Woo, incluida /page/N/). */
export default async function CategoryPage({ params, searchParams }: Props) {
  const [{ path }, sp] = await Promise.all([params, searchParams]);
  const { segments, page } = splitPaged(path);
  const r = await categoryByPath(segments.join("/"));
  if (!r) notFound(); // categorías ocultas (Electrónica) no existen para el público
  const crumbs = r.trail.map((c, i) => (i === r.trail.length - 1 ? { name: c.name } : { name: c.name, href: catUrl(c.path) }));
  const { values, pages } = await archiveValues({
    title: r.cat.h1 ?? r.cat.name,
    crumbs,
    categoryIds: r.subtreeIds,
    page,
    sp,
    pageHref: (n) => catUrl(r.cat.path) + (n > 1 ? `page/${n}/` : ""),
  });
  if (page > pages) notFound();
  const bodyClass = `archive tax-product_cat term-${r.cat.slug} ${r.cat.legacy_woo_id ? `term-${r.cat.legacy_woo_id} ` : ""}`;
  const base = template("category").bodyClass.replace(/\barchive tax-product_cat term-\S+ term-\d+ /, "");
  return (
    <LegacyPage name="category" values={values} bodyClass={bodyClass + base}>
      <JsonLd data={breadcrumbLd([{ name: "Inicio", url: absoluteUrl("/") }, ...r.trail.map((c) => ({ name: c.name, url: absoluteUrl(catUrl(c.path)) }))])} />
    </LegacyPage>
  );
}
