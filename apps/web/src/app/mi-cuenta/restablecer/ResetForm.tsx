"use client";
import { createBrowserClient } from "@supabase/ssr";
import { useMemo, useState } from "react";

export function ResetForm({ supabaseUrl, anonKey }: { supabaseUrl: string; anonKey: string }) {
  const sb = useMemo(() => createBrowserClient(supabaseUrl, anonKey), [supabaseUrl, anonKey]);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const p1 = String(f.get("p1"));
    if (p1 !== String(f.get("p2"))) return setMsg({ kind: "err", text: "Las contraseñas no coinciden." });
    const { error } = await sb.auth.updateUser({ password: p1 });
    setMsg(error ? { kind: "err", text: "El enlace expiró o no es válido. Pedí uno nuevo desde Mi cuenta." } : { kind: "ok", text: "¡Listo! Tu contraseña fue actualizada." });
  }
  return (
    <form onSubmit={onSubmit}>
      <div className="field"><label htmlFor="p1">Nueva contraseña</label><input id="p1" name="p1" type="password" minLength={10} required autoComplete="new-password" /></div>
      <div className="field"><label htmlFor="p2">Repetir contraseña</label><input id="p2" name="p2" type="password" minLength={10} required autoComplete="new-password" /></div>
      {msg && <p className={`notice ${msg.kind}`} role="status">{msg.text}</p>}
      <button className="btn" style={{ width: "100%" }}>Guardar</button>
    </form>
  );
}
