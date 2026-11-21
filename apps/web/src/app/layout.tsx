import type { Metadata, Viewport } from "next";
import { JsonLd } from "@/components/JsonLd";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: new URL(env().SITE_URL),
    // Mismo título que WordPress: "<página> – Franzebi Imports – Los Mejores Precios"
    title: { default: "Franzebi Imports – Los Mejores Precios", template: "%s – Franzebi Imports – Los Mejores Precios" },
    description: "Perfumería importada en Argentina: fragancias árabes, de diseñador y decants. Envíos en el día en CABA y GBA y a todo el país por Correo Argentino.",
    openGraph: { siteName: "Franzebi Imports", locale: "es_AR", type: "website" },
    icons: {
      icon: [{ url: "/wp-content/uploads/2026/11/cropped-franzebi-favicon-B-morado-32x32.png", sizes: "32x32" }, { url: "/wp-content/uploads/2026/11/cropped-franzebi-favicon-B-morado-192x192.png", sizes: "192x192" }],
      apple: "/wp-content/uploads/2026/11/cropped-franzebi-favicon-B-morado-180x180.png",
    },
  };
}

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0B0B0B" };

/**
 * Layout mínimo: la tienda usa el diseño heredado (LegacyPage) y el admin sus propios estilos.
 * suppressHydrationWarning: Elementor/VamTam modifican clases de <html>/<body> al iniciar (igual que en WP).
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  const site = env().SITE_URL;
  return (
    <html lang="es-AR" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      </head>
      <body suppressHydrationWarning>
        {children}
        <JsonLd data={{ "@context": "https://schema.org", "@type": "Organization", name: "Franzebi Imports", url: site, email: "franzebi.imports@gmail.com", telephone: "+54 9 11 2872-0954", sameAs: ["https://www.instagram.com/franzebi.imports/"] }} />
      </body>
    </html>
  );
}
