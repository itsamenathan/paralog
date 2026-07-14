import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { notificationBootstrap, registerPushSubscription, removePushSubscription } from "@/lib/notifications";

export const runtime = "nodejs";

export async function GET() {
  if (!await isAuthenticated()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(notificationBootstrap());
}

export async function POST(request: NextRequest) {
  if (!await isAuthenticated()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    return NextResponse.json(registerPushSubscription(body.subscription));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid subscription" }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!await isAuthenticated()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    return NextResponse.json(removePushSubscription(body.endpoint));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid subscription" }, { status: 400 });
  }
}
