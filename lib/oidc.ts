import crypto from "node:crypto";

// Pocket ID (OpenID Connect) sign-in settings and the sign-in state kept between
// leaving for the provider and coming back. Talking to the provider lives in
// lib/oidc-provider.ts; this file has no I/O so it can be unit tested directly.

export type OidcConfig = {
  issuer: string;
  clientId: string;
  clientSecret?: string;
  // The journal's owner: the provider's user ID (`sub`), which its owner cannot change.
  subject: string;
  // Where browsers reach Paralog; the callback URL is built from it.
  publicOrigin: string;
  // Shown on the sign-in button.
  name: string;
};

// The short-lived state kept in a cookie between leaving for the provider and coming back.
export type OidcPending = { state: string; nonce: string; verifier: string; returnTo: string; expires: number };

export const OIDC_PENDING_COOKIE = "paralog_oidc";
export const OIDC_COOKIE_PATH = "/api/auth/oidc";
export const OIDC_CALLBACK_PATH = "/api/auth/oidc/callback";
export const OIDC_PENDING_MAX_AGE_SECONDS = 10 * 60;

const REQUIRED = ["PARALOG_OIDC_ISSUER", "PARALOG_OIDC_CLIENT_ID", "PARALOG_OIDC_SUBJECT", "PARALOG_PUBLIC_URL"] as const;

// `missing` lists the settings still needed once any of them is set, so a
// half-finished setup is reported rather than silently ignored.
export function oidcSetupFromEnv(env: NodeJS.ProcessEnv = process.env): { config: OidcConfig | null; missing: string[] } {
  const value = (key: string) => env[key]?.trim() || "";
  // PARALOG_PUBLIC_URL alone does not mean Pocket ID sign-in was wanted.
  if (!REQUIRED.some((key) => key.startsWith("PARALOG_OIDC_") && value(key))) return { config: null, missing: [] };
  const missing: string[] = REQUIRED.filter((key) => !value(key));
  let publicOrigin = "";
  try {
    const url = new URL(value("PARALOG_PUBLIC_URL"));
    if (url.protocol === "https:" || url.protocol === "http:") publicOrigin = url.origin;
  } catch { /* Reported below. */ }
  if (value("PARALOG_PUBLIC_URL") && !publicOrigin) missing.push("PARALOG_PUBLIC_URL (an http(s) URL)");
  if (missing.length) return { config: null, missing };
  return {
    config: {
      issuer: value("PARALOG_OIDC_ISSUER").replace(/\/+$/, ""),
      clientId: value("PARALOG_OIDC_CLIENT_ID"),
      clientSecret: value("PARALOG_OIDC_CLIENT_SECRET") || undefined,
      subject: value("PARALOG_OIDC_SUBJECT"),
      publicOrigin,
      name: value("PARALOG_OIDC_NAME") || "Pocket ID",
    },
    missing: [],
  };
}

// Identifies the settings that decide who may sign in, so changing them ends existing sessions.
export function oidcFingerprint(config: OidcConfig) {
  return JSON.stringify([config.issuer, config.clientId, config.subject]);
}

export function redirectUri(config: OidcConfig) {
  return `${config.publicOrigin}${OIDC_CALLBACK_PATH}`;
}

export function secureCookies(config: OidcConfig) {
  return config.publicOrigin.startsWith("https:");
}

const randomToken = () => crypto.randomBytes(32).toString("base64url");

export function newPending(returnTo: string | null, now = Date.now()): OidcPending {
  return { state: randomToken(), nonce: randomToken(), verifier: randomToken(), returnTo: safeReturnTo(returnTo), expires: Math.floor(now / 1000) + OIDC_PENDING_MAX_AGE_SECONDS };
}

// Only same-origin paths, so the sign-in flow cannot be used as an open redirect.
export function safeReturnTo(value: string | null | undefined) {
  return value && /^\/(?![/\\])[^\s]*$/.test(value) ? value : "/";
}

function mac(secret: string, payload: string) {
  return crypto.createHmac("sha256", secret).update(`paralog-oidc.v1.${payload}`).digest("base64url");
}

export function sealPending(pending: OidcPending, secret: string) {
  const payload = Buffer.from(JSON.stringify(pending)).toString("base64url");
  return `${payload}.${mac(secret, payload)}`;
}

export function openPending(value: string | undefined, secret: string, now = Date.now()): OidcPending | null {
  const [payload, signature, extra] = value?.split(".") ?? [];
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(mac(secret, payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  try {
    const pending = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OidcPending;
    if (typeof pending.state !== "string" || typeof pending.nonce !== "string" || typeof pending.verifier !== "string") return null;
    if (typeof pending.expires !== "number" || pending.expires < Math.floor(now / 1000)) return null;
    return { ...pending, returnTo: safeReturnTo(pending.returnTo) };
  } catch {
    return null;
  }
}
