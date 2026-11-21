import Link from "next/link";
import { categoryUrl, listCategories } from "@/lib/catalog";

export const metadata = { alternates: { canonical: "/" } };

export default async function Home() {
  const cats = await listCategories(); // RLS ya excluye Electrónica y ocultas
  const roots = ["perfumeria/fragancias-masculinas", "perfumeria/fragancias-femeninas", "perfumeria/fragancias-kids"];
  // Destacadas: sólo categorías visibles, marcadas como destacadas y que existen (nunca electrónica/monopatines/periféricos/cosmética inactiva)
  const featured = cats.filter((c) => c.is_featured);
  const sections = roots.map((p) => cats.find((c) => c.path === p)).filter(Boolean);
  return (
    <>
      <section className="hero">
        <div className="container">
          {/* H1 único y sin "Electrónica" (hoy el H1 de WP la menciona) */}
          <h1>Franzebi Imports — Perfumería árabe, de diseñador y decants</h1>
          <p>Envíos en el día en CABA y GBA · Correo Argentino a todo el país · Precios mayoristas</p>
        </div>
      </section>
      <div className="container">
        <h2>Categorías</h2>
        <ul className="subcats">
          {sections.map((c) => <li key={c!.id}><Link href={categoryUrl(c!.path)}>{c!.name}</Link></li>)}
          {featured.map((c) => <li key={c.id}><Link href={categoryUrl(c.path)}>{c.name}</Link></li>)}
        </ul>
      </div>
    </>
  );
}
