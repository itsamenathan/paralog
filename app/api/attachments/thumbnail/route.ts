import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { attachmentThumbnail } from "@/lib/journal/attachments";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!await isAuthenticated()) return new NextResponse("Unauthorized", { status: 401 });
  const thumbnail = await attachmentThumbnail(request.nextUrl.searchParams.get("path") || "");
  if (!thumbnail) return new NextResponse("Not found", { status: 404 });
  if (request.headers.get("if-none-match") === thumbnail.etag) return new NextResponse(null, { status: 304, headers: { ETag: thumbnail.etag } });
  return new NextResponse(fs.readFileSync(thumbnail.path), { headers: {
    "Cache-Control": "private, max-age=0, must-revalidate", "Content-Type": "image/webp", ETag: thumbnail.etag, "X-Content-Type-Options": "nosniff",
  } });
}
