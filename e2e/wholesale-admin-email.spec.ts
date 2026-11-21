import { expect, test, type Page } from "@playwright/test";
import { waitPreloaderGone } from "./fixtures";

/**
 * Requieren usuarios de prueba de STAGING (nunca reales):
 *   E2E_RETAIL_EMAIL / E2E_RETAIL_PASSWORD     cliente minorista
 *   E2E_WHOLESALE_EMAIL / E2E_WHOLESALE_PASSWORD cliente mayorista
 *   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD       admin de staging
 *   E2E_MAILPIT_URL                            buzón de prueba (SMTP de staging apuntando a Mailpit)
 */
async function login(page: Page, email?: string, password?: string) {
  test.skip(!email || !password, "credenciales de prueba no definidas");
  await page.goto("/mi-cuenta/");
  await waitPreloaderGone(page);
  await page.getByLabel("Email").fill(email!);
  await page.getByLabel("Contraseña").fill(password!);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { name: "Mi cuenta" })).toBeVisible();
  await expect(page.getByText(/Mis pedidos/)).toBeVisible();
}

async function setCart(page: Page, items: Array<[string, number]>) {
  for (const [sku, quantity] of items) await page.request.post("/api/cart/", { data: { sku, quantity } });
  return (await (await page.request.get("/api/cart/")).json()).totals;
}

const ARABIC = process.env.E2E_ARABIC_SKU ?? "PER_ARB_M_LAT_ASAD_100ML";

test.describe("mayorista", () => {
  test("minorista con 9 puntos: sin precio mayorista, muestra faltantes", async ({ page }) => {
    await login(page, process.env.E2E_RETAIL_EMAIL, process.env.E2E_RETAIL_PASSWORD);
    const t = await setCart(page, [[ARABIC, 9]]);
    expect(t.wholesale.qualifies).toBe(false);
    expect(t.wholesale.missingPoints).toBe(1);
    expect(t.lines.every((l: { wholesaleApplied: boolean }) => !l.wholesaleApplied)).toBe(true);
    await page.goto("/carrito/");
    await expect(page.getByText(/faltan 1 puntos/)).toBeVisible();
  });

  test("minorista con 10 puntos: precio de lista MAYORISTA", async ({ page }) => {
    await login(page, process.env.E2E_RETAIL_EMAIL, process.env.E2E_RETAIL_PASSWORD);
    const t = await setCart(page, [[ARABIC, 10]]);
    expect(t.wholesale.qualifies).toBe(true);
    expect(t.wholesale.savingsCents).toBeGreaterThan(0);
  });

  test("mayorista re-stock con 3 puntos", async ({ page }) => {
    await login(page, process.env.E2E_WHOLESALE_EMAIL, process.env.E2E_WHOLESALE_PASSWORD);
    const t = await setCart(page, [[ARABIC, 3]]);
    expect(t.wholesale.mode).toBe("restock");
    expect(t.wholesale.qualifies).toBe(true);
  });
});

test.describe("admin", () => {
  test("cliente no accede al panel", async ({ page }) => {
    await login(page, process.env.E2E_RETAIL_EMAIL, process.env.E2E_RETAIL_PASSWORD);
    await page.goto("/admin/");
    await expect(page).not.toHaveURL(/\/admin\//);
  });

  test("sync dry-run desde el panel registra corrida", async ({ page }) => {
    await login(page, process.env.E2E_ADMIN_EMAIL, process.env.E2E_ADMIN_PASSWORD);
    await page.goto("/admin/sync/");
    await page.getByRole("button", { name: "Simular (dry-run)" }).click();
    await expect(page.locator("table").first().locator("tbody tr").first()).toContainText("dry-run", { timeout: 120_000 });
  });
});

test.describe("emails transaccionales", () => {
  test("nuevo pedido llega al negocio y al cliente", async ({ request }) => {
    const mp = process.env.E2E_MAILPIT_URL;
    test.skip(!mp, "E2E_MAILPIT_URL no definido");
    const msgs = await (await request.get(`${mp}/api/v1/messages?limit=20`)).json();
    const subjects: string[] = msgs.messages.map((m: { Subject: string }) => m.Subject);
    expect(subjects.some((s) => /Nuevo pedido #\d+/.test(s))).toBe(true);
    expect(subjects.some((s) => /Pedido #\d+ recibido/.test(s))).toBe(true);
    const toBusiness = msgs.messages.find((m: { Subject: string }) => /Nuevo pedido/.test(m.Subject));
    expect(JSON.stringify(toBusiness.To).toLowerCase()).toContain("franzebi.imports@gmail.com");
  });
});
