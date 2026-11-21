import { expect, type Page } from "@playwright/test";

/** Datos de staging esperados (sembrados por el sync dry-run → apply en staging). Ajustables por env. */
export const F = {
  arabicInStock: process.env.E2E_ARABIC_SLUG ?? "lattafa-asad-edp-100ml",
  designerOnRequest: process.env.E2E_DESIGNER_SLUG ?? "ysl-mon-paris-edp-90ml",
  designerSku: process.env.E2E_DESIGNER_SKU ?? "PER_DIS_F_YSL_MON_PARIS_EDP_90ML",
  lowStockSku: process.env.E2E_LOW_STOCK_SKU, // producto con stock conocido (p.ej. 2)
  lowStockQty: Number(process.env.E2E_LOW_STOCK_QTY ?? 2),
};

export async function waitPreloaderGone(page: Page) {
  await expect(page.locator("#fz-preloader")).toHaveCount(0, { timeout: 6000 });
}

export async function addFirstPurchasableToCart(page: Page) {
  await page.goto("/product-category/perfumeria/fragancias-masculinas/arabes-masculinas/");
  await waitPreloaderGone(page);
  await page.getByRole("button", { name: "Añadir al carrito" }).first().click();
  await expect(page.getByRole("dialog", { name: "Carrito" })).toBeVisible();
}

export async function fillCheckoutDestination(page: Page, d: { state: string; postcode: string; city: string }) {
  await page.getByLabel("Provincia").selectOption(d.state);
  await page.getByLabel("Código postal").fill(d.postcode);
  await page.getByLabel("Localidad").fill(d.city);
  await page.waitForResponse((r) => r.url().includes("/api/checkout/quote/") && r.ok());
}
