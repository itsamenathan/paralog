import { NextRequest, NextResponse } from "next/server";
import { entriesForMonth } from "@/lib/journal";
import { isAuthenticated } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!await isAuthenticated()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const month = request.nextUrl.searchParams.get("month");
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: "A valid month is required." }, { status: 400 });
  return NextResponse.json({ dates: entriesForMonth(month) });
}
