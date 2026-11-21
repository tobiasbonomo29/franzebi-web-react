import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * 1) Compatibilidad de URLs WordPress/Woo (301):
 *    - /?s=term&post_type=product  -> /buscar/?q=term
 *    - /?p=ID / ?product_cat=      -> se resuelven por tabla redirects (DB) cuando existan
 *    - /wp-content/uploads/...     -> URL pública de Storage (mapeo product_images.legacy_url) — ver docs/04 Fase 3
 *    - /feed/, /wp-login.php, /wp-admin/ -> 410/404 (no existen en la nueva app)
 * 2) Redirects puntuales desde tabla `redirects` (lectura pública con anon key, cache corto).
 * 3) Refresco de sesión de Supabase Auth.
 */
let redirectCache: { at: number; map: Map<string, { to: string; code: number }> } | null = null;

async function loadRedirects() {
  if (redirectCache && Date.now() - redirectCache.at < 5 * 60_000) return redirectCache.map;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const map = new Map<string, { to: string; code: number }>();
  if (url && key) {
    try {
      const r = await fetch(`${url}/rest/v1/redirects?select=from_path,to_path,status_code`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
      if (r.ok) for (const x of (await r.json()) as Array<{ from_path: string; to_path: string; status_code: number }>) map.set(x.from_path, { to: x.to_path, code: x.status_code });
    } catch {
      /* si falla, se sirve sin redirects puntuales */
    }
  }
  redirectCache = { at: Date.now(), map };
  return map;
}

export async function middleware(req: NextRequest) {
  const url = req.nextUrl;
  if (url.pathname === "/" && url.searchParams.has("s")) {
    const to = new URL("/buscar/", url);
    to.searchParams.set("q", url.searchParams.get("s") ?? "");
    return NextResponse.redirect(to, 301);
  }
  if (/^\/(wp-admin|wp-login\.php|xmlrpc\.php|wp-json)(\/|$)/.test(url.pathname)) return new NextResponse(null, { status: 410 });
  if (/^\/(feed|comments\/feed)\/?$/.test(url.pathname)) return new NextResponse(null, { status: 410 });

  const map = await loadRedirects();
  const hit = map.get(url.pathname) ?? map.get(url.pathname.endsWith("/") ? url.pathname : url.pathname + "/");
  if (hit) {
    if (hit.code === 410) return new NextResponse(null, { status: 410 });
    return NextResponse.redirect(new URL(hit.to, url), hit.code as 301 | 302);
  }

  let res = NextResponse.next({ request: req });
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const sbKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (sbUrl && sbKey) {
    const sb = createServerClient(sbUrl, sbKey, {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (list: Array<{ name: string; value: string; options: CookieOptions }>) => {
          list.forEach(({ name, value }) => req.cookies.set(name, value));
          res = NextResponse.next({ request: req });
          list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
        },
      },
    });
    await sb.auth.getUser();
  }
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.svg|placeholder-producto.svg).*)"] };
