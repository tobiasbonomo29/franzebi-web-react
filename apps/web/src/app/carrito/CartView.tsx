"use client";
import Link from "next/link";
import { formatArs } from "@franzebi/domain";
import { useCart } from "@/components/CartDrawer";
import { WholesaleBox } from "@/components/WholesaleBox";

export function CartView() {
  const { totals, setQty, error } = useCart();
  if (!totals) return <p>Cargando…</p>;
  return (
    <>
      {error && <p className="notice err" role="alert">{error}</p>}
      {totals.issues.map((i) => <p key={i.sku + i.type} className="notice warn" role="status">{i.message}</p>)}
      {totals.lines.length === 0 ? (
        <p>Tu carrito está vacío. <Link href="/">Volver a la tienda</Link></p>
      ) : (
        <>
          <table className="cart-table">
            <thead><tr><th>Producto</th><th className="num">Precio</th><th>Cantidad</th><th className="num">Subtotal</th></tr></thead>
            <tbody>
              {totals.lines.map((l) => (
                <tr key={l.sku}>
                  <td className="name">{l.name} {l.wholesaleApplied && <span className="badge">Mayorista</span>}{l.note && <><br /><small>{l.note}</small></>}</td>
                  <td className="num" data-label="Precio">{formatArs(l.unitPriceCents)}</td>
                  <td data-label="Cantidad">
                    <span className="qty">
                      <button onClick={() => setQty(l.sku, l.quantity - 1)} aria-label={`Quitar uno de ${l.name}`}>−</button>
                      <span style={{ minWidth: "2rem", textAlign: "center" }}>{l.quantity}</span>
                      <button onClick={() => setQty(l.sku, l.quantity + 1)} aria-label={`Agregar uno de ${l.name}`}>+</button>
                    </span>
                    <button className="menu-toggle" style={{ display: "inline-block" }} onClick={() => setQty(l.sku, 0)} aria-label={`Eliminar ${l.name}`}>🗑</button>
                  </td>
                  <td className="num" data-label="Subtotal">{formatArs(l.lineTotalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="totals">
            <WholesaleBox w={totals.wholesale} />
            <dl>
              <dt>Subtotal</dt><dd>{formatArs(totals.subtotalCents)}</dd>
              {totals.wholesale.savingsCents > 0 && <><dt>Ahorro mayorista (aplicado)</dt><dd>-{formatArs(totals.wholesale.savingsCents)}</dd></>}
            </dl>
            <p><small>El envío y los medios de pago se calculan en el checkout según tu dirección y método de entrega.</small></p>
            <Link className="btn" href="/checkout/" style={{ width: "100%" }}>Finalizar compra</Link>
          </div>
        </>
      )}
    </>
  );
}
