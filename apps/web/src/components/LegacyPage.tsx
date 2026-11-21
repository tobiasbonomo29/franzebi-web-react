import { LegacyBoot } from "@/components/LegacyBoot";
import { fill, shell, template, type TemplateName } from "@/lib/legacy/templates";

/**
 * Página con el diseño heredado de franzebi.ar: mismo <body class>, mismos estilos (en el mismo orden),
 * mismo markup de header/contenido/footer y mismos scripts de Elementor/VamTam (menú, sticky, carruseles,
 * pestañas, toggles, contador). Los datos (productos, precios, carrito) los completa la app.
 *
 * Seguridad: el HTML de las plantillas es propio (capturado y limpiado de scripts/handlers en
 * scripts/mirror-legacy.mjs); todo dato dinámico se escapa en lib/legacy/render.ts.
 */
export function LegacyPage({
  name,
  values = {},
  bodyClass,
  children,
}: {
  name: TemplateName;
  values?: Record<string, string>;
  bodyClass?: string;
  children?: React.ReactNode;
}) {
  const t = template(name);
  const cls = `${bodyClass ?? t.bodyClass} fz-app`;
  const html = [t.before, shell.header, fill(t.main, values), shell.footer, t.after, shell.searchPopup].join("\n");

  // Scripts en el orden original: cada inline va después del script externo que lo precedía en WP
  const scripts: React.ReactNode[] = [];
  const order: Array<{ src: string } | { code: string }> = [];
  const inlineAfter = (src: string | null) =>
    t.inlineScripts.filter((s) => s.after === src).forEach((s, i) => {
      scripts.push(<script key={`i-${src}-${i}`} dangerouslySetInnerHTML={{ __html: s.code }} />);
      order.push({ code: s.code });
    });
  inlineAfter(null);
  for (const src of t.scripts) {
    scripts.push(<script key={src} src={src} />);
    order.push({ src });
    inlineAfter(src);
  }
  order.push({ src: "/legacy/fz.js" });

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: `document.body.className=${JSON.stringify(cls)};window.__fzSSR=1;` }} />
      {t.styles.map((s) => (
        <link key={s.href} rel="stylesheet" href={s.href} media={s.media} precedence="legacy" />
      ))}
      <link rel="stylesheet" href="/legacy/fz.css" precedence="legacy" />
      <div id="fz-legacy" style={{ display: "contents" }} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: html }} />
      {children}
      {scripts}
      <script src="/legacy/fz.js" />
      <LegacyBoot bodyClass={cls} items={order} />
    </>
  );
}
