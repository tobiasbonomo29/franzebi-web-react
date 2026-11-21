"use client";
import { createBrowserClient } from "@supabase/ssr";
import { useMemo, useState } from "react";

/** Formulario de nueva contraseña con el markup de Woo (form-reset-password.php). */
export function ResetForm({ supabaseUrl, anonKey }: { supabaseUrl: string; anonKey: string }) {
  const sb = useMemo(() => createBrowserClient(supabaseUrl, anonKey), [supabaseUrl, anonKey]);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const p1 = String(f.get("password_1"));
    if (p1.length < 10) return setMsg({ kind: "err", text: "La contraseña debe tener al menos 10 caracteres." });
    if (p1 !== String(f.get("password_2"))) return setMsg({ kind: "err", text: "Las contraseñas no coinciden." });
    const { error } = await sb.auth.updateUser({ password: p1 });
    if (error) return setMsg({ kind: "err", text: "El enlace expiró o no es válido. Pedí uno nuevo desde “¿Olvidaste la contraseña?”." });
    setMsg({ kind: "ok", text: "Tu contraseña ha sido restablecida correctamente." });
    setTimeout(() => (location.href = "/mi-cuenta/"), 1200);
  }
  return (
    <form method="post" className="woocommerce-ResetPassword fz-reset" onSubmit={onSubmit}>
      {msg && <div className={msg.kind === "ok" ? "woocommerce-message" : "woocommerce-error"} role="alert">{msg.text}</div>}
      <p>Introduce una nueva contraseña a continuación.</p>
      <p className="woocommerce-form-row woocommerce-form-row--first form-row form-row-first">
        <label htmlFor="password_1">Nueva contraseña&nbsp;<span className="required" aria-hidden="true">*</span></label>
        <input type="password" className="woocommerce-Input woocommerce-Input--text input-text" name="password_1" id="password_1" autoComplete="new-password" required minLength={10} />
      </p>
      <p className="woocommerce-form-row woocommerce-form-row--last form-row form-row-last">
        <label htmlFor="password_2">Repite la nueva contraseña&nbsp;<span className="required" aria-hidden="true">*</span></label>
        <input type="password" className="woocommerce-Input woocommerce-Input--text input-text" name="password_2" id="password_2" autoComplete="new-password" required minLength={10} />
      </p>
      <div className="clear" />
      <p className="woocommerce-form-row form-row">
        <button type="submit" className="woocommerce-Button button" value="Guardar">Guardar</button>
      </p>
    </form>
  );
}
