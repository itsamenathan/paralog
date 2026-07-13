import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { settings, updateSettings } from "@/lib/journal";
export const runtime = "nodejs";
export async function GET() { if (!await isAuthenticated()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); return NextResponse.json(settings()); }
export async function PUT(request: NextRequest) {
  if (!await isAuthenticated()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json(updateSettings(await request.json())); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid settings" }, { status: 400 }); }
}
