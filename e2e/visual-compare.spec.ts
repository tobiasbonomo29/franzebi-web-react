import { test } from "@playwright/test";

/**
 * @visual — Captura las mismas páginas en WordPress (LEGACY_BASE_URL, sólo GET) y en staging,
 * para revisión lado a lado (test-results/visual/). No compara píxel a píxel: los layouts cambian a propósito
 * (correcciones responsive); sirve para validar marca, jerarquía y contenido.
 */
const PAGES = [
  ["home", "/"],
  ["masculinas", "/product-category/perfumeria/fragancias-masculinas/"],
  ["arabes-masc", "/product-category/perfumeria/fragancias-masculinas/arabes-masculinas/"],
  ["disenador-producto", "/product/ysl-mon-paris-edp-90ml/"],
  ["carrito", "/carrito/"],
  ["faq", "/faq/"],
] as const;

for (const [name, path] of PAGES) {
  test(`@visual ${name}`, async ({ page, browserName }, info) => {
    const legacy = process.env.LEGACY_BASE_URL;
    test.skip(!legacy, "LEGACY_BASE_URL no definido");
    const dir = `test-results/visual/${info.project.name}`;
    await page.goto(new URL(path, legacy).toString(), { waitUntil: "networkidle" });
    await page.screenshot({ path: `${dir}/${name}-wordpress.png`, fullPage: true });
    await page.goto(path, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${dir}/${name}-nuevo.png`, fullPage: true });
    void browserName;
  });
}
