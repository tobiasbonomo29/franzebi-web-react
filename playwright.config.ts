import { defineConfig, devices } from "@playwright/test";

/**
 * E2E contra STAGING. Nunca apuntar a producción con pruebas que crean pedidos.
 *   E2E_BASE_URL=https://staging.franzebi.ar npm run e2e
 * Comparación visual contra WordPress (sólo lectura):
 *   LEGACY_BASE_URL=https://franzebi.ar npm run e2e -- --grep @visual
 */
const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";
if (/^https?:\/\/(www\.)?franzebi\.ar/.test(base) && process.env.E2E_ALLOW_PROD !== "true") {
  throw new Error("E2E_BASE_URL apunta a producción. Usá staging (o E2E_ALLOW_PROD=true sólo para pruebas de lectura post-cutover).");
}

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: base, trace: "retain-on-failure", screenshot: "only-on-failure", locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
