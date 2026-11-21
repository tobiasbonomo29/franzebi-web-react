import type { Metadata } from "next";
import { CartView } from "./CartView";

export const metadata: Metadata = { title: "Carrito", robots: { index: false, follow: true } };

export default function CartPage() {
  return (
    <div className="container">
      <h1>Carrito</h1>
      <CartView />
    </div>
  );
}
