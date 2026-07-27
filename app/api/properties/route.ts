import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { usedPropertyNames } from "@/lib/journal";

export const runtime = "nodejs";

export async function GET() {
  if (!await isAuthenticated()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ properties: usedPropertyNames() });
}
