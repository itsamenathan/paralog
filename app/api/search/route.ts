import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { searchEntries } from "@/lib/journal";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!await isAuthenticated()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const query = request.nextUrl.searchParams.get("q")?.trim() || "";
  if (!query) return NextResponse.json({ results: [] });
  if (query.length > 120) return NextResponse.json({ error: "Search queries can be up to 120 characters." }, { status: 400 });
  return NextResponse.json({ results: searchEntries(query) });
}
