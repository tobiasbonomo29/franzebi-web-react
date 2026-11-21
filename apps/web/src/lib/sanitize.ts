/**
 * Sanitizado por allowlist para descripciones de producto migradas de WooCommerce.
 * Sólo deja etiquetas de formato básicas y elimina TODOS los atributos excepto href http(s) en <a>.
 */
const ALLOWED = new Set(["p", "br", "strong", "b", "em", "i", "ul", "ol", "li", "h2", "h3", "h4", "a", "span"]);

export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<(script|style|iframe|object|embed|noscript|template)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (m, tag: string, attrs: string) => {
      const t = tag.toLowerCase();
      if (!ALLOWED.has(t)) return "";
      if (m.startsWith("</")) return `</${t}>`;
      if (t === "a") {
        const href = attrs.match(/href\s*=\s*"(https?:\/\/[^"]*)"/i)?.[1];
        return href ? `<a href="${href.replace(/"/g, "&quot;")}" rel="noopener nofollow">` : "<a>";
      }
      return `<${t}>`;
    });
}
