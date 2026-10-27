import { NextRequest, NextResponse } from "next/server";
import { passwordConfigured, passwordMatches, signIn } from "@/lib/auth";
import { clearLoginFailures, loginClient, loginRetryAfter, recordLoginFailure, type LoginThrottle } from "@/lib/login-throttle";
export const runtime = "nodejs";

const globalThrottle = globalThis as typeof globalThis & { paralogLoginThrottle?: LoginThrottle };
const throttle = globalThrottle.paralogLoginThrottle ??= new Map();

export async function POST(request: NextRequest) {
  if (!passwordConfigured()) return NextResponse.json({ error: "Set PARALOG_PASSWORD before using Paralog." }, { status: 503 });
  const client = loginClient(request.headers);
  const retryAfter = loginRetryAfter(throttle, client);
  if (retryAfter > 0) {
    const seconds = Math.ceil(retryAfter / 1000);
    return NextResponse.json({ error: `Too many attempts. Try again in ${Math.ceil(seconds / 60)} minute${seconds > 60 ? "s" : ""}.` }, { status: 429, headers: { "Retry-After": String(seconds) } });
  }
  let password: unknown;
  try { ({ password } = await request.json()); } catch { /* Treated as a wrong password below. */ }
  if (typeof password !== "string" || !passwordMatches(password)) {
    recordLoginFailure(throttle, client);
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }
  clearLoginFailures(throttle, client);
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  const secure = forwardedProtocol ? forwardedProtocol === "https" : request.nextUrl.protocol === "https:";
  await signIn(secure);
  return NextResponse.json({ ok: true });
}
