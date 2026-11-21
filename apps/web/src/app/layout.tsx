import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import "./globals.css";
import { CartProvider } from "@/components/CartDrawer";
import { Header } from "@/components/Header";
import { JsonLd } from "@/components/JsonLd";
import { Preloader } from "@/components/Preloader";
import { ScrollToTopOnNav } from "@/components/ScrollToTopOnNav";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: new URL(env().SITE_URL),
    title: { default: "Franzebi Imports — Perfumes árabes, de diseñador y decants", template: "%s | Franzebi Imports" },
    description: "Perfumería importada en Argentina: fragancias árabes, de diseñador y decants. Envíos en el día en CABA y GBA y a todo el país por Correo Argentino.",
    openGraph: { siteName: "Franzebi Imports", locale: "es_AR", type: "website" },
    icons: { icon: "/favicon.svg" },
  };
}

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0B0B0B" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const site = env().SITE_URL;
  return (
    <html lang="es-AR" className="no-js">
      <body>
        <Preloader />
        <CartProvider>
          <Header />
          <Suspense><ScrollToTopOnNav /></Suspense>
          <main id="contenido">{children}</main>
          <footer className="site-footer">
            <div className="container">
              <p><strong>Franzebi Imports</strong> · <a href="mailto:franzebi.imports@gmail.com">franzebi.imports@gmail.com</a> · <a href="https://wa.me/5491128720954" rel="noopener">+54 9 11 2872-0954</a> · <a href="https://www.instagram.com/franzebi.imports/" rel="noopener">@franzebi.imports</a></p>
              <p><small>© {new Date().getFullYear()} Franzebi Imports. Todos los derechos reservados.</small></p>
            </div>
          </footer>
        </CartProvider>
        <JsonLd data={{ "@context": "https://schema.org", "@type": "Organization", name: "Franzebi Imports", url: site, email: "franzebi.imports@gmail.com", telephone: "+54 9 11 2872-0954", sameAs: ["https://www.instagram.com/franzebi.imports/"] }} />
      </body>
    </html>
  );
}
