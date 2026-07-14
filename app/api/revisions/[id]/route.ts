import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { revisionForDate } from "@/lib/journal";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: RouteContext<"/api/revisions/[id]">) {
  if (!await isAuthenticated()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const date = request.nextUrl.searchParams.get("date");
  const { id: rawId } = await context.params;
  const id = Number.parseInt(rawId, 10);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(id) || id < 1) return NextResponse.json({ error: "A valid revision is required." }, { status: 400 });
  const revision = revisionForDate(date, id);
  return revision ? NextResponse.json(revision) : NextResponse.json({ error: "Revision not found." }, { status: 404 });
}
