import "server-only";
import { formatArs } from "@franzebi/domain";
import nodemailer from "nodemailer";
import { env } from "./env";

interface OrderMail {
  number: number;
  email: string;
  customerName: string;
  status: string;
  paymentLabel: string;
  deliveryLabel: string;
  lines: Array<{ name: string; sku: string; quantity: number; lineTotalCents: number }>;
  subtotalCents: number;
  shippingCents: number;
  cashDiscountCents: number;
  totalCents: number;
  bankDetails?: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function render(o: OrderMail, forBusiness: boolean) {
  const rows = o.lines.map((l) => `<tr><td>${esc(l.name)}<br><small>SKU ${esc(l.sku)}</small></td><td align="center">${l.quantity}</td><td align="right">${formatArs(l.lineTotalCents)}</td></tr>`).join("");
  return `<div style="font-family:Arial,sans-serif;max-width:600px">
  <h2 style="color:#6D28D9">${forBusiness ? "Nuevo pedido" : "¡Gracias por tu compra!"} #${o.number}</h2>
  ${forBusiness ? `<p>Cliente: ${esc(o.customerName)} &lt;${esc(o.email)}&gt;</p>` : `<p>Hola ${esc(o.customerName)}, recibimos tu pedido.</p>`}
  <p>Estado: <b>${esc(o.status)}</b><br>Entrega: ${esc(o.deliveryLabel)}<br>Pago: ${esc(o.paymentLabel)}</p>
  <table width="100%" cellpadding="6" style="border-collapse:collapse;border:1px solid #eee">${rows}</table>
  <p>Subtotal: ${formatArs(o.subtotalCents)}<br>Envío: ${formatArs(o.shippingCents)}${o.cashDiscountCents ? `<br>Descuento efectivo: -${formatArs(o.cashDiscountCents)}` : ""}<br><b>Total: ${formatArs(o.totalCents)}</b></p>
  ${!forBusiness && o.bankDetails ? `<p><b>Datos para transferir</b><br>${esc(o.bankDetails).replace(/\n/g, "<br>")}<br>Usá el número de pedido como referencia. Tu pedido queda En espera hasta validar el pago.</p>` : ""}
  </div>`;
}

let transport: nodemailer.Transporter | null = null;
function tx() {
  const e = env();
  if (!e.SMTP_HOST || !e.SMTP_USER || !e.SMTP_PASS) return null;
  transport ??= nodemailer.createTransport({ host: e.SMTP_HOST, port: e.SMTP_PORT, secure: e.SMTP_PORT === 465, auth: { user: e.SMTP_USER, pass: e.SMTP_PASS } });
  return transport;
}

/** Envía confirmación al cliente y aviso al negocio. Un fallo de email nunca rompe el pedido (se loguea sin datos sensibles). */
export async function sendOrderEmails(o: OrderMail): Promise<{ sent: boolean; error?: string }> {
  const t = tx();
  if (!t) return { sent: false, error: "SMTP no configurado" };
  const e = env();
  try {
    await Promise.all([
      t.sendMail({ from: e.SMTP_FROM, to: o.email, subject: `Franzebi Imports — Pedido #${o.number} recibido`, html: render(o, false) }),
      t.sendMail({ from: e.SMTP_FROM, to: e.ORDER_NOTIFY_TO, replyTo: o.email, subject: `Nuevo pedido #${o.number} — ${formatArs(o.totalCents)}`, html: render(o, true) }),
    ]);
    return { sent: true };
  } catch (err) {
    console.error("[email] fallo envío pedido", o.number, (err as Error).name);
    return { sent: false, error: (err as Error).message };
  }
}
