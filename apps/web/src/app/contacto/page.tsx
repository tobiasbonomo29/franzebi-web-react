import type { Metadata } from "next";
import { LegacyPage } from "@/components/LegacyPage";
import { template } from "@/lib/legacy/templates";

export const metadata: Metadata = { title: { absolute: template("contacto").title }, alternates: { canonical: "/contacto/" } };

/** Contacto (Elementor 16689). El formulario se envía a /api/contacto/ (fz.js) y llega a Franzebi.imports@gmail.com. */
export default function Contacto() {
  return <LegacyPage name="contacto" />;
}
