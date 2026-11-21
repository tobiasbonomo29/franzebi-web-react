import "server-only";
import account from "@/legacy/templates/account.json";
import cart from "@/legacy/templates/cart.json";
import category from "@/legacy/templates/category.json";
import checkout from "@/legacy/templates/checkout.json";
import contacto from "@/legacy/templates/contacto.json";
import faq from "@/legacy/templates/faq.json";
import home from "@/legacy/templates/home.json";
import notFound from "@/legacy/templates/not_found.json";
import product from "@/legacy/templates/product.json";
import search from "@/legacy/templates/search.json";
import shellJson from "@/legacy/templates/shell.json";
import shop from "@/legacy/templates/shop.json";

/** Plantillas generadas por scripts/build-legacy-templates.mjs a partir del sitio WordPress. */
export interface LegacyTemplate {
  name: string;
  title: string;
  bodyClass: string;
  styles: Array<{ href: string; media: string }>;
  scripts: string[];
  inlineScripts: Array<{ code: string; after: string | null }>;
  before: string;
  main: string;
  after: string;
  loginForm?: string;
  empty?: string;
}

const T = { account, cart, category, checkout, contacto, faq, home, not_found: notFound, product, search, shop } as Record<string, LegacyTemplate>;
export type TemplateName = "account" | "cart" | "category" | "checkout" | "contacto" | "faq" | "home" | "not_found" | "product" | "search" | "shop";

export const shell = shellJson as { header: string; footer: string; searchPopup: string };

export function template(name: TemplateName): LegacyTemplate {
  return T[name]!;
}

/** Completa los marcadores <!--fz:x--> (los no provistos quedan vacíos). */
export function fill(html: string, values: Record<string, string>) {
  return html.replace(/<!--fz:([a-z0-9:-]+)-->/g, (_, k: string) => values[k] ?? "");
}
