import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { attachmentMediaType } from "./attachments";
import { normalizeAttachmentPath, resolveAttachmentPath } from "./attachment-paths";

const INLINE_TYPES = new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp", "application/pdf"]);

function dispositionFilename(filename: string) {
  const fallback = filename.replace(/[^a-zA-Z0-9._-]/g, "-") || "attachment";
  return `filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function requestedRange(value: string | null, size: number) {
  const match = value?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  let start = match[1] ? Number(match[1]) : NaN;
  let end = match[2] ? Number(match[2]) : NaN;
  if (Number.isNaN(start) && Number.isNaN(end)) return null;
  if (Number.isNaN(start)) {
    const suffix = Math.min(end, size);
    start = size - suffix;
    end = size - 1;
  } else if (Number.isNaN(end)) end = size - 1;
  if (start < 0 || end < start || start >= size) return { invalid: true as const, start: 0, end: 0 };
  return { invalid: false as const, start, end: Math.min(end, size - 1) };
}

export function attachmentFileResponse(request: NextRequest, attachmentPath: string) {
  const normalized = normalizeAttachmentPath(attachmentPath);
  const filePath = normalized && resolveAttachmentPath(normalized);
  if (!normalized || !filePath || !fs.statSync(filePath).isFile()) return new NextResponse("Not found", { status: 404 });
  const stat = fs.statSync(filePath);
  const etag = `W/"${stat.size}-${Math.trunc(stat.mtimeMs)}"`;
  const mediaType = attachmentMediaType(filePath);
  const download = request.nextUrl.searchParams.get("download") === "1" || !INLINE_TYPES.has(mediaType);
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=0, must-revalidate",
    "Content-Disposition": `${download ? "attachment" : "inline"}; ${dispositionFilename(path.basename(filePath))}`,
    "Content-Length": String(stat.size),
    "Content-Type": mediaType,
    ETag: etag,
    "Last-Modified": stat.mtime.toUTCString(),
    "X-Content-Type-Options": "nosniff",
  });
  if (request.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });
  const range = requestedRange(request.headers.get("range"), stat.size);
  if (range?.invalid) {
    headers.set("Content-Range", `bytes */${stat.size}`);
    return new NextResponse(null, { status: 416, headers });
  }
  if (range) {
    const length = range.end - range.start + 1;
    headers.set("Content-Length", String(length));
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${stat.size}`);
    if (request.method === "HEAD") return new NextResponse(null, { status: 206, headers });
    const body = Readable.toWeb(fs.createReadStream(filePath, { start: range.start, end: range.end })) as ReadableStream;
    return new NextResponse(body, { status: 206, headers });
  }
  if (request.method === "HEAD") return new NextResponse(null, { headers });
  return new NextResponse(Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream, { headers });
}
