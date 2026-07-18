import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { randomMemory } from "@/lib/journal";
import type { RandomMemoryScope } from "@/lib/journal-insight-types";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!await isAuthenticated()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const date = request.nextUrl.searchParams.get("date");
  const scope = request.nextUrl.searchParams.get("scope");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "A valid date is required." }, { status: 400 });
  if (!scope || !(["all", "month", "season"] as string[]).includes(scope)) return NextResponse.json({ error: "A valid scope is required." }, { status: 400 });
  return NextResponse.json({ memory: randomMemory(date, scope as RandomMemoryScope) });
}
