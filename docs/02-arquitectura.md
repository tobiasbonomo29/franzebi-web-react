# 02 · Arquitectura

## Objetivos

1. Reemplazar WordPress, WooCommerce y Elementor sin perder catálogo, SEO, reglas comerciales ni pedidos.
2. Que **todas las decisiones comerciales** (precio, descuento, stock, rol, medio de pago y envío) se tomen en el servidor, con reglas puras y testeadas.
3. Que la sincronización con Alegra sea idempotente y observable, sin duplicados.
4. Que **toda la infraestructura esté a nombre del dueño**: repositorio, hosting, Supabase, DNS y credenciales.

## Vista general

```
                    ┌────────────── Navegador ──────────────┐
                    │ Next.js (SSR) · sin secretos           │
                    │ envía: {sku, qty}, destino, elección   │
                    └──────────────┬────────────────────────┘
                                   │ HTTPS
┌──────────────────────────────────▼───────────────────────────────────┐
│ apps/web (Next.js 15 · Node)                                          │
│  ├─ Páginas SSR: home, categoría, producto, búsqueda, FAQ, cuenta     │
│  ├─ API: /api/cart, /api/checkout/{quote,place}, /api/cron/sync       │
│  ├─ Admin (/admin, sólo staff): pedidos, productos, sync, clientes,   │
│  │    configuración, auditoría (server actions)                       │
│  ├─ middleware: redirects 301/410 WP→nuevo, refresco de sesión        │
│  └─ usa ─► @franzebi/domain (reglas puras, 58 tests)                  │
│           @franzebi/sync   (adaptador Alegra + motor idempotente)     │
└───────┬───────────────────────┬───────────────────────────┬──────────┘
        │ service role (server) │ anon + RLS (lectura)       │ HTTPS
┌───────▼───────────────────────▼──────────┐   ┌────────────▼─────────────┐
│ Supabase (proyecto del dueño)             │   │ Externos                  │
│  Postgres + RLS · Auth · Storage          │   │  Alegra API (catálogo)    │
│  RPC place_order (transacción + stock)    │   │  Correo Argentino MiCorreo│
│  audit_logs append-only (triggers)        │   │  SMTP (emails)            │
└───────────────────────────────────────────┘   │  AstroSelling (transición)│
                                                └───────────────────────────┘
```

## Paquetes

| Paquete | Responsabilidad | Pruebas |
|---|---|---|
| `packages/domain` | Reglas puras, sin I/O: dinero en centavos, zonas de moto, cotización, medios de pago, descuento por efectivo, puntos mayoristas, entrega en el día, búsqueda tolerante, WhatsApp y validación de imágenes por magic bytes | 65 tests en vitest |
| `packages/sync` | Puertos `CatalogSource` / `CatalogStore` / `ImageFetcher`, adaptador `AlegraSource`, motor `runCatalogSync`, store en memoria y en Supabase, CLI. Outbox de pedidos: `OrderSink`, `AstroSellingSink`, `dispatchOrderEvents` | 16 tests en vitest |
| `apps/web` | UI, API, admin, auth, emails y cotizador de Correo | Typecheck + `next build` + 80 E2E de Playwright |
| `supabase/` | Migraciones, RLS, RPCs y seed generado desde `domain/defaults.ts` | 34 aserciones SQL/RLS sobre PGlite |

## Reglas de diseño

- **El frontend no decide nada comercial.** El cliente envía sólo `{sku, quantity}` y sus elecciones. Cada cotización y cada confirmación vuelve a leer precio, stock, rol y configuración desde la base y llama a `priceCart()`. Si el total que vio el cliente no coincide con el del servidor, `place` responde 409 y pide reconfirmar.
- **El medio de pago depende del método de entrega**, nunca del CP solo. `resolvePaymentSelection()` es determinística: si la entrega deja de admitir efectivo, el pago pasa a transferencia con un aviso, sin alternar. Además, la base tiene un `CHECK` que impide efectivo con Correo.
- **El SKU es la identidad.** Es `unique`, debe venir normalizado (`upper(trim())`) y un trigger impide cambiarlo. El sync hace upsert por SKU. Si un SKU llega repetido desde el origen, ninguno se publica y queda un error. Ninguna ficha se crea fuera del sync.
- **El precio mayorista se lee siempre de la lista MAYORISTA**, nunca se calcula. Si falta, el ítem queda a precio minorista con la nota "sin precio MAYORISTA". Un carrito que no llega al umbral nunca recibe precio mayorista. Si el precio mayorista fuera mayor que el minorista, no se aplica.
- **Sin sobreventa.** `place_order` es una transacción SQL que descuenta el stock con `stock_qty >= qty`. Si falta stock en algún ítem, se revierte todo. Cancelar un pedido devuelve el stock una sola vez.
- **Configuración versionada y auditada.** `settings`, `shipping_zones` y `wholesale_rules` (versionadas). Cada pedido guarda `wholesale_rules_version` y el `pricing_snapshot` completo.
- **Electrónica oculta, nunca borrada.** Se marca `categories.is_visible=false` y se propaga al subárbol. La función `product_in_hidden_category()` (security definer) la usan la vista pública, la RLS de `products` y `product_prices`, el carrito y `place_order`.

## Seguridad

- **Secretos sólo en variables de entorno** (`docs/05`). `env.ts` las valida con zod y, si falta alguna, informa sólo el **nombre**. `npm run secrets:scan` corre en CI. Los módulos de servidor importan `server-only`.
- **RLS en todas las tablas.** Anon lee catálogo visible, lista minorista y settings públicos. Cada usuario lee sólo sus pedidos y carritos. Los clientes no escriben en tablas comerciales. Sólo admin cambia roles (trigger + privilegios de columna). `audit_logs` es append-only.
- **Roles:** `admin`, `operator`, `customer` y `wholesale`. El rol se lee siempre de `profiles`, nunca del JWT ni de metadata del cliente.
- **Carrito de invitado:** cookie httpOnly con token aleatorio. En la base se guarda sólo su HMAC.
- **Página de pedido:** requiere el token HMAC del pedido, porque los números son secuenciales.
- **Sync en modo seguro por defecto:** escribe sólo si `SYNC_ALLOW_APPLY=true`, y el "Sincronizar ahora" real está reservado a admin.
- **Headers:** HSTS, nosniff, `X-Frame-Options` y `Referrer-Policy`. `wp-admin`, `wp-login.php`, `xmlrpc.php` y `wp-json` responden 410.

## Sincronización (Alegra → tienda)

1. El scheduler llama a `/api/cron/sync` (Bearer `CRON_SECRET`). Frecuencia sugerida: cada 15 minutos para stock y precios.
2. `AlegraSource` resuelve las listas ARS por **nombre** e ignora las de USD, pagina los ítems de 30 en 30 y normaliza cada uno (SKU = `reference`).
3. `runCatalogSync`:
   - lee todo el origen;
   - detecta SKUs duplicados;
   - compara el hash de contenido y saltea lo que no cambió (idempotencia);
   - valida imágenes por formato, MIME, tamaño y dimensiones **antes** de subirlas;
   - hace upsert de producto, precios, `inventory_snapshots` e imágenes en Storage (nombre por sha256);
   - registra `sync_jobs` (estado y estadísticas) y `sync_errors` (etapa, código, mensaje, reintentable, payload resumido).
4. Imagen inválida (caso **RIFFS FREEZE 100ML**): el producto se publica con un placeholder controlado y queda un error **reintentable** visible en `/admin/sync`. El hash se guarda como `:image-retry`, así la próxima corrida reintenta sola. Un error en un ítem nunca tira abajo el job.
5. Un producto que desaparece de Alegra **no se borra**: se cuenta en `missingInSource` y se marca para revisión.

**AstroSelling (D-18).** Los pedidos salen por un outbox (`order_events`, alimentado por un trigger) hacia `AstroSellingSink`, que replica el webhook de WooCommerce. El catálogo se lee directo de Alegra, así que dejar AstroSelling sólo implica otro `OrderSink` y cambiar `settings.integrations.orderSinks`.

## Modelo de datos

Tablas requeridas: `profiles`, `roles`, `products`, `product_variants`, `categories`, `brands`, `product_images`, `inventory_snapshots`, `price_lists`, `wholesale_rules`, `carts`, `cart_items`, `orders`, `order_items`, `payment_attempts`, `shipping_quotes`, `shipping_zones`, `sync_jobs`, `sync_errors`, `audit_logs` y `settings`.

Tablas extra: `product_categories` (N:M), `product_prices` (precio por lista) y `redirects`.

Además: la vista `catalog_products` y las funciones `search_products` (pg_trgm + unaccent + aliases), `place_order`, `release_order_stock`, `hidden_product_ids` y `product_in_hidden_category`. Los buckets de Storage son `product-images` (público) y `payment-receipts` (privado, por usuario).

Ver [`supabase/migrations`](../supabase/migrations).

## URLs y SEO

- Se conservan **idénticas** las rutas `/product/<slug>/` y `/product-category/<ruta>/` (`trailingSlash: true`), así que no hacen falta 301 masivos. Los 301/410 puntuales viven en la tabla `redirects`.
- Cada plantilla tiene un solo H1, title y description, canonical (paginación con `?page=n`), JSON-LD (`Organization`, `BreadcrumbList`, `ItemList`, `Product`, y `FAQPage` si hay contenido) y aparece en `sitemap.xml`, que excluye lo oculto.
- `robots.txt` bloquea todo fuera de `franzebi.ar` y en staging.

## Rendimiento (próximo paso)

Hoy las páginas son `force-dynamic`. Cuando staging tenga datos, conviene pasar catálogo y producto a ISR (`revalidate`) e invalidar por tag cuando el sync escriba.

## Diseño heredado (réplica de franzebi.ar)

La tienda reproduce el sitio WordPress/Elementor/VamTam **con el mismo markup, CSS y scripts de interacción**:

1. `scripts/mirror-legacy.mjs` captura (sólo GET) cada tipo de página del sitio actual: home, shop, categoría, búsqueda, producto, carrito, checkout, mi cuenta, FAQ, contacto y 404. Copia a `apps/web/public/` con las **mismas rutas** (`/wp-content/...`, `/wp-includes/...`) el CSS (kit global, templates de Elementor, theme), las fuentes, las imágenes de diseño, los scripts de Elementor/VamTam (menú, sticky, carruseles, pestañas, toggles, contador, popups, chunks dinámicos) y el botón flotante de WhatsApp. Descarta los scripts de WooCommerce, píxeles y plugins cuya función reemplaza la app.
2. `scripts/build-legacy-templates.mjs` convierte esas capturas en plantillas (`apps/web/src/legacy/templates/*.json`) con marcadores `<!--fz:…-->` y aplica las reglas del brief: Electrónica fuera del menú, sin `href="#"` y sin "Tecnología" en el footer.
3. `components/LegacyPage.tsx` arma cada página: misma clase en `<body>`, estilos en el mismo orden, header, contenido, footer y scripts. `lib/legacy/render.ts` genera el HTML dinámico con el markup exacto de WooCommerce (tarjetas, precios `wc_price`, paginación, breadcrumb, galería, mini-carrito, tabla del carrito). Todo dato dinámico se escapa.
4. `public/legacy/fz.js` reemplaza a los scripts de Woo: agregar al carrito, cantidades, mini-carrito ("cart fragments"), carrito, contacto, login y registro. Siempre habla con la API propia, y precios, stock y reglas los decide el servidor.
5. Checkout, nueva contraseña: componentes React montados (portal) dentro del markup heredado.

Para refrescar el diseño tras cambios en WP: `node scripts/mirror-legacy.mjs && node scripts/build-legacy-templates.mjs`.

## Facturación y stock con Alegra

- **Alegra → tienda:** el sync trae productos, precios (ARABES MINORISTA (pesos) / MAYORISTA) y stock. Resta las unidades vendidas en la web que Alegra todavía no descontó (`pending_stock_reservations()`), así no se sobrevende entre el pedido y la factura. Escribe en paralelo (concurrencia 8).
- **Tienda → Alegra:** cada pedido encola eventos (outbox) para los sinks de `settings.integrations.orderSinks`:
  - `astroselling`: webhook compatible con WooCommerce. Hoy AstroSelling factura en Alegra.
  - `alegra`: factura directa con el mismo formato que la de AstroSelling (ticket X, depósito Principal, lista MINORISTA o MAYORISTA, observación con el número de pedido). Es idempotente y anula la factura si el pedido se cancela. Ver D-27.

## Panel de pedidos (`/admin/pedidos/`)

Lista con pestañas por estado y contadores, búsqueda (número, nombre, email, DNI, teléfono), filtros de entrega y fechas, paginación y exportación CSV. El detalle de cada pedido incluye:
- cliente, entrega (con sucursal de Correo), pago y productos;
- cambio de estado y validación de transferencia;
- WhatsApp y email al cliente, remito imprimible;
- notas internas o visibles al cliente (aparecen en Mi cuenta);
- número de seguimiento e importación del envío en MiCorreo;
- estado de las integraciones (AstroSelling o factura de Alegra) con reintento, e historial.
