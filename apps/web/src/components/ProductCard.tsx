import Link from "next/link";
import { formatArs, whatsappInquiryUrl } from "@franzebi/domain";
import { absoluteUrl, productUrl, type CatalogProduct } from "@/lib/catalog";
import { AddToCartButton } from "./CartDrawer";

export function ProductCard({ p }: { p: CatalogProduct }) {
  const url = productUrl(p.slug);
  return (
    <li className="card">
      <Link href={url}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={p.image ?? "/placeholder-producto.svg"} alt={p.name} loading="lazy" width={400} height={400} />
      </Link>
      <div className="body">
        <h2><Link href={url} style={{ textDecoration: "none" }}>{p.name}</Link></h2>
        {p.sale_mode === "on_request" ? (
          <>
            <span className="badge">A pedido</span>
            <a className="btn btn-wa" href={whatsappInquiryUrl({ name: p.name, sku: p.sku, url: absoluteUrl(url) })} target="_blank" rel="noopener nofollow">Consultar por WhatsApp</a>
          </>
        ) : (
          <>
            {p.retail_price_cents != null && <span className="price">{formatArs(p.retail_price_cents)}</span>}
            {p.in_stock ? <AddToCartButton sku={p.sku} /> : <span className="badge out">Sin stock</span>}
          </>
        )}
      </div>
    </li>
  );
}
