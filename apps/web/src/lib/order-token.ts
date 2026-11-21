import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/** Token de acceso a la página de confirmación para invitados (número de pedido es secuencial => no basta). */
export function orderAccessToken(orderId: string) {
  return createHmac("sha256", env().CART_TOKEN_SECRET).update(`order:${orderId}`).digest("base64url").slice(0, 32);
}
export function verifyOrderAccessToken(orderId: string, token: string | undefined) {
  if (!token) return false;
  const a = Buffer.from(orderAccessToken(orderId));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
