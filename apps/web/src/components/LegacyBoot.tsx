"use client";
import { useEffect } from "react";

type Item = { src: string } | { code: string };

/**
 * Respaldo para cuando Next renderiza la página del lado del cliente (p.ej. el 404 que lanza una ficha
 * inexistente): ahí los <script> del SSR no se ejecutan. Si Elementor no arrancó, aplica la clase del <body>
 * y carga los scripts heredados en el mismo orden.
 */
export function LegacyBoot({ bodyClass, items }: { bodyClass: string; items: Item[] }) {
  useEffect(() => {
    const w = window as unknown as { elementorFrontend?: unknown; __fzBooting?: boolean; __fzSSR?: number };
    if (w.__fzSSR) return; // los scripts del SSR ya corrieron (o están corriendo) en orden
    if (!document.body.classList.contains("fz-app")) document.body.className = bodyClass;
    if (w.elementorFrontend || w.__fzBooting) return;
    w.__fzBooting = true;
    let chain = Promise.resolve();
    for (const it of items) {
      chain = chain.then(
        () =>
          new Promise<void>((resolve) => {
            const s = document.createElement("script");
            if ("src" in it) {
              s.src = it.src;
              s.async = false;
              s.onload = s.onerror = () => resolve();
              document.body.appendChild(s);
            } else {
              s.text = it.code;
              document.body.appendChild(s);
              resolve();
            }
          }),
      );
    }
    void chain.then(() => document.dispatchEvent(new Event("DOMContentLoaded")));
  }, [bodyClass, items]);
  return null;
}
