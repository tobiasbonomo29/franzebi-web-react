import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const site = env().SITE_URL;
  // Staging nunca se indexa
  if (!site.includes("franzebi.ar") || process.env.STAGING === "true") return { rules: [{ userAgent: "*", disallow: "/" }] };
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin/", "/api/", "/carrito/", "/checkout/", "/mi-cuenta/", "/pedido/", "/buscar/"] }],
    sitemap: `${site}/sitemap.xml`,
  };
}
