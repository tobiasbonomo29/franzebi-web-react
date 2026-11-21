"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatArs, type CartTotals, type PaymentOption, type ShippingOption } from "@franzebi/domain";
import { WholesaleBox } from "@/components/WholesaleBox";

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

export function CheckoutForm() {
  const router = useRouter();
  const [dest, setDest] = useState({ postcode: "", state: "C", city: "" });
  const [delivery, setDelivery] = useState<string | null>(null);
  const [payment, setPayment] = useState<"bank_transfer" | "cash" | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const seq = useRef(0);

  // Toda la lógica de envío/pago la resuelve el servidor; el cliente sólo refleja la selección normalizada.
  const requote = useCallback(async (d = dest, del = delivery, pay = payment) => {
    const my = ++seq.current;
    setLoading(true);
    const r = await fetch("/api/checkout/quote/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ destination: d.postcode ? d : undefined, deliveryOptionId: del, paymentMethod: pay }) });
    const j = (await r.json()) as Quote;
    if (my !== seq.current) return; // respuesta vieja: se descarta (evita parpadeos / toggles)
    setLoading(false);
    if (!r.ok) { setError("No pudimos calcular el envío. Reintentá."); return; }
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
    setSubmitting(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const g = (k: string) => String(f.get(k) ?? "");
    const r = await fetch("/api/checkout/place/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        destination: dest, deliveryOptionId: delivery, paymentMethod: payment,
        billing: { firstName: g("firstName"), lastName: g("lastName"), email: g("email"), phone: g("phone"), dni: g("dni").replace(/\D/g, "") },
        address: g("street") ? { street: g("street"), number: g("number"), apartment: g("apartment") || undefined } : undefined,
        note: g("note") || undefined,
        expectedTotalCents: quote.totals.totalCents,
      }),
    });
    const j = await r.json();
    setSubmitting(false);
    if (r.ok) { router.push(j.redirect); return; }
    setError(j.error ?? "No pudimos confirmar el pedido");
    if (r.status === 409) void requote();
  }

  const t = quote?.totals;
  const needsAddress = quote?.shippingOptions.find((o) => o.id === delivery)?.kind !== "local_pickup";

  return (
    <form className="checkout" onSubmit={submit} noValidate>
      <div>
        <fieldset>
          <legend>Tus datos</legend>
          <div className="row2">
            <div className="field"><label htmlFor="firstName">Nombre</label><input id="firstName" name="firstName" required autoComplete="given-name" /></div>
            <div className="field"><label htmlFor="lastName">Apellido</label><input id="lastName" name="lastName" required autoComplete="family-name" /></div>
          </div>
          <div className="row2">
            <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" required autoComplete="email" /></div>
            <div className="field"><label htmlFor="phone">Teléfono / WhatsApp</label><input id="phone" name="phone" type="tel" required autoComplete="tel" /></div>
          </div>
          <div className="field"><label htmlFor="dni">DNI</label><input id="dni" name="dni" inputMode="numeric" required pattern="\d{7,9}" /></div>
        </fieldset>

        <fieldset>
          <legend>Destino</legend>
          <div className="row2">
            <div className="field"><label htmlFor="state">Provincia</label>
              <select id="state" value={dest.state} onChange={(e) => setDest({ ...dest, state: e.target.value })}>{PROVINCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </div>
            <div className="field"><label htmlFor="postcode">Código postal</label><input id="postcode" inputMode="numeric" value={dest.postcode} onChange={(e) => setDest({ ...dest, postcode: e.target.value })} autoComplete="postal-code" /></div>
          </div>
          <div className="field"><label htmlFor="city">Localidad</label><input id="city" value={dest.city} onChange={(e) => setDest({ ...dest, city: e.target.value })} autoComplete="address-level2" /></div>
        </fieldset>

        <fieldset aria-busy={loading}>
          <legend>Método de entrega</legend>
          {quote?.motoUnavailableReason && dest.postcode && <p className="notice warn">{MOTO_REASON[quote.motoUnavailableReason]}</p>}
          {quote?.correoUnavailable && <p className="notice warn">Correo Argentino no respondió. Reintentá en unos segundos o elegí otra opción.</p>}
          {quote?.shippingOptions.map((o) => (
            <label key={o.id} className="option">
              <input type="radio" name="delivery" value={o.id} checked={delivery === o.id} onChange={() => { setDelivery(o.id); void requote(dest, o.id, payment); }} />
              <span className="label">{o.label}{o.id === delivery && quote.estimatedDelivery && <><br /><small>{quote.estimatedDelivery}</small></>}</span>
              <span className="amount">{o.priceCents ? formatArs(o.priceCents) : "Gratis"}</span>
            </label>
          ))}
        </fieldset>

        {needsAddress && delivery && (
          <fieldset>
            <legend>Dirección de entrega</legend>
            <div className="row2">
              <div className="field"><label htmlFor="street">Calle</label><input id="street" name="street" required autoComplete="address-line1" /></div>
              <div className="field"><label htmlFor="number">Número</label><input id="number" name="number" required /></div>
            </div>
            <div className="field"><label htmlFor="apartment">Piso / Depto (opcional)</label><input id="apartment" name="apartment" autoComplete="address-line2" /></div>
          </fieldset>
        )}

        <fieldset>
          <legend>Medio de pago</legend>
          {quote?.paymentNotice && <p className="notice warn" role="status">{quote.paymentNotice}</p>}
          {!delivery && <p><small>Elegí un método de entrega para ver los medios de pago.</small></p>}
          {delivery && quote?.paymentOptions.map((p) => (
            <label key={p.id} className="option">
              <input type="radio" name="payment" value={p.id} checked={payment === p.id} onChange={() => { setPayment(p.id as "bank_transfer" | "cash"); void requote(dest, delivery, p.id as "bank_transfer" | "cash"); }} />
              <span className="label">{p.label}{p.id === "bank_transfer" && <><br /><small>El pedido queda En espera hasta validar el pago.</small></>}</span>
            </label>
          ))}
        </fieldset>
        <div className="field"><label htmlFor="note">Notas del pedido (opcional)</label><textarea id="note" name="note" rows={3} maxLength={500} /></div>
      </div>

      <aside>
        <div className="totals" style={{ width: "100%" }}>
          <h2>Tu pedido</h2>
          {t?.issues.map((i) => <p key={i.sku + i.type} className="notice warn">{i.message}</p>)}
          {t?.lines.map((l) => (
            <div key={l.sku} style={{ display: "flex", justifyContent: "space-between", gap: "1rem", marginBottom: ".4rem" }}>
              <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{l.name} × {l.quantity}</span><span>{formatArs(l.lineTotalCents)}</span>
            </div>
          ))}
          {t && <WholesaleBox w={t.wholesale} />}
          {t && (
            <dl>
              <dt>Subtotal</dt><dd>{formatArs(t.subtotalCents)}</dd>
              <dt>Envío</dt><dd>{t.shipping ? (t.shippingCents ? formatArs(t.shippingCents) : "Gratis") : "—"}</dd>
              {t.cashDiscountCents > 0 && <><dt>Descuento efectivo</dt><dd>-{formatArs(t.cashDiscountCents)}</dd></>}
              <dt className="grand">Total</dt><dd className="grand">{formatArs(t.totalCents)}</dd>
            </dl>
          )}
          {error && <p className="notice err" role="alert">{error}</p>}
          <button className="btn" style={{ width: "100%", marginTop: "1rem" }} disabled={!t?.lines.length || !delivery || !payment || loading || submitting}>
            {submitting ? "Confirmando…" : "Confirmar pedido"}
          </button>
        </div>
      </aside>
    </form>
  );
}
