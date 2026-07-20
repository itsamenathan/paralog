import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { discoverAttachments } from "@/lib/journal/attachments";
import { syncEntryContentIndex } from "@/lib/journal/content-index";

export const runtime = "nodejs";

export async function POST() {
  if (!await isAuthenticated()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const startedAt = performance.now();
  const attachmentResult = discoverAttachments();
  const entryResult = syncEntryContentIndex({ force: true });
  return NextResponse.json({
    entriesIndexed: entryResult.indexed,
    attachmentsDiscovered: attachmentResult.files,
    staleEntriesRemoved: entryResult.removed,
    staleAttachmentsRemoved: attachmentResult.removed,
    durationMs: Math.round(performance.now() - startedAt),
  });
}
