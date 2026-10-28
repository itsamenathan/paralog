import type { Instrumentation } from "next";

const serverRuntime = process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build";

export async function register() {
  if (!serverRuntime) return;
  // Start OpenTelemetry before anything else so the first requests and startup logs are captured.
  await import("./instrumentation.node");
  const { migrateDatabase } = await import("@/lib/db");
  migrateDatabase();
  const { startNotificationScheduler } = await import("@/lib/notifications");
  startNotificationScheduler();
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (!serverRuntime) return;
  const { log } = await import("@/lib/log");
  log.error(`Paralog request failed: ${request.method} ${request.path}`, error, {
    "http.request.method": request.method,
    "http.route": context.routePath,
    "paralog.route_type": context.routeType,
  });
};
