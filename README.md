# Franzebi Imports — ecommerce propio

Reemplazo de WordPress, WooCommerce y Elementor para **franzebi.ar** con Next.js, Node y Supabase. Repositorio, hosting, Supabase, DNS y credenciales quedan a nombre del dueño.

> Estado (2026-11-21): **base de staging en Supabase lista** (5 migraciones + seed, sin productos todavía). App sin desplegar en Vercel. Producción (WordPress) no se tocó.

## Documentación

1. [Relevamiento del sitio actual](docs/01-auditoria.md), con hallazgos de seguridad urgentes
2. [Arquitectura](docs/02-arquitectura.md)
3. [Decisiones pendientes y contradicciones](docs/03-decisiones-pendientes.md), que **requieren respuesta del dueño**
4. [Plan de migración, DNS, rollback y checklist](docs/04-plan-migracion.md)
5. [Variables de entorno](docs/05-variables-entorno.md)

## Estructura

```
packages/domain   reglas comerciales puras (envíos, pagos, mayorista, búsqueda, imágenes)
packages/sync     adaptador Alegra + motor de sync idempotente + CLI dry-run
apps/web          Next.js: tienda, API, panel /admin
supabase/         migraciones SQL, RLS, RPC, seed (generado), tests SQL
e2e/              Playwright (desktop + mobile) contra staging
data/             URLs y árbol de categorías públicos relevados de Woo
scripts/          gen-seed, scan-secrets
```

## Comandos

```bash
npm install
npm test                 # 81 tests de dominio, sync y outbox
npm run test:db          # 34 verificaciones de esquema, RLS y transacciones (PGlite)
npm run typecheck
npm run secrets:scan
npx tsx scripts/gen-seed.ts   # regenera supabase/seed.sql desde los defaults del dominio
npm run sync:dry-run     # requiere .env.local con credenciales de Alegra (no escribe nada)
npm run dev              # app en http://localhost:3000 (requiere Supabase)
E2E_BASE_URL=https://staging... npm run e2e
```
