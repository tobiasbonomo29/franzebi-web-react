"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export function MobileMenuToggle() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    document.getElementById("main-nav")?.classList.toggle("open", open);
  }, [open]);
  return (
    <button className="menu-toggle" aria-controls="main-nav" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
      <span aria-hidden="true">{open ? "✕" : "☰"}</span>
      <span className="sr-only">Menú</span>
    </button>
  );
}
