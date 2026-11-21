import Link from "next/link";
import { categoryUrl, listCategories, type CategoryNode } from "@/lib/catalog";
import { loadCommerceConfig } from "@/lib/config";
import { MobileMenuToggle } from "./MobileMenuToggle";
import { CartButton } from "./CartDrawer";

const ROOT_PATHS: Record<string, string> = {
  "/product-category/perfumeria/fragancias-masculinas/": "perfumeria/fragancias-masculinas",
  "/product-category/perfumeria/fragancias-femeninas/": "perfumeria/fragancias-femeninas",
  "/product-category/perfumeria/fragancias-kids/": "perfumeria/fragancias-kids",
};

/** Menú: Inicio, Masculinas, Femeninas, Kids, FAQs, Contacto. Todas con URL real (sin href="#"). Subcategorías alfabéticas. */
export async function Header() {
  const [cfg, cats] = await Promise.all([loadCommerceConfig(), listCategories()]);
  const menu = cfg.catalog.menu.length ? cfg.catalog.menu : [{ label: "Inicio", href: "/" }];
  const childrenOf = (id: string) => cats.filter((c) => c.parent_id === id && c.show_in_menu);
  const byPath = (p: string) => cats.find((c) => c.path === p);

  return (
    <header className="site-header">
      <div className="container bar">
        <Link href="/" className="logo" aria-label="Franzebi Imports — inicio">
          <span className="logo-mark" aria-hidden="true">FZ</span>
          <span>Franzebi Imports</span>
        </Link>
        <MobileMenuToggle />
        <nav id="main-nav" className="main-nav" aria-label="Principal">
          <ul>
            {menu.map((m) => {
              const root = ROOT_PATHS[m.href] ? byPath(ROOT_PATHS[m.href]!) : undefined;
              const groups = root ? childrenOf(root.id) : [];
              return (
                <li key={m.href}>
                  <Link href={m.href}>{m.label}</Link>
                  {groups.length > 0 && (
                    <div className="dropdown">
                      {groups.map((g) => (
                        <Group key={g.id} group={g} items={childrenOf(g.id)} />
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>
        <form action="/buscar/" className="search-form" role="search">
          <label className="sr-only" htmlFor="q">Buscar</label>
          <input id="q" name="q" type="search" placeholder="Buscar perfumes…" autoComplete="off" />
        </form>
        <CartButton />
      </div>
    </header>
  );
}

function Group({ group, items }: { group: CategoryNode; items: CategoryNode[] }) {
  return (
    <ul>
      <li><Link href={categoryUrl(group.path)}><strong>{displayName(group.name)}</strong></Link></li>
      {items.map((c) => (
        <li key={c.id}><Link href={categoryUrl(c.path)}>{displayName(c.name)}</Link></li>
      ))}
    </ul>
  );
}

/** "Lattafa – Arabe Masc" -> "Lattafa" para el menú (igual que hoy). */
function displayName(n: string) {
  return n.split(" – ")[0]!.split(" - ")[0]!;
}
