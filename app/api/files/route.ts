import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { uploadPath } from "@/lib/journal";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  if (!await isAuthenticated()) return new NextResponse("Unauthorized", { status: 401 });
  const filePath = uploadPath(request.nextUrl.searchParams.get("path") || "");
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return new NextResponse("Not found", { status: 404 });
  const extension = filePath.split(".").pop()?.toLowerCase();
  const types: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", pdf: "application/pdf", txt: "text/plain" };
  return new NextResponse(fs.readFileSync(filePath), { headers: { "Content-Type": types[extension || ""] || "application/octet-stream", "Content-Disposition": `inline; filename="${JSON.stringify(filePath.split("/").pop() || "attachment").slice(1, -1)}"` } });
}
