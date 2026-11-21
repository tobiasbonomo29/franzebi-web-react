"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/** Monta un componente React dentro de un nodo del markup heredado (p. ej. #fz-checkout-root). */
export function LegacyPortal({ target, children }: { target: string; children: React.ReactNode }) {
  const [el, setEl] = useState<Element | null>(null);
  useEffect(() => {
    const node = document.getElementById(target);
    if (node) node.innerHTML = ""; // reemplaza el contenido de respaldo renderizado en el servidor
    setEl(node);
  }, [target]);
  return el ? createPortal(children, el) : null;
}
