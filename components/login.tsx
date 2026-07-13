"use client";
import { useState } from "react";
export default function Login({ configured }: { configured: boolean }) {
  const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  async function submit(event: React.FormEvent) { event.preventDefault(); setLoading(true); setError(""); const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) }); setLoading(false); if (response.ok) location.reload(); else setError((await response.json()).error || "Could not sign in."); }
  return <main className="login-page"><form onSubmit={submit}><p className="eyebrow">PRIVATE JOURNAL</p><h1>Paralog</h1>{configured ? <><label>Password<input autoFocus type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>{error && <p className="error">{error}</p>}<button className="save-button" disabled={loading}>{loading ? "Signing in…" : "Sign in"}</button></> : <p className="setup-message">Set <code>PARALOG_PASSWORD</code> in the environment, then restart Paralog to enable the first login.</p>}</form></main>;
}
