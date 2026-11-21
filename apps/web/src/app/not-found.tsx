import { LegacyPage } from "@/components/LegacyPage";

export const metadata = { title: { absolute: "Página no encontrada – Franzebi Imports – Los Mejores Precios" }, robots: { index: false } };

/** 404 con la plantilla de WP (Elementor 10944). */
export default function NotFound() {
  return <LegacyPage name="not_found" />;
}
