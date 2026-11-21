"use client";
import { createBrowserClient } from "@supabase/ssr";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

/** Login / registro / reseteo vía Supabase Auth. Las contraseñas de WordPress NO se migran. */
export function AuthForms({ supabaseUrl, anonKey, siteUrl }: { supabaseUrl: string; anonKey: string; siteUrl: string }) {
  const sb = useMemo(() => createBrowserClient(supabaseUrl, anonKey), [supabaseUrl, anonKey]);
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup" | "reset">("login");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email")).trim();
    const password = String(f.get("password") ?? "");
    setBusy(true);
    setMsg(null);
    try {
      if (mode === "login") {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.refresh();
      } else if (mode === "signup") {
        const { error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: `${siteUrl}/mi-cuenta/`, data: { full_name: String(f.get("name") ?? "") } } });
        if (error) throw error;
        setMsg({ kind: "ok", text: "Te enviamos un email para confirmar tu cuenta." });
      } else {
        await sb.auth.resetPasswordForEmail(email, { redirectTo: `${siteUrl}/mi-cuenta/restablecer/` });
        // Mismo mensaje exista o no la cuenta (no revela emails registrados)
        setMsg({ kind: "ok", text: "Si el email está registrado, vas a recibir un enlace para crear tu nueva contraseña." });
      }
    } catch {
      setMsg({ kind: "err", text: mode === "login" ? "Email o contraseña incorrectos." : "No pudimos completar la operación. Reintentá." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div role="tablist" style={{ display: "flex", gap: ".5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        {(["login", "signup", "reset"] as const).map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} className={`btn ${mode === m ? "" : "btn-outline"}`} onClick={() => setMode(m)} type="button">
            {m === "login" ? "Ingresar" : m === "signup" ? "Crear cuenta" : "Olvidé mi contraseña"}
          </button>
        ))}
      </div>
      <form onSubmit={onSubmit}>
        {mode === "signup" && <div className="field"><label htmlFor="name">Nombre</label><input id="name" name="name" autoComplete="name" /></div>}
        <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" required autoComplete="email" /></div>
        {mode !== "reset" && <div className="field"><label htmlFor="password">Contraseña</label><input id="password" name="password" type="password" required minLength={10} autoComplete={mode === "login" ? "current-password" : "new-password"} /></div>}
        {msg && <p className={`notice ${msg.kind}`} role="status">{msg.text}</p>}
        <button className="btn" disabled={busy} style={{ width: "100%" }}>{busy ? "Procesando…" : "Continuar"}</button>
      </form>
      <div className="notice" style={{ marginTop: "1.5rem" }}>
        <strong>¿Sos cliente mayorista?</strong> Al completar tu primera compra mayorista (10 puntos) tu cuenta pasa a mayorista automáticamente.
        También podés escribirnos por <a href="https://wa.me/5491128720954?text=Hola%2C%20quiero%20consultar%20por%20los%20beneficios%20mayoristas">WhatsApp</a>.
      </div>
    </>
  );
}
