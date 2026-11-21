import "server-only";
import { z } from "zod";

/**
 * Variables de entorno del SERVIDOR. Se validan al primer uso; nunca se envían al browser.
 * Documentación: docs/05-variables-entorno.md
 */
const schema = z.object({
  SITE_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  CART_TOKEN_SECRET: z.string().min(32),
  CRON_SECRET: z.string().min(24),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default("Franzebi Imports <no-reply@franzebi.ar>"),
  ORDER_NOTIFY_TO: z.string().default("Franzebi.imports@gmail.com"),
  CORREO_API_BASE: z.string().url().optional(),
  CORREO_API_USER: z.string().optional(),
  CORREO_API_PASSWORD: z.string().optional(),
  CORREO_CUSTOMER_ID: z.string().optional(),
  CORREO_ORIGIN_POSTCODE: z.string().optional(),
  ALEGRA_API_EMAIL: z.string().optional(),
  ALEGRA_API_TOKEN: z.string().optional(),
  ALEGRA_RETAIL_PRICE_LIST: z.string().default("General"),
  ALEGRA_WHOLESALE_PRICE_LIST: z.string().default("MAYORISTA"),
  SYNC_ALLOW_APPLY: z.enum(["true", "false"]).default("false"),
  BANK_TRANSFER_DETAILS: z.string().optional(), // CBU/alias: dato operativo, se carga por entorno
  ASTROSELLING_ORDER_WEBHOOK_URL: z.string().url().optional(),
  ASTROSELLING_WEBHOOK_SECRET: z.string().optional(),
  ORDER_DISPATCH_ENABLED: z.enum(["true", "false"]).default("false"),
});

let cached: z.infer<typeof schema> | null = null;
export function env() {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Se listan sólo los NOMBRES de las variables, nunca sus valores
    throw new Error(`Variables de entorno inválidas: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  }
  cached = parsed.data;
  return cached;
}
