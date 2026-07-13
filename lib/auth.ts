import crypto from "node:crypto";
import { cookies } from "next/headers";

const name = "paralog_session";
const secret = process.env.PARALOG_AUTH_SECRET || process.env.PARALOG_PASSWORD || "change-me-before-production";
export function passwordConfigured() { return Boolean(process.env.PARALOG_PASSWORD); }
function token() { return crypto.createHmac("sha256", secret).update("paralog-single-user").digest("base64url"); }
export async function isAuthenticated() { return (await cookies()).get(name)?.value === token(); }
export function passwordMatches(password: string) {
  if (!passwordConfigured()) return false;
  const hashed = (value: string) => crypto.createHash("sha256").update(value).digest();
  return crypto.timingSafeEqual(hashed(password), hashed(process.env.PARALOG_PASSWORD!));
}
export async function signIn(secure: boolean) { (await cookies()).set(name, token(), { httpOnly: true, sameSite: "lax", secure, maxAge: 60 * 60 * 24 * 30, path: "/" }); }
export async function signOut() { (await cookies()).delete(name); }
