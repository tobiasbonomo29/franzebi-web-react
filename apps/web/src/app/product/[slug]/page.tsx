import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd, breadcrumbLd } from "@/components/JsonLd";
import { LegacyPage } from "@/components/LegacyPage";
import { absoluteUrl } from "@/lib/catalog";
import { env } from "@/lib/env";
import { breadcrumb, esc, gallery, productGrid, productUrl, singleAddToCart, wcPrice } from "@/lib/legacy/render";
import { allCategories, listProducts, productBySlug } from "@/lib/legacy/store";
import { template } from "@/lib/legacy/templates";
import { sanitizeHtml } from "@/lib/sanitize";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await productBySlug((await params).slug);
  if (!p) return {};
  return {
    title: { absolute: `${p.seo_title ?? p.name} – Franzebi Imports – Los Mejores Precios` },
    description: p.seo_description ?? `${p.name} original. Comprá en Franzebi Imports con envío en el día en CABA/GBA.`,
    alternates: { canonical: productUrl(p.slug) },
    openGraph: { images: p.images[0] ? [absoluteUrl(p.images[0].src)] : [] },
  };
}

/** Ficha de producto con la plantilla Elementor 614 de WP. */
export default async function ProductPage({ params }: Props) {
  const p = await productBySlug((await params).slug);
  if (!p) notFound();
  const site = env().SITE_URL;
  const cats = await allCategories();
  const trail = [];
  for (let c = cats.find((x) => x.id === p.primary_category_id); c; c = cats.find((x) => x.id === c!.parent_id)) trail.unshift(c);

  // "Podría Interesarte": misma categoría principal (como los relacionados de Woo), 16 productos
  const related = p.primary_category_id
    ? (await listProducts({ categoryIds: [p.primary_category_id], limit: 17 })).items.filter((x) => x.id !== p.id).slice(0, 16)
    : [];

  const id = p.legacy_woo_id ?? 0;
  const purchasable = p.sale_mode === "purchasable" && p.retail_price_cents != null;
  const classes = [
    `post-${id} product type-product status-publish`,
    p.images.length ? "has-post-thumbnail" : "",
    ...(p.catSlugs ?? []).map((c) => `product_cat-${esc(c)}`),
    "first",
    p.in_stock ? "instock" : "outofstock",
    "shipping-taxable",
    purchasable ? "purchasable" : "",
    "product-type-simple product",
  ].filter(Boolean).join(" ");

  const values = {
    "product-classes": classes,
    breadcrumb: breadcrumb([...trail.map((c) => ({ name: c.name, href: `/product-category/${c.path}/` })), { name: p.name }]),
    gallery: gallery(p.images, p.name),
    title: esc(p.name),
    sku: esc(p.sku),
    price: `<p class="price">${p.retail_price_cents != null && !p.hide_price && p.sale_mode !== "on_request" ? wcPrice(p.retail_price_cents) : ""}</p>`,
    description: `<div class="vgblk-rw-wrapper limit-wrapper">${sanitizeHtml(p.description ?? p.short_description ?? "")}</div>`,
    "add-to-cart": singleAddToCart(p, site),
    related: productGrid(related, 4, site),
  };
  const base = template("product").bodyClass.replace(/\bpostid-\d+\b/, `postid-${id}`);
  const url = absoluteUrl(productUrl(p.slug));
  return (
    <LegacyPage name="product" values={values} bodyClass={base}>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Product",
          name: p.name,
          sku: p.sku,
          url,
          image: p.images.map((i) => absoluteUrl(i.src)),
          ...(p.retail_price_cents != null && !p.hide_price && p.sale_mode !== "on_request"
            ? { offers: { "@type": "Offer", priceCurrency: "ARS", price: (p.retail_price_cents / 100).toFixed(2), availability: p.in_stock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock", url } }
            : {}),
        }}
      />
      <JsonLd data={breadcrumbLd([{ name: "Inicio", url: absoluteUrl("/") }, ...trail.map((c) => ({ name: c.name, url: absoluteUrl(`/product-category/${c.path}/`) }))])} />
    </LegacyPage>
  );
}
