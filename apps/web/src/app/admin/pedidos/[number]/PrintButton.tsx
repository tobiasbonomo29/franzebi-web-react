"use client";
/** Imprime el pedido (remito de preparación): el CSS de impresión oculta los controles del admin. */
export function PrintButton() {
  return <button type="button" className="btn btn-outline" onClick={() => window.print()}>Imprimir remito</button>;
}
