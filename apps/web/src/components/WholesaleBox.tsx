import type { WholesaleEvaluation } from "@franzebi/domain";

/** Beneficio mayorista: puntos acumulados, faltantes y motivo (en carrito y checkout). */
export function WholesaleBox({ w }: { w: WholesaleEvaluation }) {
  const pct = Math.min(100, Math.round((w.points / w.threshold) * 100));
  return (
    <div className={`notice ${w.qualifies ? "ok" : ""}`} aria-live="polite">
      <strong>{w.mode === "restock" ? "Re-stock mayorista" : "Precio mayorista (primera compra)"}</strong>
      <div className="wholesale-meter" role="progressbar" aria-valuemin={0} aria-valuemax={w.threshold} aria-valuenow={w.points} aria-label="Puntos mayoristas">
        <span style={{ width: `${pct}%` }} />
      </div>
      <p style={{ margin: ".4rem 0 0" }}>
        {w.points} / {w.threshold} puntos · {w.reason}
      </p>
      <small>Cada categoría suma distinto (árabes, diseñador, cosmética). Ver detalle en <a href="/faq/">FAQs</a>.</small>
    </div>
  );
}
