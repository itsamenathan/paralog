import { NextRequest, NextResponse } from "next/server";
import { getEntry, saveEntry } from "@/lib/journal";
import { isAuthenticated } from "@/lib/auth";

export const runtime = "nodejs";

function requestedDate(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("date");
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

export async function GET(request: NextRequest) {
  if (!await isAuthenticated()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const date = requestedDate(request);
  if (!date) return NextResponse.json({ error: "A valid date is required." }, { status: 400 });
  return NextResponse.json(getEntry(date));
}

export async function PUT(request: NextRequest) {
  if (!await isAuthenticated()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const date = requestedDate(request);
  if (!date) return NextResponse.json({ error: "A valid date is required." }, { status: 400 });
  const body = await request.json();
  if (typeof body.content !== "string") return NextResponse.json({ error: "Content must be text." }, { status: 400 });
  return NextResponse.json(saveEntry(date, body.content));
}
