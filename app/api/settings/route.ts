import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { settings, updateSettings } from "@/lib/journal";
import { notificationSettings, updateNotificationSettings } from "@/lib/notifications";
export const runtime = "nodejs";
export async function GET() { if (!await isAuthenticated()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); return NextResponse.json({ ...settings(), ...notificationSettings() }); }
export async function PUT(request: NextRequest) {
  if (!await isAuthenticated()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const values = await request.json();
    return NextResponse.json({ ...updateSettings(values), ...updateNotificationSettings(values) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid settings" }, { status: 400 }); }
}
