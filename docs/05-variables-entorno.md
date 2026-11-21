# 05 · Variables de entorno

Plantilla en [`.env.example`](../.env.example). **Ningún valor real va en el repo, en el frontend ni en los logs.** `env.ts` valida las variables al iniciar y, si falta alguna, informa sólo su nombre.

| Variable | Ámbito | Requerida | Descripción |
|---|---|---|---|
| `SITE_URL` | servidor | sí | URL canónica (`https://franzebi.ar` en producción). Fuera de ese dominio, robots bloquea todo |
| `STAGING` | servidor | staging | `true` bloquea la indexación |
| `NEXT_PUBLIC_SUPABASE_URL` | público | sí | URL del proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | público | sí | Clave anon. Es segura en el browser porque RLS limita el acceso |
| `SUPABASE_SERVICE_ROLE_KEY` | **sólo servidor** | sí | Bypassa RLS. Se usa sólo en route handlers y server actions después de validar permisos |
| `SUPABASE_URL` | CLI | sync CLI | Igual a la URL pública, para el CLI fuera de Next |
| `CART_TOKEN_SECRET` | servidor | sí | ≥ 32 caracteres. HMAC del token del carrito invitado y del acceso a `/pedido/` |
| `CRON_SECRET` | servidor | sí | ≥ 24 caracteres. Bearer del endpoint `/api/cron/sync` |
| `ALEGRA_API_EMAIL` / `ALEGRA_API_TOKEN` | servidor | sync | Credencial **nueva** de Alegra, preferentemente de un usuario de sólo lectura |
| `ALEGRA_RETAIL_PRICE_LIST` | servidor | sí | Nombre exacto de la lista ARS minorista: `ARABES MINORISTA (pesos)` (D-10) |
| `ALEGRA_WHOLESALE_PRICE_LIST` | servidor | no | `MAYORISTA` |
| `SYNC_ALLOW_APPLY` | servidor | no | `true` habilita la escritura real del sync. Default `false` (sólo dry-run) |
| `CORREO_API_BASE`, `CORREO_API_USER`, `CORREO_API_PASSWORD`, `CORREO_CUSTOMER_ID`, `CORREO_ORIGIN_POSTCODE` | servidor | envíos | Credenciales de MiCorreo. Si faltan, se ofrecen sólo retiro y moto |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | servidor | emails | Proveedor SMTP propio. Si faltan, el pedido se registra igual y se audita `email_failed` |
| `SMTP_FROM` | servidor | no | Remitente (con SPF y DKIM del dominio) |
| `ORDER_NOTIFY_TO` | servidor | no | Default `Franzebi.imports@gmail.com` |
| `BANK_TRANSFER_DETAILS` | servidor | sí (prod) | Texto con banco, CBU y alias, que se muestra tras confirmar |
| `ASTROSELLING_ORDER_WEBHOOK_URL` | servidor | prod | Endpoint de pedidos del canal de AstroSelling (hoy `nova.astroselling.com/api/v1/channels/94200/webhooks/order`) |
| `ASTROSELLING_WEBHOOK_SECRET` | servidor | prod | Secreto de la firma `X-WC-Webhook-Signature` (HMAC-SHA256), el mismo que tenga configurado AstroSelling |
| `ORDER_DISPATCH_ENABLED` | servidor | no | `true` habilita el envío del outbox. Default `false`: en staging los pedidos de prueba no salen hacia AstroSelling ni Alegra |
| `E2E_*`, `LEGACY_BASE_URL` | CI | tests | Usuarios **de prueba de staging**. El config de Playwright bloquea producción |

**Generar secretos internos:** `openssl rand -base64 48`.

**Rotación:**

- `CRON_SECRET` y `CART_TOKEN_SECRET`: rotar si hay sospecha de filtración. Rotar `CART_TOKEN_SECRET` invalida los carritos de invitado y los links de pedido.
- `SUPABASE_SERVICE_ROLE_KEY`: rotar desde el panel de Supabase.

### Agregadas el 2026-11-21 (réplica de diseño, facturación y Correo)

| Variable | Ámbito | Requerida | Descripción |
|---|---|---|---|
| `LEGACY_MEDIA_ORIGIN` | servidor | staging | Origen de las fotos `/wp-content/uploads/` que no están en `public/`. En staging es `https://franzebi.ar`. Antes del cutover apunta al bucket donde se copien (D-29) |
| `ALEGRA_INVOICE_PRICE_LIST_ID` | servidor | sink alegra | Id de la lista "MINORISTA" (`019d6e8d-637f-7770-a791-2dda1f9f827b`) |
| `ALEGRA_INVOICE_WHOLESALE_PRICE_LIST_ID` | servidor | no | Id de "MAYORISTA" (`019d6e7c-6b31-7616-bebd-f75c10c5c4c0`) |
| `ALEGRA_INVOICE_NUMBER_TEMPLATE_ID` | servidor | no | Numeración "TICKET" (`3`) |
| `ALEGRA_INVOICE_WAREHOUSE_ID` | servidor | no | Depósito "Principal" (`1`) |
| `ALEGRA_INVOICE_SHIPPING_ITEM_ID` | servidor | no | Ítem "ENVIO" si se decide facturar el envío (AstroSelling hoy no lo hace) |
| `ALEGRA_INVOICE_STATUS` | servidor | no | `draft` (default: queda como borrador para revisar) u `open` |
| `CORREO_CUSTOMER_ID` / `CORREO_ORIGIN_POSTCODE` | servidor | envíos | `0001541970` / `1431` (tomados del plugin de WP) |
| `CORREO_API_USER` / `CORREO_API_PASSWORD` | servidor | envíos | Credenciales de la **API** MiCorreo: hay que pedirlas a Correo Argentino (D-28) |
