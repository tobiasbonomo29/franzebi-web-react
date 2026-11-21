/** CTA de consulta por WhatsApp para productos a pedido. El mensaje incluye nombre y SKU (requisito). */
export const FRANZEBI_WHATSAPP = "5491128720954"; // +54 9 11 2872-0954

export function whatsappInquiryUrl(p: { name: string; sku: string; url?: string }, phone = FRANZEBI_WHATSAPP): string {
  const parts = [`Hola, quiero consultar por este producto a pedido: ${p.name} (SKU: ${p.sku})`];
  if (p.url) parts.push(p.url);
  return `https://wa.me/${phone}?text=${encodeURIComponent(parts.join(" - "))}`;
}

export function whatsappReceiptUrl(orderNumber: string | number, phone = FRANZEBI_WHATSAPP): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(`Hola! Te envío el comprobante de pago del pedido #${orderNumber}`)}`;
}
