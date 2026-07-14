import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { revisionsForDate } from "@/lib/journal";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!await isAuthenticated()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const date = request.nextUrl.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "A valid date is required." }, { status: 400 });
  return NextResponse.json({ revisions: revisionsForDate(date) });
}
