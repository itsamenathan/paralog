import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { AttachmentDeleteError, deleteAttachment, listAttachments, type AttachmentQuery } from "@/lib/journal/attachments";

export const runtime = "nodejs";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = new Set(["all", "image", "document"]);
const STATUSES = new Set(["all", "linked", "unlinked", "missing"]);
const SORTS = new Set(["added-desc", "added-asc", "name-asc", "size-desc"]);

export async function GET(request: NextRequest) {
  if (!await isAuthenticated()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const params = request.nextUrl.searchParams;
  const q = params.get("q")?.trim() || "";
  const kind = params.get("kind") || "all";
  const status = params.get("status") || "all";
  const sort = params.get("sort") || "added-desc";
  const entry = params.get("entry") || undefined;
  const from = params.get("from") || undefined;
  const to = params.get("to") || undefined;
  if (q.length > 120) return NextResponse.json({ error: "Search queries can be up to 120 characters." }, { status: 400 });
  if (!KINDS.has(kind) || !STATUSES.has(status) || !SORTS.has(sort)) return NextResponse.json({ error: "Invalid attachment filter." }, { status: 400 });
  if ([entry, from, to].some((value) => value && !DATE.test(value))) return NextResponse.json({ error: "Dates must use YYYY-MM-DD." }, { status: 400 });
  const rawLimit = Number(params.get("limit") || 48);
  const query: AttachmentQuery = {
    q, kind: kind as AttachmentQuery["kind"], status: status as AttachmentQuery["status"], sort: sort as AttachmentQuery["sort"],
    entry, from, to, cursor: params.get("cursor") || undefined, limit: Number.isFinite(rawLimit) ? rawLimit : 48,
  };
  return NextResponse.json(listAttachments(query));
}

export async function DELETE(request: NextRequest) {
  if (!await isAuthenticated()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { path?: unknown; acknowledgeRevisionReferences?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }
  if (typeof body.path !== "string" || (body.acknowledgeRevisionReferences !== undefined && typeof body.acknowledgeRevisionReferences !== "boolean")) {
    return NextResponse.json({ error: "A valid attachment path is required." }, { status: 400 });
  }
  try {
    return NextResponse.json(deleteAttachment(body.path, body.acknowledgeRevisionReferences === true));
  } catch (error) {
    if (!(error instanceof AttachmentDeleteError)) throw error;
    if (error.code === "invalid") return NextResponse.json({ error: "Invalid attachment path.", code: error.code }, { status: 400 });
    if (error.code === "not_found") return NextResponse.json({ error: "Attachment not found.", code: error.code }, { status: 404 });
    if (error.code === "referenced") return NextResponse.json({ error: "Remove this attachment from its journal entries before deleting it.", code: error.code, ...error.details }, { status: 409 });
    return NextResponse.json({ error: "Older revisions still reference this attachment.", code: error.code, ...error.details }, { status: 409 });
  }
}
