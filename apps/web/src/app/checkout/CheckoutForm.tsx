"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CartTotals, PaymentOption, ShippingOption } from "@franzebi/domain";

/**
 * Checkout con el markup de WooCommerce (form-checkout.php + review-order.php + payment.php) para que el CSS
 * heredado lo pinte igual. Toda la lógica de envío/pago/totales la resuelve el servidor (/api/checkout/quote):
 * el cliente sólo refleja la selección normalizada que devuelve.
 */
interface Quote {
  totals: CartTotals;
  shippingOptions: ShippingOption[];
  paymentOptions: PaymentOption[];
  selectedDeliveryOptionId: string | null;
  selectedPayment: "bank_transfer" | "cash";
  paymentNotice: string | null;
  motoUnavailableReason: string | null;
  correoUnavailable: boolean;
  estimatedDelivery: string | null;
}

const PROVINCES: Array<[string, string]> = [["C", "Ciudad Autónoma de Buenos Aires"], ["B", "Buenos Aires"], ["K", "Catamarca"], ["H", "Chaco"], ["U", "Chubut"], ["X", "Córdoba"], ["W", "Corrientes"], ["E", "Entre Ríos"], ["P", "Formosa"], ["Y", "Jujuy"], ["L", "La Pampa"], ["F", "La Rioja"], ["M", "Mendoza"], ["N", "Misiones"], ["Q", "Neuquén"], ["R", "Río Negro"], ["A", "Salta"], ["J", "San Juan"], ["D", "San Luis"], ["Z", "Santa Cruz"], ["S", "Santa Fe"], ["G", "Santiago del Estero"], ["V", "Tierra del Fuego"], ["T", "Tucumán"]];

const MOTO_REASON: Record<string, string> = {
  excluded: "Tu localidad está fuera de la cobertura de moto. Podés elegir Correo Argentino o retirar por el local.",
  ambiguous: "No pudimos confirmar la zona de moto con ese código postal y localidad. Mostramos Correo Argentino y retiro por el local.",
  out_of_coverage: "Moto mensajería no llega a tu zona. Podés elegir Correo Argentino o retiro por el local.",
  invalid_postcode: "Ingresá un código postal válido para ver envíos.",
};

const PAYMENT_TEXT: Record<string, { label: string; text: string }> = {
  bank_transfer: {
    label: "Transferencia Bancaria",
    text: "Realiza tu pago directamente en nuestra cuenta bancaria. Por favor, usa el número del pedido como referencia de pago. Tu pedido no se procesará hasta que se haya recibido el importe en nuestra cuenta. enviar comprobante a nuestro whatsapp para confirmar la compra",
  },
  cash: { label: "Efectivo en el local (5% OFF)", text: "Pagás en efectivo al retirar tu pedido por el local, con 5% de descuento." },
};

function Price({ cents }: { cents: number }) {
  const v = (cents / 100).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <span className="woocommerce-Price-amount amount"><bdi><span className="woocommerce-Price-currencySymbol">$</span>&nbsp;{v}</bdi></span>
  );
}

function Row({ id, label, required, wide, first, last, children }: { id: string; label: string; required?: boolean; wide?: boolean; first?: boolean; last?: boolean; children: React.ReactNode }) {
  const cls = first ? "form-row-first" : last ? "form-row-last" : wide !== false ? "form-row-wide" : "";
  return (
    <p className={`form-row ${cls} ${required ? "validate-required" : ""}`} id={`${id}_field`}>
      <label htmlFor={id} className={required ? "required_field" : ""}>
        {label}&nbsp;{required ? <span className="required" aria-hidden="true">*</span> : <span className="optional">(opcional)</span>}
      </label>
      <span className="woocommerce-input-wrapper">{children}</span>
    </p>
  );
}

export function CheckoutForm() {
  const [dest, setDest] = useState({ postcode: "", state: "C", city: "" });
  const [delivery, setDelivery] = useState<string | null>(null);
  const [payment, setPayment] = useState<"bank_transfer" | "cash" | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const seq = useRef(0);
  const [agencies, setAgencies] = useState<Array<{ code: string; name: string; address: string; city: string }> | null>(null);
  const [agency, setAgency] = useState("");
  const toBranch = !!delivery && delivery.startsWith("correo:") && delivery.endsWith("_s");

  // Sucursales de Correo para "a sucursal" (por provincia), como el selector del plugin de WP
  useEffect(() => {
    if (!toBranch) return;
    let alive = true;
    setAgencies(null);
    fetch(`/api/correo/agencies/?state=${dest.state}`).then((r) => r.json()).then((j) => { if (alive) setAgencies(j.agencies ?? []); }).catch(() => alive && setAgencies([]));
    return () => { alive = false; };
  }, [toBranch, dest.state]);

  const requote = useCallback(async (d = dest, del = delivery, pay = payment) => {
    const my = ++seq.current;
    setLoading(true);
    const r = await fetch("/api/checkout/quote/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ destination: d.postcode ? d : undefined, deliveryOptionId: del, paymentMethod: pay }) });
    const j = (await r.json()) as Quote;
    if (my !== seq.current) return; // respuesta vieja: se descarta
    setLoading(false);
    if (!r.ok) { setErrors(["No pudimos calcular el envío. Reintentá."]); return; }
    setQuote(j);
    setDelivery(j.selectedDeliveryOptionId);
    setPayment(j.selectedPayment);
  }, [dest, delivery, payment]);

  useEffect(() => { void requote(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (dest.postcode.replace(/\D/g, "").length < 4) return;
    const t = setTimeout(() => void requote(dest, delivery, payment), 450);
    return () => clearTimeout(t);
  }, [dest.postcode, dest.state, dest.city]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!quote || !delivery || !payment) return;
    const f = new FormData(e.currentTarget);
    const g = (k: string) => String(f.get(k) ?? "").trim();
    const missing: string[] = [];
    const req: Array<[string, string]> = [["billing_first_name", "Nombre"], ["billing_last_name", "Apellidos"], ["billing_dni", "DNI"], ["billing_city", "Ciudad / Localidad"], ["billing_postcode", "Código postal / ZIP"], ["billing_phone", "Teléfono"], ["billing_email", "Dirección de correo electrónico"]];
    const kind = quote.shippingOptions.find((o) => o.id === delivery)?.kind;
    if (kind !== "local_pickup" && !toBranch) req.splice(3, 0, ["billing_address_1", "Dirección de la calle"]);
    if (toBranch && !agency) missing.push("<strong>Sucursal de Correo Argentino</strong> es un campo obligatorio.");
    for (const [k, label] of req) if (!g(k)) missing.push(`<strong>${label}</strong> es un campo obligatorio.`);
    if (g("billing_dni") && !/^\d{7,9}$/.test(g("billing_dni").replace(/\D/g, ""))) missing.push("<strong>DNI</strong> no es válido (7 a 9 números, sin puntos).");
    if (missing.length) { setErrors(missing); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    setSubmitting(true);
    setErrors([]);
    const r = await fetch("/api/checkout/place/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        destination: dest, deliveryOptionId: delivery, paymentMethod: payment,
        billing: { firstName: g("billing_first_name"), lastName: g("billing_last_name"), email: g("billing_email"), phone: g("billing_phone"), dni: g("billing_dni").replace(/\D/g, "") },
        address: g("billing_address_1") || agency
          ? { street: g("billing_address_1"), number: "", apartment: g("billing_address_2") || undefined, agency: agency ? { code: agency, name: agencies?.find((a) => a.code === agency)?.name ?? agency } : undefined }
          : undefined,
        note: g("order_comments") || undefined,
        expectedTotalCents: quote.totals.totalCents,
      }),
    });
    const j = await r.json();
    if (r.ok) { location.href = j.redirect; return; }
    setSubmitting(false);
    const fieldErrors = (j.fields as Array<{ message: string }> | undefined)?.map((x) => x.message) ?? [];
    setErrors([j.error ?? "No pudimos confirmar el pedido", ...fieldErrors]);
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (r.status === 409) void requote();
  }

  const t = quote?.totals;

  return (
    <>
      <div className="woocommerce-notices-wrapper">
        {errors.length > 0 && (
          <ul className="woocommerce-error" role="alert">
            {errors.map((m) => <li key={m} dangerouslySetInnerHTML={{ __html: m.replace(/<(?!\/?strong>)[^>]*>/g, "") }} />)}
          </ul>
        )}
        {t?.issues.map((i) => <ul key={i.sku + i.type} className="woocommerce-error" role="alert"><li>{i.message}</li></ul>)}
      </div>
      <form name="checkout" method="post" className="checkout woocommerce-checkout" action="/checkout/" onSubmit={submit} noValidate aria-label="Finalizar compra">
        <div className="e-checkout__container">
          <div className="e-checkout__column e-checkout__column-start">
            <div className="col2-set" id="customer_details">
              <div className="col-1">
                <div className="woocommerce-billing-fields">
                  <h3>Finalizar Compra</h3>
                  <div className="woocommerce-billing-fields__field-wrapper">
                    <Row id="billing_first_name" label="Nombre" required first><input type="text" className="input-text " name="billing_first_name" id="billing_first_name" placeholder="Nombre" autoComplete="given-name" /></Row>
                    <Row id="billing_last_name" label="Apellidos" required last><input type="text" className="input-text " name="billing_last_name" id="billing_last_name" placeholder="Apellidos" autoComplete="family-name" /></Row>
                    <Row id="billing_dni" label="DNI" required><input type="text" className="input-text " name="billing_dni" id="billing_dni" placeholder="Ingrese su DNI sin puntos" inputMode="numeric" /></Row>
                    <Row id="billing_address_1" label="Dirección de la calle" required><input type="text" className="input-text " name="billing_address_1" id="billing_address_1" placeholder="Nombre de la calle y número de la casa" autoComplete="address-line1" /></Row>
                    <Row id="billing_address_2" label="Altura, piso y departamento"><input type="text" className="input-text " name="billing_address_2" id="billing_address_2" placeholder="Apartamento, habitación, etc. (opcional)" autoComplete="address-line2" /></Row>
                    <Row id="billing_city" label="Ciudad / Localidad" required><input type="text" className="input-text " name="billing_city" id="billing_city" autoComplete="address-level2" value={dest.city} onChange={(e) => setDest({ ...dest, city: e.target.value })} /></Row>
                    <Row id="billing_state" label="Región / Provincia" required>
                      <select name="billing_state" id="billing_state" className="state_select" autoComplete="address-level1" value={dest.state} onChange={(e) => setDest({ ...dest, state: e.target.value })}>
                        {PROVINCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </Row>
                    <Row id="billing_postcode" label="Código postal / ZIP" required><input type="text" className="input-text " name="billing_postcode" id="billing_postcode" inputMode="numeric" autoComplete="postal-code" value={dest.postcode} onChange={(e) => setDest({ ...dest, postcode: e.target.value })} /></Row>
                    <Row id="billing_phone" label="Teléfono" required><input type="tel" className="input-text " name="billing_phone" id="billing_phone" placeholder="Teléfono" autoComplete="tel" /></Row>
                    <Row id="billing_email" label="Dirección de correo electrónico" required><input type="email" className="input-text " name="billing_email" id="billing_email" placeholder="Dirección de correo electrónico" autoComplete="email" /></Row>
                  </div>
                </div>
              </div>
              <div className="col-2">
                <div className="woocommerce-shipping-fields" />
                <div className="woocommerce-additional-fields">
                  <h3 />
                  <div className="woocommerce-additional-fields__field-wrapper">
                    <Row id="order_comments" label="Notas del pedido"><textarea name="order_comments" className="input-text " id="order_comments" placeholder="Notas sobre tu pedido, por ejemplo, notas especiales para la entrega." rows={2} cols={5} maxLength={500} /></Row>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="e-checkout__column e-checkout__column-end">
            <div className="e-checkout__column-inner e-sticky-right-column">
              <div className="e-checkout__order_review">
                <h3 id="order_review_heading">Tu pedido</h3>
                <div id="order_review" className={`woocommerce-checkout-review-order${loading ? " processing" : ""}`} aria-busy={loading}>
                  <table className="shop_table woocommerce-checkout-review-order-table">
                    <thead><tr><th className="product-name">Producto</th><th className="product-total">Subtotal</th></tr></thead>
                    <tbody>
                      {t?.lines.map((l) => (
                        <tr className="cart_item" key={l.sku}>
                          <td className="product-name">{l.name}&nbsp; <strong className="product-quantity">×&nbsp;{l.quantity}</strong>{l.wholesaleApplied && <><br /><small>Precio mayorista</small></>}</td>
                          <td className="product-total"><Price cents={l.lineTotalCents} /></td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="cart-subtotal"><th>Subtotal</th><td>{t && <Price cents={t.subtotalCents} />}</td></tr>
                      <tr className="woocommerce-shipping-totals shipping">
                        <th>Envío</th>
                        <td data-title="Envío">
                          {quote?.motoUnavailableReason && dest.postcode && <p className="woocommerce-info fz-notice">{MOTO_REASON[quote.motoUnavailableReason]}</p>}
                          {quote?.correoUnavailable && <p className="woocommerce-info fz-notice">Correo Argentino no respondió. Reintentá en unos segundos o elegí otra opción.</p>}
                          <ul id="shipping_method" className="woocommerce-shipping-methods">
                            {quote?.shippingOptions.map((o) => (
                              <li key={o.id}>
                                <input type="radio" name="shipping_method[0]" data-index="0" id={`shipping_method_0_${o.id}`} value={o.id} className="shipping_method" checked={delivery === o.id} onChange={() => { setDelivery(o.id); void requote(dest, o.id, payment); }} />
                                <label htmlFor={`shipping_method_0_${o.id}`}>
                                  {o.label}{o.priceCents ? <>: <Price cents={o.priceCents} /></> : null}
                                </label>
                                {o.id === delivery && quote.estimatedDelivery && <p className="fz-eta"><small>{quote.estimatedDelivery}</small></p>}
                              </li>
                            ))}
                          </ul>
                          {toBranch && (
                            <p className="form-row form-row-wide validate-required" id="correo_agency_field">
                              <label htmlFor="correo_agency">Sucursal de Correo Argentino&nbsp;<span className="required">*</span></label>
                              <span className="woocommerce-input-wrapper">
                                <select id="correo_agency" name="correo_agency" value={agency} onChange={(e) => setAgency(e.target.value)} disabled={!agencies}>
                                  <option value="">{agencies ? (agencies.length ? "Elegí una sucursal…" : "No hay sucursales disponibles") : "Cargando sucursales…"}</option>
                                  {agencies?.map((a) => <option key={a.code} value={a.code}>{a.city} — {a.name} ({a.address})</option>)}
                                </select>
                              </span>
                            </p>
                          )}
                          {!dest.postcode && <p className="woocommerce-shipping-destination"><small>Ingresá tu código postal para ver moto y Correo Argentino.</small></p>}
                        </td>
                      </tr>
                      {t && t.cashDiscountCents > 0 && <tr className="fee"><th>Descuento efectivo (5%)</th><td>-<Price cents={t.cashDiscountCents} /></td></tr>}
                      <tr className="order-total"><th>Total</th><td><strong>{t && <Price cents={t.totalCents} />}</strong> </td></tr>
                    </tfoot>
                  </table>
                </div>
              </div>
              <div className="e-checkout__order_review-2">
                {t && !t.wholesale.qualifies && t.wholesale.points > 0 && (
                  <p className="woocommerce-info fz-wholesale">Llevás {t.wholesale.points.toLocaleString("es-AR")} de {t.wholesale.threshold.toLocaleString("es-AR")} puntos para precio mayorista. Te faltan {t.wholesale.missingPoints.toLocaleString("es-AR")}.</p>
                )}
                <p className="woocommerce-info franzebi-shipping-payment-note">Los envios se abonan por transferencia bancaria. Si retiras por el local podes pagar por transferencia o en efectivo, con 5% de descuento.</p>
                {quote?.paymentNotice && <p className="woocommerce-info fz-notice" role="status">{quote.paymentNotice}</p>}
                <div id="payment" className="woocommerce-checkout-payment">
                  <ul className="wc_payment_methods payment_methods methods">
                    {delivery && quote?.paymentOptions.map((p) => (
                      <li key={p.id} className={`wc_payment_method payment_method_${p.id === "bank_transfer" ? "bacs" : "cod"}`}>
                        <input id={`payment_method_${p.id}`} type="radio" className="input-radio" name="payment_method" value={p.id} checked={payment === p.id} onChange={() => { setPayment(p.id as "bank_transfer" | "cash"); void requote(dest, delivery, p.id as "bank_transfer" | "cash"); }} />
                        <label htmlFor={`payment_method_${p.id}`}>{PAYMENT_TEXT[p.id]?.label ?? p.label}</label>
                        {payment === p.id && <div className={`payment_box payment_method_${p.id === "bank_transfer" ? "bacs" : "cod"}`}><p>{PAYMENT_TEXT[p.id]?.text}</p></div>}
                      </li>
                    ))}
                  </ul>
                  <div className="form-row place-order">
                    <button type="submit" className="button alt" name="woocommerce_checkout_place_order" id="place_order" value="Realizar el pedido" disabled={!t?.lines.length || !delivery || !payment || loading || submitting}>
                      {submitting ? "Procesando…" : "Realizar el pedido"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </form>
    </>
  );
}
