import type { Metadata } from "next";
import { JsonLd } from "@/components/JsonLd";
import { publicClient } from "@/lib/supabase";

export const metadata: Metadata = { title: "Preguntas frecuentes", alternates: { canonical: "/faq/" } };

/**
 * El contenido de FAQs se carga desde settings.faq (editable por admin). NO se hardcodea el texto actual de WordPress
 * porque contradice reglas vigentes (crypto 10%, corte 11:30, mayorista por unidades, tecnología): ver D-03, D-04, D-13.
 */
export default async function Faq() {
  const { data } = await publicClient().from("settings").select("value").eq("key", "faq").maybeSingle();
  const items = ((data?.value as { items?: Array<{ q: string; a: string }> } | null)?.items ?? []).filter((i) => i.q && i.a);
  return (
    <div className="container" style={{ maxWidth: 820 }}>
      <h1>Preguntas frecuentes</h1>
      {items.length === 0 ? <p className="notice warn">Contenido pendiente de aprobación.</p> : items.map((i) => (
        <details key={i.q} style={{ borderBottom: "1px solid var(--fz-line)", padding: ".75rem 0" }}>
          <summary style={{ fontWeight: 700, cursor: "pointer" }}>{i.q}</summary>
          <p style={{ whiteSpace: "pre-line" }}>{i.a}</p>
        </details>
      ))}
      {items.length > 0 && <JsonLd data={{ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: items.map((i) => ({ "@type": "Question", name: i.q, acceptedAnswer: { "@type": "Answer", text: i.a } })) }} />}
    </div>
  );
}
