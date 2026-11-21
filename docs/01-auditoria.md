# 01 · Relevamiento de franzebi.ar (WordPress + WooCommerce)

**Fecha:** 2026-11-21 · **Modo:** sólo lectura. No se creó, editó ni borró nada en producción.

**Método.** Se leyeron el HTML público, la REST API pública (`wp/v2`, `wc/store/v1`), los sitemaps y el DNS público. Luego se entró al panel con el usuario admin provisto y **sólo se hicieron GET**: plugins, snippets, gateways, métodos de envío, webhooks, settings y 50 pedidos de muestra. La sesión quedó en memoria y no se guardó ninguna credencial en disco ni en el repo. El único POST fue el login.

> Hallazgos de seguridad en §9. El dueño decidió no rotar credenciales (2026-11-21); queda registrado.

---

## 1. Plataforma

| Ítem | Valor observado |
|---|---|
| WordPress / WooCommerce | 6.8.13 / 10.6.1 |
| Elementor / Elementor Pro | 4.4.1 / 3.33.1 |
| PHP | 8.2.36 |
| Theme | `debebe-child` (padre `vamtam-debebe`, demo de tienda de bebés VamTam) |
| Hosting | Hostinger (header `platform: hostinger`, CDN `hcdn`) |
| Cache | Header `s-maxage=120`. También está activo el plugin SiteGround Optimizer (`sg-cachepress`), que no corresponde a este hosting |
| Zona horaria WP | `gmt_offset -3`, sin `timezone_string` |

## 2. DNS y correo (consultado vía 8.8.8.8, sin cambios)

| Registro | Valor |
|---|---|
| NS | `artemis.dns-parking.com`, `hermes.dns-parking.com` (DNS de Hostinger) |
| SOA | `hermes.dns-parking.com`, serial `2026111901`, TTL por defecto 600 s |
| A `@` | `77.37.85.139`, `185.249.224.16` |
| AAAA `@` | `2a02:4780:71:958e:…`, `2a02:4780:72:1315:…` |
| `www` | CNAME → `www.franzebi.ar.cdn.hstgr.net` |
| MX | `mx1.hostinger.com` (prioridad 5), `mx2.hostinger.com` (prioridad 10) |
| SPF | `v=spf1 include:_spf.mail.hostinger.com ~all` |
| DKIM | `hostingermail-a._domainkey` → `hostingermail-a.dkim.mail.hostinger.com` |
| DMARC | `v=DMARC1; p=none` |
| autodiscover / autoconfig | CNAME a `*.mail.hostinger.com` |
| CAA | no hay |

**Conclusión:** el correo del dominio vive en Hostinger Mail. El cutover web **no debe tocar** MX, SPF, DKIM, DMARC, autodiscover ni autoconfig. Si se suma un proveedor transaccional (Resend, SES, etc.), su `include:` se **agrega** al SPF existente.

## 3. Plugins (30 instalados, 29 activos)

| Plugin | Rol real | Destino |
|---|---|---|
| woocommerce 10.6.1 | Núcleo | Reemplazado |
| **alegra-woocommerce-sync 2.4** | Sync Alegra → Woo (origen desconocido) | Reemplazado por `@franzebi/sync`. **Convive con AstroSelling** (ver §6) |
| correoargentino-shipping 3.0.3rc | Cotización y etiquetas de Correo Argentino (4 servicios) | `MiCorreoQuoter` (se debe mantener la lógica) |
| woo-discount-rules (+pro) | Tiene la regla #4 "10% árabes", que el snippet #7 anula por filtro | Se elimina; esa regla no existe más |
| checkout-fees-for-woocommerce | Genera el "Descuento por Efectivo" | Dominio `cashDiscount()` |
| checkout-field-editor (awcfe) | Campos de checkout (DNI) | Formulario propio |
| woo-extra-product-options | Opciones extra de producto | Revisar si hay datos reales (D-14) |
| ajax-search-for-woocommerce (FiboSearch) | Buscador | `search_products` (pg_trgm + aliases) |
| code-snippets 4.1.0 | **47 snippets con lógica de negocio** (§4) | Reescritos en dominio |
| wp-mail-smtp | SMTP | `nodemailer` con variables de entorno |
| wp-whatsapp | Botón de WhatsApp | CTA propio |
| facebook-for-woocommerce | Píxel y catálogo de Meta | D-15 |
| elementor, elementor-pro, revslider, vamtam-* | Maquetación y demo | Reemplazados por la app |
| ai-engine, instagram-feed, woo-smart-wishlist, woocommerce-ajax-filters, webp-converter, svg-support, loco-translate, wp-rollback, **wp-staging**, vamtam-importers | Utilitarios | No se migran |
| wps-hide-login (inactivo) | — | — |

Medios de pago: `bacs` (Transferencia) **activo**, `cod` ("Pagar en efectivo al retirar por el local") **activo**, `cheque` inactivo. **Mercado Pago no está instalado.**

Métodos de envío por instancia: `local_pickup:6`, `flat_rate:8` (moto), `flat_rate:9` (horario específico CABA), `correoargentino_shipping_method:1..4` (expreso/clásico × sucursal/domicilio). El endpoint `wc/v3/shipping_zones` devuelve 404 (la ruta no está registrada).

## 4. Inventario de snippets con lógica real (Code Snippets)

41 activos, 6 inactivos. Los que implementan reglas de negocio:

| # | Nombre | Lógica | Nueva implementación |
|---|---|---|---|
| 5 | Rol mayorista | Crea el rol `mayorista` | `roles.wholesale` |
| 6 | Asignación de rol | Asigna el rol al pasar a processing/completed si la orden suma ≥10 puntos con pesos de **primera compra** | `shouldGrantWholesaleRole` + `changeOrderStatus` |
| 7 | Precios mayoristas (20 KB) | Campo `_precio_mayorista`; umbral 10 (minorista) / 3 (mayorista); cron 2×/día que trae la lista MAYORISTA de Alegra; anula la regla 10% #4. **Tiene la credencial de Alegra hardcodeada** | `evaluateWholesale` + `AlegraSource` |
| 8 | Peso y dimensiones | Fallback 1 kg y 20×15×10 cm; aviso "envíos se abonan por transferencia" | `packagesForCorreo` |
| 11 | Checkout efectivo (27 KB) | Zonas de moto por CP + localidad; precios 4000/6000/8000/9500; exclusiones; **efectivo sólo para `local_pickup`**; DNI obligatorio | `shipping.ts`, `payments.ts` |
| 17–30 | Mobile checkout/cart (14 snippets) | Parches CSS/JS de responsive, refresco y "watchdogs" del efectivo | No hacen falta: el servidor decide y la UI es mobile-first |
| 31 | Mayorista puntos v2 | Grupos árabes 1/1, diseñador 2/1.5, cosmética 0.5/0.5; UI de puntos | `DEFAULT_WHOLESALE`, `WholesaleBox` |
| 33 | Jo Milano al menú | Inserta el ítem en el menú una sola vez | Categoría en seed y menú desde DB |
| 34 | Orden alfabético | Ordena las subcategorías del menú | `categories.sort_name` |
| 35 / 40 | Dropdown sobre slider / carrito sobre header | z-index | Capas `--z-*` en CSS |
| 36 | H1 SEO global | Arreglos de H1 | Un H1 por plantilla |
| 38 | Alias de búsqueda | lattfa / latafa / lattaf → lattafa | `DEFAULT_ALIASES` + distancia de edición |
| 39 | Scroll arriba al paginar | | `ScrollToTopOnNav` |
| 42 | WhatsApp a pedido | Diseñador (70, 147) y cosmética (149) no comprables + CTA. **El mensaje no incluye SKU** | `whatsappInquiryUrl` (con SKU) |
| 43 | Guard de tarifas de Correo | Ignora respuestas sin `rates[]` | `quoteShipping` |
| 44 | Preloader (88 KB) | | `Preloader.tsx` |
| 48 | Redirect slug viejo de Árabes | 301 | Tabla `redirects` |
| 51 | Comprobante por WhatsApp | En la página de gracias | `/pedido/[n]` |
| 52 | Ocultar precios de diseñador | Desde 2026-11-18 | `products.hide_price` (D-08) |
| 54 | Aviso mayorista en el login | "Solicitá la activación por WhatsApp" | D-11 |
| 55 | Fix de error fatal de Correo al guardar usuario | Bug del plugin | No aplica |

## 5. Catálogo (Store API pública + `wp/v2/product_cat`)

- **1.726 productos**, todos de tipo `simple`. Todos tienen SKU y **no hay SKUs duplicados**.
- **4 fichas duplicadas por nombre**, cada una con un SKU numérico huérfano y otro con formato Alegra:

  | Nombre | SKU huérfano | SKU Alegra |
  |---|---|---|
  | DECANT LATTAFA VICTORIA 5ML | `725` | `PER_DEC_F_LAT_VICTORIA_5ML` |
  | DECANT MAISON ALHAMBRA YEAH! MAN EDP 5ML | `661` | `PER_DEC_M_MAI_YEAH!_MAN_EDP_5ML` |
  | DECANT LATTAFA WAJOOD 5ML | `642` | `PER_DEC_M_LAT_WAJOOD_5ML` |
  | DECANT LATTAFA QIMMAH 5ML | `637` | `PER_DEC_M_LAT_QIMMAH_5ML` |

- Prefijos de SKU: `PER_DEC` 694, `PER_DIS` 424, `PER_ARB` 308, `ELEC_*` 294, numéricos 6 (los 4 de arriba más `534 ENVIO` y `535 RESERVAS`).
- **Electrónica: 293 productos publicados, comprables y con precio.** Además aparece en el menú, en el H1 de la home ("…Fragancias y Electrónica Importada") y como "Tecnología" en el footer. Las 293 fichas cuelgan sólo de la categoría raíz `electronica`; sus 53 subcategorías (Celulares, Notebooks…) están vacías, aunque responden 200.
- **Diseñador: 421 productos** con `is_purchasable=false` y precio vacío. 211 figuran "en stock" igual.
- Categoría **Cosmética** (`fragancias-femeninas-cosmetica`, `victoria-secret-cosmetica`): **0 productos**, pero aparece en el menú.
- **Jo Milano – Dis Masc** existe y está vacía (0 productos).
- Árbol: **214 categorías**, 60 de ellas vacías. Raíces: `perfumeria` (1.344), `decants-5ml-10ml` (701), `electronica` (293), `sin-categoria` (1).
- 382 productos sin imagen. Formatos: PNG 1.337, JPEG 5, WebP 2.
- 41 nombres con el typo "DEACNT".
- Hay productos utilitarios públicos a $0: `534 ENVIO` y `535 RESERVAS`, en la categoría Decants.
- `RIFFS FREEZE 100ML` **no está publicado**, lo que coincide con el error de imagen reportado.
- 279 productos contienen "Lattafa" en el nombre.

URLs públicas relevadas: [`data/woo-urls.json`](../data/woo-urls.json). La nueva app **conserva** `/product/<slug>/` y `/product-category/<ruta>/`.

## 6. Integraciones

- **AstroSelling:** 6 webhooks activos de Woo (`product.created/updated/deleted`, `order.created/updated/deleted`) hacia `nova.astroselling.com/api/v1/channels/94200/...`.
- **Alegra:** hoy entra por **tres caminos a la vez**: (1) AstroSelling, (2) el plugin `alegra-woocommerce-sync`, (3) el cron del snippet #7 (sólo la lista MAYORISTA, por `reference` = SKU). Es el origen más probable de las fichas duplicadas y de los errores de publicación.
- **Correo Argentino:** plugin 3.0.3rc con API `api.correoargentino.com.ar` (`/rates`). Los pedidos guardan tracking, sucursal y errores de API en meta.
- **Meta:** píxel y verificación de dominio (snippet #53).

## 7. Usuarios y pedidos (agregados, sin datos personales)

- Usuarios: 95 (84 `customer`, 9 `mayorista`, 2 `administrator`). Woo reporta 2 clientes con pagos y 91 sin pagos.
- Totales de pedidos: completed 19, cancelled 27, on-hold 3, el resto en 0. Rango: 2025-10-17 → 2026-11-20.
- Muestra de 49 pedidos:
  - Todos con **transferencia** o **efectivo**.
  - Efectivo + retiro → quedan **`completed`**, no "En espera".
  - Hay pedidos históricos **en efectivo con moto CABA y con horario CABA** (cancelados). El label de `flat_rate:9` dice "permite pago en efectivo".
  - **Bug histórico:** 4 pedidos cancelados tienen "Descuento por Efectivo" con **signo positivo** (recargo), por ejemplo `+231000.00`.
  - Envío "Horario específico CABA" cobrado a **$10.000**, Moto CABA $4.000 y Moto zona azul $8.000.

## 8. SEO / UX observados

- La home no tiene `meta description`, ni JSON-LD de producto u organización, y su H1 menciona Electrónica.
- Las páginas de categoría **no tienen canonical**. La de producto sí, con JSON-LD `BreadcrumbList`.
- `href="#"` en el ítem "Fragancias Masculinas" del menú y en el toggle del carrito de Elementor.
- Restos del demo VamTam: menús "Inactive" con *Classes + Events*, *Baby Gifts* y tallas, links a `debebe.vamtam.com`, y 11 posts y unas 15 páginas demo **indexadas en el sitemap** (lookbooks, blog de bebés).
- El sitemap de usuarios expone los slugs de autor (`/author/franzebi/`, `/author/alejandrolader-com-ar/`), lo que permite enumerar usuarios.
- El FAQ público (ver D-03, D-04, D-13) menciona Crypto USDT con 10%, corte a las 11:30 y mayorista por **unidades** (árabe 10/3, diseñador 5/2, tecnología 3).
- La búsqueda "lattfa" ya se corrige a "lattafa" con el snippet #38.

## 9. Hallazgos de seguridad

1. **Token de API de Alegra en texto plano** dentro del snippet #7 (constantes `FRANZEBI_ALEGRA_API_EMAIL` y `FRANZEBI_ALEGRA_API_TOKEN`). Cualquier admin o backup del sitio lo expone. **Hay que rotarlo en Alegra** y cargar el nuevo sólo como variable de entorno. No se copió a este repo.
2. La contraseña admin de WordPress se compartió por chat: **hay que cambiarla** y conviene activar 2FA.
3. `wps-hide-login` está inactivo: `/wp-login.php` queda expuesto a fuerza bruta.
4. El sitemap de usuarios permite enumerar usuarios.
5. `wp-staging` y `vamtam-importers` siguen activos en producción.
6. Hay contenido demo indexado y un DMARC en `p=none` (sin aplicación).
