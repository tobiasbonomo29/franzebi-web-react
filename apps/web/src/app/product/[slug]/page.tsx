import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatArs, whatsappInquiryUrl } from "@franzebi/domain";
import { AddToCartButton } from "@/components/CartDrawer";
import { JsonLd, breadcrumbLd } from "@/components/JsonLd";
import { sanitizeHtml } from "@/lib/sanitize";
import { absoluteUrl, categoryUrl, getProductBySlug, listCategories, productUrl } from "@/lib/catalog";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const r = await getProductBySlug((await params).slug);
  if (!r) return {};
  const p = r.product;
  return {
    title: p.seo_title ?? p.name,
    description: p.seo_description ?? (p.short_description?.replace(/<[^>]+>/g, "").slice(0, 155) || `${p.name} original. Comprá en Franzebi Imports con envío en el día en CABA/GBA.`),
    alternates: { canonical: productUrl(p.slug) },
    openGraph: { images: r.images[0]?.url ? [r.images[0].url] : [] },
  };
}

export default async function ProductPage({ params }: Props) {
  const r = await getProductBySlug((await params).slug);
  if (!r) notFound();
  const p = r.product;
  const cats = await listCategories();
  const trail = [];
  for (let c = cats.find((x) => x.id === p.primary_category_id); c; c = cats.find((x) => x.id === c!.parent_id)) trail.unshift(c);
  const url = absoluteUrl(productUrl(p.slug));
  const onRequest = p.sale_mode === "on_request";
  const showPrice = p.retail_price_cents != null && !onRequest;

  return (
    <div className="container">
      <nav className="breadcrumbs" aria-label="Migas de pan">
        <Link href="/">Inicio</Link>{trail.map((c) => <span key={c.id}> / <Link href={categoryUrl(c.path)}>{c.name}</Link></span>)}
      </nav>
      <div className="pdp">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={r.images[0]?.url ?? "/placeholder-producto.svg"} alt={r.images[0]?.alt ?? p.name} width={r.images[0]?.width ?? 800} height={r.images[0]?.height ?? 800} />
        </div>
        <div>
          <h1>{p.name}</h1>
          <p><small>SKU: {p.sku}</small></p>
          {showPrice && <p className="price" style={{ fontSize: "1.5rem" }}>{formatArs(p.retail_price_cents!)}</p>}
          {onRequest ? (
            <div className="notice">
              <p>Producto disponible <strong>a pedido</strong>. Consultanos disponibilidad y precio.</p>
              <a className="btn btn-wa" href={whatsappInquiryUrl({ name: p.name, sku: p.sku, url })} target="_blank" rel="noopener nofollow">Consultar por WhatsApp</a>
            </div>
          ) : p.in_stock ? (
            <AddToCartButton sku={p.sku} />
          ) : (
            <p className="badge out">Sin stock</p>
          )}
          {p.description && <div style={{ marginTop: "1.5rem" }} dangerouslySetInnerHTML={{ __html: sanitizeHtml(p.description) }} />}
        </div>
      </div>
      <JsonLd data={breadcrumbLd([{ name: "Inicio", url: absoluteUrl("/") }, ...trail.map((c) => ({ name: c.name, url: absoluteUrl(categoryUrl(c.path)) })), { name: p.name, url }])} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Product",
          name: p.name,
          sku: p.sku,
          image: r.images.map((i) => i.url),
          url,
          brand: trail.at(-1) ? { "@type": "Brand", name: trail.at(-1)!.name.split(" – ")[0] } : undefined,
          // Offer sólo si hay precio público (diseñador con precio oculto no publica Offer)
          offers: showPrice
            ? { "@type": "Offer", priceCurrency: "ARS", price: (p.retail_price_cents! / 100).toFixed(2), availability: p.in_stock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock", url }
            : undefined,
        }}
      />
    </div>
  );
}
