"use client";
import { useEffect, useState } from "react";

const OIDC_ERRORS: Record<string, string> = {
  denied: "Sign-in was cancelled.",
  expired: "That sign-in took too long or started in another browser. Try again.",
  not_owner: "That account is not this journal's owner.",
  unavailable: "Single sign-on is unavailable right now.",
  failed: "Single sign-on failed. Try again.",
};

export default function Login({ password, oidc }: { password: boolean; oidc: string | null }) {
  const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  const [oidcHref, setOidcHref] = useState("/api/auth/oidc/login");
  useEffect(() => {
    const url = new URL(location.href);
    const code = url.searchParams.get("oidc_error");
    url.searchParams.delete("oidc_error");
    const returnTo = `${url.pathname}${url.search}`;
    if (code) {
      setError(OIDC_ERRORS[code] ?? OIDC_ERRORS.failed);
      history.replaceState(history.state, "", `${returnTo}${url.hash}`);
    }
    // Come back to the page and date that asked for sign-in.
    setOidcHref(`/api/auth/oidc/login?returnTo=${encodeURIComponent(returnTo)}`);
  }, []);
  // The password is read from the field rather than from state: anything typed
  // before the page hydrated is in the field but never reached an onChange.
  async function submit(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); const password = new FormData(event.currentTarget).get("password"); setLoading(true); setError(""); const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) }); setLoading(false); if (response.ok) location.reload(); else setError((await response.json()).error || "Could not sign in."); }
  const configured = password || oidc;
  return <main className="login-page"><form method="post" onSubmit={submit}><p className="eyebrow">PRIVATE JOURNAL</p><h1>Paralog</h1>
    {oidc && <a className="save-button login-oidc" href={oidcHref}>Sign in with {oidc}</a>}
    {oidc && password && <p className="login-divider"><span>or</span></p>}
    {password && <><label>Password<input autoFocus={!oidc} type="password" name="password" /></label><button className={oidc ? "save-button login-secondary" : "save-button"} disabled={loading}>{loading ? "Signing in…" : "Sign in"}</button></>}
    {error && <p className="error" role="alert">{error}</p>}
    {!configured && <p className="setup-message">Set <code>PARALOG_PASSWORD</code>, or the Pocket ID settings described in the README, then restart Paralog to enable the first login.</p>}
  </form></main>;
}
