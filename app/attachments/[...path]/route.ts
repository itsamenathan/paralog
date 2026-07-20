import { NextRequest } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { attachmentFileResponse } from "@/lib/journal/attachment-response";

export const runtime = "nodejs";

async function respond(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  if (!await isAuthenticated()) return new Response("Unauthorized", { status: 401 });
  const segments = (await context.params).path;
  return attachmentFileResponse(request, `attachments/${segments.join("/")}`);
}

export const GET = respond;
export const HEAD = respond;
