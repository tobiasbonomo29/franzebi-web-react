import type { Metadata } from "next";

export const metadata: Metadata = { title: "Contacto", alternates: { canonical: "/contacto/" } };

export default function Contacto() {
  return (
    <div className="container" style={{ maxWidth: 720 }}>
      <h1>Contacto</h1>
      <ul style={{ lineHeight: 2 }}>
        <li>WhatsApp: <a href="https://wa.me/5491128720954" rel="noopener">+54 9 11 2872-0954</a></li>
        <li>Email: <a href="mailto:franzebi.imports@gmail.com">franzebi.imports@gmail.com</a></li>
        <li>Instagram: <a href="https://www.instagram.com/franzebi.imports/" rel="noopener">@franzebi.imports</a></li>
      </ul>
      <a className="btn btn-wa" href="https://wa.me/5491128720954" rel="noopener">Escribinos por WhatsApp</a>
    </div>
  );
}
