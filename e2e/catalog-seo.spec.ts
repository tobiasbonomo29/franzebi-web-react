import { expect, test } from "@playwright/test";
import { F, waitPreloaderGone } from "./fixtures";

test.describe("navegación y catálogo", () => {
  test("menú principal exacto, sin href=# ni Electrónica", async ({ page, isMobile }) => {
    await page.goto("/");
    await waitPreloaderGone(page);
    if (isMobile) await page.getByRole("button", { name: "Menú" }).click();
    const nav = page.getByRole("navigation", { name: "Principal" });
    const top = nav.locator(":scope > ul > li > a");
    await expect(top).toHaveText(["Inicio", "Fragancias Masculinas", "Fragancias Femeninas", "Fragancias Kids", "FAQs", "Contacto"]);
    expect(await page.locator('a[href="#"]').count()).toBe(0);
    await expect(page.getByText(/electr[oó]nica|monopat|perif[eé]ric/i)).toHaveCount(0);
  });

  test("dropdown por encima del hero/slider", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop hover");
    await page.goto("/");
    await waitPreloaderGone(page);
    const item = page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Fragancias Masculinas", exact: true });
    await item.hover();
    const dd = item.locator("xpath=following-sibling::div[contains(@class,'dropdown')]");
    await expect(dd).toBeVisible();
    const box = (await dd.boundingBox())!;
    const topEl = await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest(".dropdown") !== null, [box.x + 20, box.y + Math.min(60, box.height / 2)]);
    expect(topEl).toBe(true);
  });

  test("subcategorías de diseñador en orden alfabético e incluye Jo Milano", async ({ page }) => {
    await page.goto("/product-category/perfumeria/fragancias-masculinas/disenador-masculinas/");
    const names = await page.locator(".subcats a").allInnerTexts();
    const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    expect(names).toEqual([...names].sort((a, b) => norm(a).localeCompare(norm(b))));
    expect(names.some((n) => /jo milano/i.test(n))).toBe(true);
    const r = await page.goto("/product-category/perfumeria/fragancias-masculinas/disenador-masculinas/jo-milano-dis-masc/");
    expect(r?.status()).toBe(200);
  });

  test("Electrónica no es accesible", async ({ page }) => {
    const r = await page.goto("/product-category/electronica/");
    expect(r?.status()).toBe(404);
  });

  for (const path of ["/", "/product-category/perfumeria/fragancias-femeninas/", `/product/${F.arabicInStock}/`]) {
    test(`SEO básico ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/$/);
      expect((await page.locator('meta[name="description"]').getAttribute("content"))?.length).toBeGreaterThan(30);
      const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
      expect(ld.length).toBeGreaterThan(0);
      ld.forEach((j) => JSON.parse(j));
    });
  }

  test("paginación lleva la vista al inicio", async ({ page }) => {
    await page.goto("/product-category/decants-5ml-10ml/");
    await waitPreloaderGone(page);
    const next = page.getByRole("navigation", { name: "Paginación" }).getByRole("link", { name: "2" });
    await next.scrollIntoViewIfNeeded();
    await next.click();
    await page.waitForURL(/page=2/);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(50);
  });
});

test.describe("búsqueda", () => {
  test("lattfa encuentra Lattafa", async ({ page }) => {
    await page.goto("/buscar/?q=lattfa");
    await expect(page.locator(".grid .card").first()).toContainText(/lattafa/i);
    await expect(page.getByText(/Mostrando resultados para/)).toBeVisible();
  });
  test("tildes y mayúsculas", async ({ page }) => {
    await page.goto("/buscar/?q=L%C3%81TTAFA");
    await expect(page.locator(".grid .card").first()).toBeVisible();
  });
  test("URL de búsqueda de WordPress redirige 301", async ({ request }) => {
    const r = await request.get("/?s=lattafa&post_type=product", { maxRedirects: 0 });
    expect(r.status()).toBe(301);
    expect(r.headers().location).toContain("/buscar/?q=lattafa");
  });
});

test.describe("redirecciones y técnico", () => {
  test("slug viejo de Árabes → 301", async ({ request }) => {
    const r = await request.get("/product-category/perfumeria/fragancias-masculinas/fragancias-masculinas-arabes/", { maxRedirects: 0 });
    expect(r.status()).toBe(301);
    expect(r.headers().location).toContain("/arabes-masculinas/");
  });
  test("sitemap y robots", async ({ request }) => {
    const sm = await (await request.get("/sitemap.xml")).text();
    expect(sm).toContain("/product/");
    expect(sm).not.toContain("/electronica");
    const robots = await (await request.get("/robots.txt")).text();
    expect(robots).toMatch(/Disallow/);
  });
});

test.describe("preloader", () => {
  test("desaparece, no bloquea scroll", async ({ page }) => {
    await page.goto("/");
    await waitPreloaderGone(page);
    await page.mouse.wheel(0, 600);
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe("hidden");
  });
  test("reduced motion: sin animación", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto("/");
    const anim = await page.evaluate(() => { const m = document.querySelector("#fz-preloader .mark"); return m ? getComputedStyle(m).animationName : "none"; });
    expect(anim).toBe("none");
    await ctx.close();
  });
});
