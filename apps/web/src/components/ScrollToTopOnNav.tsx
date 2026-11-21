"use client";
import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/** Al paginar o cambiar de categoría, lleva la vista al inicio (reemplaza snippet #39). */
export function ScrollToTopOnNav() {
  const pathname = usePathname();
  const params = useSearchParams();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [pathname, params]);
  return null;
}
