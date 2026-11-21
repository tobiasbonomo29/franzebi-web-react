import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd, breadcrumbLd } from "@/components/JsonLd";
import { ProductCard } from "@/components/ProductCard";
import { PAGE_SIZE, absoluteUrl, categoryUrl, getCategoryByPath, listProductsInCategories, productUrl } from "@/lib/catalog";

type Props = { params: Promise<{ path: string[] }>; searchParams: Promise<{ page?: string }> };

const pageOf = (s?: string) => Math.max(1, Math.min(500, Number.parseInt(s ?? "1", 10) || 1));

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { path } = await params;
  const page = pageOf((await searchParams).page);
  const r = await getCategoryByPath(path.join("/"));
  if (!r) return {};
  const canonical = categoryUrl(r.cat.path) + (page > 1 ? `?page=${page}` : "");
  return {
    title: r.cat.seo_title ?? `${r.cat.name}${page > 1 ? ` — página ${page}` : ""}`,
    description: r.cat.seo_description ?? `Comprá ${r.cat.name} originales en Franzebi Imports. Envíos en el día en CABA/GBA y a todo el país.`,
    alternates: { canonical },
  };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { path } = await params;
  const page = pageOf((await searchParams).page);
  const r = await getCategoryByPath(path.join("/"));
  if (!r) notFound(); // categorías ocultas (Electrónica) no existen para el público
  const { products, total } = await listProductsInCategories(r.subtreeIds, page);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (page > pages) notFound();
  const crumbs = [{ name: "Inicio", url: absoluteUrl("/") }, ...r.trail.map((c) => ({ name: c.name, url: absoluteUrl(categoryUrl(c.path)) }))];

  return (
    <div className="container">
      <nav className="breadcrumbs" aria-label="Migas de pan">
        <Link href="/">Inicio</Link>{r.trail.map((c) => <span key={c.id}> / <Link href={categoryUrl(c.path)}>{c.name}</Link></span>)}
      </nav>
      <h1>{r.cat.h1 ?? r.cat.name}</h1>
      {r.children.length > 0 && (
        <ul className="subcats">{r.children.map((c) => <li key={c.id}><Link href={categoryUrl(c.path)}>{c.name}</Link></li>)}</ul>
      )}
      {products.length === 0 ? (
        <p className="notice">Por el momento no hay productos publicados en esta categoría. <a href="https://wa.me/5491128720954">Consultanos por WhatsApp</a>.</p>
      ) : (
        <ul className="grid">{products.map((p) => <ProductCard key={p.id} p={p} />)}</ul>
      )}
      {pages > 1 && (
        <nav className="pager" aria-label="Paginación">
          {Array.from({ length: pages }, (_, i) => i + 1).map((n) =>
            n === page ? <span key={n} aria-current="page">{n}</span> : <Link key={n} href={categoryUrl(r.cat.path) + (n > 1 ? `?page=${n}` : "")}>{n}</Link>,
          )}
        </nav>
      )}
      <JsonLd data={breadcrumbLd(crumbs)} />
      <JsonLd data={{ "@context": "https://schema.org", "@type": "ItemList", itemListElement: products.map((p, i) => ({ "@type": "ListItem", position: (page - 1) * PAGE_SIZE + i + 1, url: absoluteUrl(productUrl(p.slug)), name: p.name })) }} />
    </div>
  );
}
