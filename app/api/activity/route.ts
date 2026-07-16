import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { activitiesForDate } from "@/lib/day-providers";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!await isAuthenticated()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const date = request.nextUrl.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "A valid date is required." }, { status: 400 });
  const offset = Number.parseInt(request.nextUrl.searchParams.get("utcOffset") || "0", 10);
  const nextOffset = Number.parseInt(request.nextUrl.searchParams.get("nextUtcOffset") || String(offset), 10);
  if (![offset, nextOffset].every((value) => Number.isInteger(value) && value >= -840 && value <= 840)) {
    return NextResponse.json({ error: "A valid timezone offset is required." }, { status: 400 });
  }
  return NextResponse.json(await activitiesForDate(date, { utcOffsetMinutes: offset, nextUtcOffsetMinutes: nextOffset }));
}
