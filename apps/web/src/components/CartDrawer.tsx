"use client";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { formatArs, type CartTotals } from "@franzebi/domain";

interface CartCtx {
  totals: CartTotals | null;
  open: boolean;
  setOpen(o: boolean): void;
  setQty(sku: string, qty: number): Promise<CartTotals | null>;
  refresh(): Promise<void>;
  error: string | null;
}
const Ctx = createContext<CartCtx | null>(null);
export const useCart = () => useContext(Ctx)!;

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [totals, setTotals] = useState<CartTotals | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const r = await fetch("/api/cart/", { cache: "no-store" });
    if (r.ok) setTotals((await r.json()).totals);
  }, []);
  const setQty = useCallback(async (sku: string, quantity: number) => {
    setError(null);
    const r = await fetch("/api/cart/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sku, quantity }) });
    const j = await r.json();
    if (!r.ok) { setError(j.error ?? "No pudimos actualizar el carrito"); return null; }
    setTotals(j.totals);
    return j.totals as CartTotals;
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return <Ctx.Provider value={{ totals, open, setOpen, setQty, refresh, error }}>{children}<CartDrawer /></Ctx.Provider>;
}

export function CartButton() {
  const { totals, setOpen } = useCart();
  const n = totals?.lines.reduce((s, l) => s + l.quantity, 0) ?? 0;
  return (
    <button className="cart-toggle" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={`Abrir carrito (${n} productos)`}>
      🛍️<span aria-hidden="true"> {n}</span>
    </button>
  );
}

export function AddToCartButton({ sku, disabled }: { sku: string; disabled?: boolean }) {
  const { totals, setQty, setOpen } = useCart();
  const [busy, setBusy] = useState(false);
  const current = totals?.lines.find((l) => l.sku === sku)?.quantity ?? 0;
  return (
    <button className="btn" disabled={disabled || busy} onClick={async () => { setBusy(true); const t = await setQty(sku, current + 1); setBusy(false); if (t) setOpen(true); }}>
      {busy ? "Agregando…" : "Añadir al carrito"}
    </button>
  );
}

function CartDrawer() {
  const { totals, open, setOpen, setQty, error } = useCart();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);
  return (
    <>
      {open && <div className="drawer-backdrop" onClick={() => setOpen(false)} />}
      <div ref={ref} tabIndex={-1} className={`drawer${open ? " open" : ""}`} role="dialog" aria-modal="true" aria-label="Carrito" aria-hidden={!open}>
        <header><strong>Tu carrito</strong><button className="menu-toggle" style={{ display: "inline-block" }} onClick={() => setOpen(false)} aria-label="Cerrar carrito">✕</button></header>
        <div className="items">
          {error && <p className="notice err" role="alert">{error}</p>}
          {totals?.issues.map((i) => <p key={i.sku + i.type} className="notice warn" role="status">{i.message}</p>)}
          {!totals?.lines.length && <p>Tu carrito está vacío.</p>}
          {totals?.lines.map((l) => (
            <div key={l.sku} style={{ display: "flex", justifyContent: "space-between", gap: ".5rem", marginBottom: ".75rem" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ overflowWrap: "anywhere" }}>{l.name}</div>
                <small>{formatArs(l.unitPriceCents)} {l.wholesaleApplied && <span className="badge">Mayorista</span>}</small>
              </div>
              <div className="qty">
                <button onClick={() => setQty(l.sku, l.quantity - 1)} aria-label={`Quitar uno de ${l.name}`}>−</button>
                <span style={{ minWidth: "2rem", textAlign: "center" }}>{l.quantity}</span>
                <button onClick={() => setQty(l.sku, l.quantity + 1)} aria-label={`Agregar uno de ${l.name}`}>+</button>
              </div>
            </div>
          ))}
          {totals && totals.lines.length > 0 && <p className="notice">{totals.wholesale.reason}</p>}
        </div>
        <footer>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Subtotal</span><strong>{formatArs(totals?.subtotalCents ?? 0)}</strong></div>
          <Link className="btn btn-outline" href="/carrito/" onClick={() => setOpen(false)}>Ver carrito</Link>
          <Link className="btn" href="/checkout/" onClick={() => setOpen(false)} aria-disabled={!totals?.lines.length}>Finalizar compra</Link>
        </footer>
      </div>
    </>
  );
}
