# 04 · Plan de migración, DNS, rollback y checklist de salida

**Regla:** WordPress sigue online y sin cambios hasta el cutover. Toda escritura masiva (productos, stock, precios, usuarios, pedidos o DNS) requiere **aprobación explícita y por escrito** del dueño.

## Fase 0 · Seguridad y cuentas (antes de cualquier otra cosa)

- [x] Credenciales de Alegra y WordPress: **el dueño decidió no rotarlas** (2026-11-21). En la app nueva la credencial de Alegra se carga igual sólo como variable de entorno.
- [ ] Crear, **a nombre del dueño**: organización de GitHub, proyecto Supabase (región São Paulo), hosting (Vercel, Netlify o VPS) y la cuenta del proveedor SMTP. Invitar al equipo con roles mínimos.
- [ ] Guardar los secretos en un gestor (1Password o Bitwarden) y en el panel del hosting. **Nunca en el repo.**

## Fase 1 · Exportación (sólo lectura)

| Qué | Cómo | Dónde queda |
|---|---|---|
| Backup completo | Hostinger: backup del sitio + `mysqldump`, verificando que restaura en un entorno aparte | Fuera del repo, cifrado |
| Categorías y URLs | `wp/v2/product_cat?hide_empty=false` (hecho → `data/woo-urls.json`) | Repo (público) |
| Productos, SKU, imágenes | Store API (hecho) + `wc/v3/products` autenticado para peso, dimensiones y meta `_precio_mayorista` | `exports/` (git-ignored) |
| Clientes | `wc/v3/customers` + `wp/v2/users` (roles). **Sin hashes de contraseña** | `exports/` cifrado (datos personales) |
| Pedidos | `wc/v3/orders` completo (incluye meta de Correo Argentino) | `exports/` cifrado |
| Medios | `wp-content/uploads` (rsync o backup) | Bucket `product-images` |
| Snippets | Hecho (47, sólo para análisis; incluyen la credencial expuesta: **no versionar**) | Scratch local |

## Fase 2 · Staging

1. `supabase link` → `supabase db push` (5 migraciones) → `psql < supabase/seed.sql`.
2. Deploy de `apps/web` en `staging.franzebi.ar` (o una URL del hosting) con `STAGING=true`, que bloquea la indexación vía robots.
3. Crear usuarios de prueba: admin, operador, minorista y mayorista.
4. Correr `npm test` (81), `npm run test:db` (34) y `npm run secrets:scan` en CI.

## Fase 3 · Catálogo en dry-run → apply en staging

1. `npm run sync:dry-run` con las credenciales nuevas de Alegra. Revisar el reporte: SKUs sin referencia, duplicados en el origen, sin precio ARS, imágenes inválidas y nombres de lista (D-10).
2. Validar contra la API real los nombres de campos (`price[].idPriceList`, `inventory.availableQuantity`, `images`, `itemCategory`).
3. Conciliación **Woo ⇄ Alegra por SKU**: los 1.726 de Woo contra los ítems de Alegra. Se generan 3 listas: sólo en Woo, sólo en Alegra y con diferencias de precio o stock. Se revisan con el dueño (D-19, D-20).
4. Cargar en staging la metadata que Alegra no tiene, como import único desde el export de Woo y **nunca creando fichas**: slug, descripción, categoría primaria y secundarias, `legacy_woo_id`, `legacy_url`, peso y dimensiones, `wholesale_group` según categoría y `sale_mode` (diseñador y cosmética → `on_request`).
5. `SYNC_ALLOW_APPLY=true` **sólo en staging**, y apply.
6. Imágenes: migrar `wp-content/uploads` a Storage. Las URLs de imagen cambian, así que se guarda `product_images.legacy_url` y el middleware responde 301 de la URL vieja a la de Storage.

## Fase 4 · Funcionalidad y pruebas en staging

- [ ] Configurar el cotizador de Correo Argentino con credenciales MiCorreo y comparar 20 CP reales contra el plugin actual: deben dar el mismo precio y los mismos servicios.
- [ ] Configurar el SMTP de staging contra **Mailpit** (para que no salgan mails reales) y validar los dos mails (negocio y cliente).
- [ ] Correr toda la suite E2E en desktop y mobile: `E2E_BASE_URL=https://staging… npm run e2e`.
- [ ] Comparación visual: `LEGACY_BASE_URL=https://franzebi.ar npm run e2e -- --grep @visual`, y revisión con el dueño.
- [ ] Probar flujos manuales con el operador: validar transferencia, cambiar estados y confirmar que el mayorista se asigna al completar.
- [ ] Cerrar todas las decisiones D-01 a D-21.

## Fase 5 · Pedidos hacia AstroSelling (D-18, resuelto)

Decisión: los pedidos siguen bajando a Alegra **a través de AstroSelling**, con la puerta abierta para reemplazarlo.

- **Implementado:** cada alta o cambio de estado de un pedido encola un evento en `order_events` (trigger en la base, así nunca se pierde). El cron `/api/cron/orders` (cada 5 min) los envía al webhook de AstroSelling con el mismo formato y la misma firma (`X-WC-Webhook-Signature`) que hoy manda WooCommerce. Reintenta con backoff exponencial y, después de 10 intentos, deja el evento en "dead" visible en `/admin/sync` con botón de reintento. Además respeta el orden por pedido.
- **A confirmar con AstroSelling antes del cutover:**
  1. Si su canal Woo procesa el pedido con lo que llega en el webhook, o si además consulta la API REST de Woo por el id (que ya no va a existir). En el segundo caso hay que pedirles un canal genérico o por API.
  2. Cuál es el secreto de firma (`ASTROSELLING_WEBHOOK_SECRET`).
  3. Prueba conjunta: un pedido de prueba enviado a un canal de **test** de AstroSelling, nunca al de producción.
- **Para dejar AstroSelling más adelante:** se implementa otro `OrderSink` (por ejemplo, factura o remito directo en Alegra) y se cambia `settings.integrations.orderSinks`. El checkout y la base no cambian.
- En staging, `ORDER_DISPATCH_ENABLED=false`: los eventos se acumulan pero no salen.

## Fase 6 · Usuarios

1. Importar los perfiles con `supabase.auth.admin.createUser({ email, email_confirm: true })` **sin contraseña**, y en `profiles` cargar `legacy_wp_user_id`, `role` (`mayorista` → `wholesale`, `administrator` → `admin`) y `password_reset_required=true`.
2. Las contraseñas de WordPress **no se migran**. Cada cliente crea la suya con "Olvidé mi contraseña" (Supabase Auth), y en la página de Mi cuenta hay un aviso que lo explica.
3. Los pedidos históricos se importan como sólo lectura (`legacy_woo_id`), vinculados por email. Recién al final, con el congelamiento previo al cutover (Fase 8), se hace el delta.

## Fase 7 · Plan de DNS (Hostinger · dns-parking)

**Estado actual en §2 de la auditoría.** Antes de tocar nada hay que exportar la zona completa desde el panel (captura + archivo).

| Paso | Cuándo | Acción |
|---|---|---|
| 1 | T−48 h | Bajar el TTL de `@` (A/AAAA) y `www` (CNAME) a **300 s**. MX, TXT (SPF), DKIM, DMARC, autodiscover y autoconfig **no se tocan** |
| 2 | T−24 h | Emitir SSL para `franzebi.ar` y `www.franzebi.ar` en el nuevo hosting, verificando por TXT o HTTP si lo permite antes del cambio |
| 3 | T−0 | `@`: reemplazar los A/AAAA de Hostinger por los del nuevo hosting (A/ALIAS que indique el proveedor). `www`: CNAME al hosting nuevo. Canónico: `franzebi.ar`, con `www` → 301 |
| 4 | T+0 | Purgar la CDN de Hostinger y la del nuevo hosting. Verificar desde 8.8.8.8 y 1.1.1.1 |
| 5 | T+0 | Si el SMTP transaccional nuevo usa el dominio, **agregar** su `include:` al SPF existente y su DKIM (selector propio). No reemplazar el SPF de Hostinger. Subir DMARC a `p=quarantine` después de 2 semanas sin fallos |
| 6 | T+7 días | Subir los TTL de nuevo a 3600 s |

**No se hace:** cambiar nameservers, tocar MX o cambiar la forma de los registros de correo.

## Fase 8 · Cutover (sólo con aprobación manual)

1. Congelar cambios en WordPress: modo mantenimiento sólo para checkout, con aviso.
2. Backup final verificable de WordPress y snapshot de la base Supabase.
3. Delta de pedidos y clientes desde el último import. Último sync real de Alegra.
4. Desactivar en Woo los webhooks de AstroSelling (para que no haya doble canal) y poner `ORDER_DISPATCH_ENABLED=true` en la app nueva.
5. Aplicar el cambio de DNS (Fase 7, paso 3).
6. Smoke test en producción (sólo lectura + 1 pedido real de prueba con retiro y transferencia, cancelado después).
7. Monitoreo de 48 h: errores 5xx, `sync_errors`, pedidos nuevos y 404 más frecuentes (los 404 inesperados se agregan a `redirects`).

## Plan de rollback

| Disparador | Acción | Tiempo |
|---|---|---|
| Checkout roto, errores 5xx > 2 % o precios o stock incorrectos | Volver los A/AAAA y el CNAME `www` a los valores de Hostinger guardados en la Fase 7 (TTL de 300 s → propaga en ≤ 5–10 min) | < 15 min |
| | Sacar WordPress del modo mantenimiento y reactivar los webhooks de AstroSelling | 5 min |
| | Exportar los pedidos tomados en la app nueva durante la ventana (`orders` con `placed_at` > cutover) y cargarlos a mano en Woo y Alegra | según volumen |
| Problema de datos sin caída | Snapshot de Supabase (PITR) al momento previo | < 30 min |

**WordPress no se apaga** hasta 30 días después de un cutover estable. Durante ese tiempo sirve de respaldo y de referencia visual.

## Checklist de salida a producción

**Seguridad**
- [x] Rotación de credenciales: descartada por el dueño (2026-11-21)
- [ ] `secrets:scan` en verde y `.env*` fuera de git
- [ ] RLS verificada (`npm run test:db`) contra el proyecto real con el linter de Supabase
- [ ] `SUPABASE_SERVICE_ROLE_KEY` sólo en el servidor (no `NEXT_PUBLIC_`)

**Datos**
- [ ] Conciliación por SKU firmada por el dueño, sin duplicados
- [ ] Electrónica oculta: 404 y fuera del sitemap
- [ ] Jo Milano presente en Masculinas › Diseñador
- [ ] Imágenes: 0 errores no reintentables, placeholders listados

**Reglas comerciales** (cerradas al 2026-11-21: D-01, D-02, D-03 salvo sábados, D-04, D-05, D-08 provisoria, D-13)
- [x] Efectivo: sólo retiro por el local, nunca con Correo (D-01)
- [x] Transferencia → En espera. Retiro + efectivo → En espera (D-02)
- [x] Moto: corte 11:30 L-V (D-03), Burzaco excluido (D-06), horario CABA $12.000 (D-07)
- [x] Mayorista: pesos, umbrales y decants confirmados (D-04, D-05); alta de mayorista automática (D-11)
- [ ] Precios de diseñador: ocultos por el momento (D-08); reconfirmar antes del cutover

**Calidad**
- [ ] Unit (81) + DB (34) + E2E (80, desktop y mobile) en verde contra staging
- [ ] Comparación visual aprobada por el dueño
- [ ] Lighthouse mobile ≥ 85 en home, categoría y producto
- [ ] Emails al negocio (`Franzebi.imports@gmail.com`) y al cliente recibidos

**SEO**
- [ ] Redirects 301/410 cargados y muestreo de 50 URLs de Woo → 200/301 correctos
- [ ] Sitemap enviado en Search Console (propiedad del dueño)
- [ ] Canonical y H1 por plantilla verificados

**Operación**
- [ ] Backup verificable de WP y snapshot de Supabase
- [ ] TTL bajado 48 h antes y zona DNS exportada
- [ ] Cron de sync configurado y alertas de `sync_errors`
- [ ] **Aprobación escrita del dueño para el cutover**
