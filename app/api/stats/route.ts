import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { writingStats } from "@/lib/journal";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!await isAuthenticated()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const month = request.nextUrl.searchParams.get("month");
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: "A valid month is required." }, { status: 400 });
  const today = request.nextUrl.searchParams.get("today");
  if (today && !/^\d{4}-\d{2}-\d{2}$/.test(today)) return NextResponse.json({ error: "A valid local date is required." }, { status: 400 });
  return NextResponse.json(writingStats(month, today || undefined));
}
