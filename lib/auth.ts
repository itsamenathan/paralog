import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { settingsTable } from "@/lib/db/schema";
import { log } from "@/lib/log";
import { oidcFingerprint, oidcSetupFromEnv } from "@/lib/oidc";
import { clearGrant, grantStillValid } from "@/lib/oidc-grant";
import { issueSessionToken, SESSION_MAX_AGE_SECONDS, verifySessionToken, type SessionKeys } from "@/lib/session-token";

const name = "paralog_session";
const GENERATION_KEY = "sessionGeneration";

export function passwordConfigured() { return Boolean(process.env.PARALOG_PASSWORD); }

let reportedMissing = "";

// Pocket ID sign-in also needs a secret of its own to sign sessions and sign-in
// state: the password may be unset, and is not meant to double as a signing key.
export function oidcConfig() {
  const { config, missing } = oidcSetupFromEnv();
  if (config && !process.env.PARALOG_AUTH_SECRET) missing.push("PARALOG_AUTH_SECRET");
  const report = missing.join(", ");
  if (report && report !== reportedMissing) log.warn("Pocket ID sign-in is off until these settings are set", undefined, { missing: report });
  reportedMissing = report;
  return missing.length ? null : config;
}

function authSecret() { return process.env.PARALOG_AUTH_SECRET || process.env.PARALOG_PASSWORD || ""; }

export function loginOptions() {
  return { password: passwordConfigured(), oidc: oidcConfig()?.name ?? null };
}

function sessionGeneration() {
  const value = db().select({ value: settingsTable.value }).from(settingsTable).where(eq(settingsTable.key, GENERATION_KEY)).get()?.value;
  const generation = Number(value);
  return Number.isSafeInteger(generation) && generation >= 0 ? generation : 0;
}

// Without a way to sign in, no session is valid either: a token signed with a
// guessable fallback secret must not open the journal.
function sessionKeys(): SessionKeys | null {
  const password = process.env.PARALOG_PASSWORD || "";
  const oidc = oidcConfig();
  if (!password && !oidc) return null;
  // Password-only setups keep the binding they had before OIDC existed, so upgrading signs no one out.
  return { secret: authSecret(), credentials: oidc ? JSON.stringify([password, oidcFingerprint(oidc)]) : password, generation: sessionGeneration() };
}

export function sessionSecret() {
  const secret = authSecret();
  if (!secret) throw new Error("Set PARALOG_AUTH_SECRET before signing in.");
  return secret;
}

export async function isAuthenticated() {
  // The cookie is read before anything else, even when no session can be valid:
  // reading it is what tells Next.js the page depends on the request. Without
  // it, a build run without PARALOG_PASSWORD prerenders the "not configured"
  // login page and serves it to every visitor of the deployed app.
  const token = (await cookies()).get(name)?.value;
  const keys = sessionKeys();
  if (!keys || !verifySessionToken(token, keys)) return false;
  const oidc = oidcConfig();
  if (oidc && !await grantStillValid(oidc)) {
    revokeAllSessions();
    return false;
  }
  return true;
}

// Every session issued before this stops working, on every device.
function revokeAllSessions() {
  const generation = String(sessionGeneration() + 1);
  db().insert(settingsTable).values({ key: GENERATION_KEY, value: generation })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: generation } }).run();
}

export function passwordMatches(password: string) {
  if (!passwordConfigured()) return false;
  const hashed = (value: string) => crypto.createHash("sha256").update(value).digest();
  return crypto.timingSafeEqual(hashed(password), hashed(process.env.PARALOG_PASSWORD!));
}

export async function signIn(secure: boolean) {
  const keys = sessionKeys();
  if (!keys) throw new Error("Set PARALOG_PASSWORD or configure OIDC before signing in.");
  (await cookies()).set(name, issueSessionToken(keys), { httpOnly: true, sameSite: "lax", secure, maxAge: SESSION_MAX_AGE_SECONDS, path: "/" });
}

// Paralog has a single user, so signing out ends the session on every device:
// a cookie copied from this browser stops working too.
export async function signOut() {
  const store = await cookies();
  const keys = sessionKeys();
  // Only a signed-in caller may revoke sessions; anyone else just loses a cookie.
  if (keys && verifySessionToken(store.get(name)?.value, keys)) {
    revokeAllSessions();
    clearGrant();
  }
  store.delete(name);
}
