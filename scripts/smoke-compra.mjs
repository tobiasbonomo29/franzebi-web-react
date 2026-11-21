// Smoke de compra en staging/local: grilla → + cantidad → agregar (AJAX) → mini-carrito → carrito → checkout (retiro + efectivo) → gracias.
// Uso: node scripts/smoke-compra.mjs http://localhost:3100 [carpeta-capturas]   (crea un pedido de prueba; NO usar contra producción)
if (/franzebi.ar/.test(process.argv[2] ?? "")) { console.error("No se corre contra producción (crea un pedido)."); process.exit(2); }
import { chromium } from "@playwright/test";
const base = process.argv[2] ?? "http://localhost:3100";
const out = process.argv[3];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
const step = async (name, fn) => { try { await fn(); console.log("OK  ", name); } catch (e) { console.log("FAIL", name, String(e).split("\n")[0].slice(0, 200)); } };

await step("categoría carga productos", async () => {
  await page.goto(`${base}/product-category/perfumeria/fragancias-masculinas/decants-masculinas/`, { waitUntil: "networkidle" });
  await page.locator("li.product a.add_to_cart_button").first().waitFor({ timeout: 15000 });
});
await step("+ cantidad y agregar al carrito (AJAX, sin recargar)", async () => {
  const li = page.locator("li.product:has(a.add_to_cart_button)").first();
  await li.locator(".qty-btn.plus").click();
  await li.locator("a.add_to_cart_button").click();
  await li.locator("a.added_to_cart").waitFor({ timeout: 15000 });
  const n = await page.locator(".elementor-button-icon-qty").first().textContent();
  if (n?.trim() !== "2") throw new Error(`contador del header = ${n}`);
});
await step("mini-carrito tiene el producto", async () => {
  const html = await page.locator(".widget_shopping_cart_content").first().innerHTML();
  if (!html.includes("woocommerce-mini-cart-item")) throw new Error("mini-carrito vacío");
});
await step("carrito muestra la línea y totales", async () => {
  await page.goto(`${base}/carrito/`, { waitUntil: "networkidle" });
  await page.locator("tr.cart_item").first().waitFor();
  await page.locator(".cart_totals .order-total").waitFor();
  if (out) await page.screenshot({ path: `${out}/flow-cart.png` });
});
await step("checkout: retiro + efectivo => descuento 5%", async () => {
  await page.goto(`${base}/checkout/`, { waitUntil: "networkidle" });
  await page.locator("#shipping_method_0_local_pickup").waitFor({ timeout: 20000 });
  await page.check("#shipping_method_0_local_pickup");
  await page.locator("#payment_method_cash").waitFor({ timeout: 15000 });
  await page.check("#payment_method_cash");
  await page.locator("tr.fee").waitFor({ timeout: 15000 });
  await page.fill("#billing_first_name", "Prueba");
  await page.fill("#billing_last_name", "Staging");
  await page.fill("#billing_dni", "30111222");
  await page.fill("#billing_city", "CABA");
  await page.fill("#billing_postcode", "1414");
  await page.fill("#billing_phone", "1100000000");
  await page.fill("#billing_email", "prueba-staging@example.com");
  if (out) await page.screenshot({ path: `${out}/flow-checkout.png`, fullPage: true });
});
await step("realizar el pedido => página de gracias", async () => {
  await page.waitForTimeout(1500);
  await page.click("#place_order");
  await page.waitForURL(/\/pedido\/\d+\//, { timeout: 30000 });
  await page.locator(".woocommerce-thankyou-order-received").waitFor();
  console.log("     ", page.url().replace(/\?t=.*/, "?t=…"));
  if (out) await page.screenshot({ path: `${out}/flow-thanks.png`, fullPage: true });
});
console.log("errores JS:", errs.length, errs.slice(0, 3).join(" | "));
await browser.close();
