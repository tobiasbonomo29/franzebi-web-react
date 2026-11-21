import { expect, test } from "@playwright/test";
import { F, addFirstPurchasableToCart, fillCheckoutDestination, waitPreloaderGone } from "./fixtures";

test.describe("productos a pedido", () => {
  test("diseñador: CTA WhatsApp con nombre y SKU, sin compra ni precio", async ({ page }) => {
    await page.goto(`/product/${F.designerOnRequest}/`);
    const wa = page.getByRole("link", { name: "Consultar por WhatsApp" });
    await expect(wa).toBeVisible();
    const href = decodeURIComponent((await wa.getAttribute("href"))!);
    expect(href).toContain("wa.me/5491128720954");
    expect(href).toContain(`SKU: ${F.designerSku}`);
    await expect(page.getByRole("button", { name: "Añadir al carrito" })).toHaveCount(0);
    await expect(page.locator(".pdp .price")).toHaveCount(0); // D-08: precios de diseñador ocultos
  });

  test("API no permite agregar un producto a pedido", async ({ request }) => {
    await request.post("/api/cart/", { data: { sku: F.designerSku, quantity: 1 } });
    const j = await (await request.get("/api/cart/")).json();
    expect(j.totals.lines.find((l: { sku: string }) => l.sku === F.designerSku)).toBeUndefined();
    expect(j.totals.issues.some((i: { type: string }) => i.type === "on_request")).toBe(true);
  });
});

test.describe("carrito", () => {
  test("drawer por encima de toda la navegación", async ({ page }) => {
    await addFirstPurchasableToCart(page);
    const drawer = page.getByRole("dialog", { name: "Carrito" });
    const b = (await drawer.boundingBox())!;
    const onTop = await page.evaluate(([x, y]) => !!document.elementFromPoint(x!, y!)?.closest(".drawer"), [b.x + 10, b.y + 10]);
    expect(onTop).toBe(true);
  });

  test("stock insuficiente: avisa y recalcula sin error", async ({ request }) => {
    test.skip(!F.lowStockSku, "definir E2E_LOW_STOCK_SKU/QTY");
    const r = await request.post("/api/cart/", { data: { sku: F.lowStockSku, quantity: F.lowStockQty + 5 } });
    expect(r.ok()).toBe(true);
    const j = await r.json();
    const line = j.totals.lines.find((l: { sku: string }) => l.sku === F.lowStockSku);
    expect(line.quantity).toBe(F.lowStockQty);
    expect(j.totals.issues[0].type).toBe("quantity_reduced");
  });

  test("el cliente no puede inyectar precio", async ({ request }) => {
    await request.post("/api/cart/", { data: { sku: "X", quantity: 1, price: 1, unitPriceCents: 1 } });
    const j = await (await request.get("/api/cart/")).json();
    for (const l of j.totals.lines) expect(l.unitPriceCents).toBeGreaterThan(100);
  });

  test("tabla desktop / tarjetas mobile sin desborde horizontal", async ({ page }) => {
    await addFirstPurchasableToCart(page);
    await page.goto("/carrito/");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe("checkout: envíos y medios de pago", () => {
  test.beforeEach(async ({ page }) => {
    await addFirstPurchasableToCart(page);
    await page.goto("/checkout/");
    await waitPreloaderGone(page);
  });

  test("CABA: retiro + moto $4.000 + horario + correo; efectivo sólo con entregas habilitadas", async ({ page }) => {
    await fillCheckoutDestination(page, { state: "C", postcode: "1414", city: "CABA" });
    await expect(page.getByLabel(/Retiro por el local/)).toBeVisible();
    await expect(page.locator(".option", { hasText: /Moto CABA/ })).toContainText("4.000");
    // Correo => nunca efectivo
    const correo = page.locator(".option", { hasText: /Correo Argentino/ }).first();
    if (await correo.count()) {
      await correo.locator("input").check();
      await page.waitForResponse((r) => r.url().includes("/api/checkout/quote/"));
      await expect(page.getByLabel(/Efectivo/)).toHaveCount(0);
    }
    // Retiro => efectivo disponible
    await page.getByLabel(/Retiro por el local/).check();
    await page.waitForResponse((r) => r.url().includes("/api/checkout/quote/"));
    await expect(page.getByLabel(/Efectivo/)).toBeVisible();
  });

  test("cambiar de retiro+efectivo a Correo normaliza a transferencia con aviso y no alterna", async ({ page }) => {
    await fillCheckoutDestination(page, { state: "C", postcode: "1414", city: "CABA" });
    await page.getByLabel(/Retiro por el local/).check();
    await page.waitForResponse((r) => r.url().includes("/api/checkout/quote/"));
    await page.getByLabel(/Efectivo/).check();
    await page.waitForResponse((r) => r.url().includes("/api/checkout/quote/"));
    const correo = page.locator(".option", { hasText: /Correo Argentino/ }).first();
    test.skip(!(await correo.count()), "Correo Argentino no configurado en staging");
    await correo.locator("input").check();
    await page.waitForResponse((r) => r.url().includes("/api/checkout/quote/"));
    await expect(page.getByLabel(/Transferencia bancaria/)).toBeChecked();
    await expect(page.getByRole("status").filter({ hasText: /efectivo no está disponible/ })).toBeVisible();
    await page.waitForTimeout(1500); // no debe volver a cambiar solo
    await expect(page.getByLabel(/Transferencia bancaria/)).toBeChecked();
  });

  test("zona excluida (General Rodríguez): sin moto, con retiro", async ({ page }) => {
    await fillCheckoutDestination(page, { state: "B", postcode: "1748", city: "General Rodriguez" });
    await expect(page.locator(".option", { hasText: /Moto/ })).toHaveCount(0);
    await expect(page.getByLabel(/Retiro por el local/)).toBeVisible();
    await expect(page.getByText(/fuera de la cobertura de moto/)).toBeVisible();
  });

  test("zona roja (La Plata) $9.500", async ({ page }) => {
    await fillCheckoutDestination(page, { state: "B", postcode: "1900", city: "La Plata" });
    await expect(page.locator(".option", { hasText: /Moto zona roja/i })).toContainText("9.500");
  });

  test("transferencia + retiro: crea pedido En espera y ofrece enviar comprobante", async ({ page }) => {
    await page.getByLabel("Nombre", { exact: true }).fill("Test");
    await page.getByLabel("Apellido").fill("E2E");
    await page.getByLabel("Email").fill(process.env.E2E_CUSTOMER_EMAIL ?? "e2e+checkout@example.test");
    await page.getByLabel("Teléfono / WhatsApp").fill("1122334455");
    await page.getByLabel("DNI").fill("30111222");
    await fillCheckoutDestination(page, { state: "C", postcode: "1414", city: "CABA" });
    await page.getByLabel(/Retiro por el local/).check();
    await page.waitForResponse((r) => r.url().includes("/api/checkout/quote/"));
    await page.getByLabel(/Transferencia bancaria/).check();
    await page.getByRole("button", { name: "Confirmar pedido" }).click();
    await page.waitForURL(/\/pedido\/\d+\/\?t=/);
    await expect(page.getByText(/En espera/)).toBeVisible();
    await expect(page.getByRole("link", { name: /Enviar comprobante/ })).toHaveAttribute("href", /wa\.me\/5491128720954/);
  });

  test("checkout mobile sin solapamientos ni scroll horizontal", async ({ page, isMobile }) => {
    test.skip(!isMobile);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe("página de pedido", () => {
  test("no se puede ver un pedido ajeno sin token", async ({ request }) => {
    const r = await request.get("/pedido/30000/");
    expect(r.status()).toBe(404);
  });
});
