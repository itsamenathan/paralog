import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { sendTestNotification } from "@/lib/notifications";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!await isAuthenticated()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    return NextResponse.json(await sendTestNotification(body.endpoint, body.title, body.body));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to send test notification" }, { status: 400 });
  }
}
