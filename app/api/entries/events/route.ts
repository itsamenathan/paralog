import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { subscribeToEntryChanges } from "@/lib/entry-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!await isAuthenticated()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (value: string) => {
        if (!closed) controller.enqueue(encoder.encode(value));
      };
      const unsubscribe = subscribeToEntryChanges((change) => {
        send(`data: ${JSON.stringify(change)}\n\n`);
      });
      const heartbeat = setInterval(() => send(": heartbeat\n\n"), 20_000);
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        controller.close();
      };

      send("retry: 1500\n\n");
      request.signal.addEventListener("abort", close, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
