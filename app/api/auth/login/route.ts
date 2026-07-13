import { NextRequest, NextResponse } from "next/server";
import { passwordConfigured, passwordMatches, signIn } from "@/lib/auth";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  if (!passwordConfigured()) return NextResponse.json({ error: "Set PARALOG_PASSWORD before using Paralog." }, { status: 503 });
  const { password } = await request.json();
  if (typeof password !== "string" || !passwordMatches(password)) return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  const secure = forwardedProtocol ? forwardedProtocol === "https" : request.nextUrl.protocol === "https:";
  await signIn(secure);
  return NextResponse.json({ ok: true });
}
