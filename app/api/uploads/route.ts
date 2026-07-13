import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { saveUpload } from "@/lib/journal";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  if (!await isAuthenticated()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const file = (await request.formData()).get("file");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
  if (file.size > 25 * 1024 * 1024) return NextResponse.json({ error: "Files must be 25 MB or smaller." }, { status: 413 });
  return NextResponse.json(await saveUpload(file));
}
