import type { Metadata } from "next";
import { ProductCard } from "@/components/ProductCard";
import { searchProducts } from "@/lib/catalog";

export const metadata: Metadata = { title: "Búsqueda", robots: { index: false, follow: true } };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? "").slice(0, 100);
  const r = q ? await searchProducts(q) : null;
  return (
    <div className="container">
      <h1>{q ? `Resultados para «${q}»` : "Buscar productos"}</h1>
      {r && r.query.corrections.length > 0 && (
        <p className="notice">Mostrando resultados para <strong>{r.query.rewritten}</strong></p>
      )}
      {r && r.products.length === 0 && <p>No encontramos productos. Probá con otra marca o nombre.</p>}
      {r && <ul className="grid">{r.products.map((p) => <ProductCard key={p.id} p={p} />)}</ul>}
    </div>
  );
}
