import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { settingsTable } from "@/lib/db/schema";
import { issueSessionToken, SESSION_MAX_AGE_SECONDS, verifySessionToken, type SessionKeys } from "@/lib/session-token";

const name = "paralog_session";
const GENERATION_KEY = "sessionGeneration";

export function passwordConfigured() { return Boolean(process.env.PARALOG_PASSWORD); }

function sessionGeneration() {
  const value = db().select({ value: settingsTable.value }).from(settingsTable).where(eq(settingsTable.key, GENERATION_KEY)).get()?.value;
  const generation = Number(value);
  return Number.isSafeInteger(generation) && generation >= 0 ? generation : 0;
}

// Without a password nobody can sign in, so no session is valid either: a
// token signed with a guessable fallback secret must not open the journal.
function sessionKeys(): SessionKeys | null {
  const password = process.env.PARALOG_PASSWORD;
  if (!password) return null;
  return { secret: process.env.PARALOG_AUTH_SECRET || password, password, generation: sessionGeneration() };
}

export async function isAuthenticated() {
  // The cookie is read before anything else, even when no session can be valid:
  // reading it is what tells Next.js the page depends on the request. Without
  // it, a build run without PARALOG_PASSWORD prerenders the "not configured"
  // login page and serves it to every visitor of the deployed app.
  const token = (await cookies()).get(name)?.value;
  const keys = sessionKeys();
  return Boolean(keys) && verifySessionToken(token, keys!);
}

export function passwordMatches(password: string) {
  if (!passwordConfigured()) return false;
  const hashed = (value: string) => crypto.createHash("sha256").update(value).digest();
  return crypto.timingSafeEqual(hashed(password), hashed(process.env.PARALOG_PASSWORD!));
}

export async function signIn(secure: boolean) {
  const keys = sessionKeys();
  if (!keys) throw new Error("Set PARALOG_PASSWORD before signing in.");
  (await cookies()).set(name, issueSessionToken(keys), { httpOnly: true, sameSite: "lax", secure, maxAge: SESSION_MAX_AGE_SECONDS, path: "/" });
}

// Paralog has a single user, so signing out ends the session on every device:
// a cookie copied from this browser stops working too.
export async function signOut() {
  const store = await cookies();
  const keys = sessionKeys();
  // Only a signed-in caller may revoke sessions; anyone else just loses a cookie.
  if (keys && verifySessionToken(store.get(name)?.value, keys)) {
    const generation = String(sessionGeneration() + 1);
    db().insert(settingsTable).values({ key: GENERATION_KEY, value: generation })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value: generation } }).run();
  }
  store.delete(name);
}
