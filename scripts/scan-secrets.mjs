// Escaneo simple de secretos en archivos versionados. Uso: npm run secrets:scan (también en CI / pre-commit).
import { execSync } from "node:child_process";
import fs from "node:fs";

const files = execSync("git ls-files -co --exclude-standard", { encoding: "utf8" }).split("\n").filter(Boolean);
const rules = [
  [/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{20,}/, "JWT (posible clave Supabase)"],
  [/sb_secret_[A-Za-z0-9_-]{10,}/, "Supabase secret key"],
  [/-----BEGIN (RSA |EC )?PRIVATE KEY-----/, "clave privada"],
  [/(ALEGRA|SMTP|CORREO|SUPABASE_SERVICE_ROLE|CRON|CART_TOKEN)[A-Z_]*\s*[=:]\s*["']?(?!z\.|process\.)[A-Za-z0-9+/_.@-]{16,}/, "variable sensible con valor"],
  [/define\(\s*'FRANZEBI_ALEGRA_API_TOKEN'/, "token Alegra estilo snippet WP"],
  [/APP_USR-[0-9a-f-]{20,}/, "token Mercado Pago"],
];
const allow = new Set([".env.example", "scripts/scan-secrets.mjs", "docs/05-variables-entorno.md"]);
let hits = 0;
for (const f of files) {
  if (allow.has(f) || /node_modules|\.png$|\.svg$|package-lock\.json$/.test(f) || !fs.existsSync(f)) continue;
  const txt = fs.readFileSync(f, "utf8");
  for (const [re, label] of rules) {
    const m = txt.match(re);
    if (m) { hits++; console.log(`✗ ${f}: ${label}`); }
  }
}
if (hits) { console.error(`\n${hits} posible(s) secreto(s). Movelos a variables de entorno.`); process.exit(1); }
console.log(`✓ sin secretos detectados en ${files.length} archivos`);
