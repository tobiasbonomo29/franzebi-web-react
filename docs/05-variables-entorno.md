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
