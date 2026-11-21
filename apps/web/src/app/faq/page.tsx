import type { Metadata } from "next";
import { JsonLd } from "@/components/JsonLd";
import { LegacyPage } from "@/components/LegacyPage";
import { faqToggle } from "@/lib/legacy/render";
import { settingValue } from "@/lib/legacy/store";
import { template } from "@/lib/legacy/templates";

export const metadata: Metadata = { title: { absolute: template("faq").title }, alternates: { canonical: "/faq/" } };

/**
 * Página FAQ de WP (Elementor 16686) con el mismo toggle. El texto sale de settings.faq (editable en admin),
 * aprobado por el dueño (D-13): reemplaza el de WP, que contradecía reglas vigentes (crypto 10%, mayorista por unidades).
 */
export default async function Faq() {
  const items = ((await settingValue<{ items?: Array<{ q: string; a: string }> }>("faq"))?.items ?? []).filter((i) => i.q && i.a);
  return (
    <LegacyPage name="faq" values={{ faq: faqToggle(items) }}>
      <JsonLd data={{ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: items.map((i) => ({ "@type": "Question", name: i.q, acceptedAnswer: { "@type": "Answer", text: i.a } })) }} />
    </LegacyPage>
  );
}
