"use client";
import { useState } from "react";
export default function Login({ configured }: { configured: boolean }) {
  const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  // The password is read from the field rather than from state: anything typed
  // before the page hydrated is in the field but never reached an onChange.
  async function submit(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); const password = new FormData(event.currentTarget).get("password"); setLoading(true); setError(""); const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) }); setLoading(false); if (response.ok) location.reload(); else setError((await response.json()).error || "Could not sign in."); }
  return <main className="login-page"><form method="post" onSubmit={submit}><p className="eyebrow">PRIVATE JOURNAL</p><h1>Paralog</h1>{configured ? <><label>Password<input autoFocus type="password" name="password" /></label>{error && <p className="error">{error}</p>}<button className="save-button" disabled={loading}>{loading ? "Signing in…" : "Sign in"}</button></> : <p className="setup-message">Set <code>PARALOG_PASSWORD</code> in the environment, then restart Paralog to enable the first login.</p>}</form></main>;
}
