import { logs, SeverityNumber, trace } from "@opentelemetry/api";
import pino from "pino";

type Level = "debug" | "info" | "warn" | "error";
type Attributes = Record<string, string | number | boolean | undefined>;

// One JSON object per line on stdout, which Docker and the host collector already pick up. Lines
// written inside a request carry the active span's IDs so they can be matched to its trace.
const logger = pino({
  level: process.env.PARALOG_LOG_LEVEL || "info",
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: { level: (label) => ({ level: label }) },
  mixin() {
    const span = trace.getActiveSpan()?.spanContext();
    return span ? { trace_id: span.traceId, span_id: span.spanId, trace_flags: `0${span.traceFlags.toString(16)}` } : {};
  },
});

const severity: Record<Level, SeverityNumber> = {
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

function exportsLogs() {
  const exporter = process.env.OTEL_LOGS_EXPORTER;
  return Boolean(exporter) && exporter !== "none";
}

function write(level: Level, message: string, error?: unknown, attributes?: Attributes) {
  logger[level]({ ...attributes, ...(error === undefined ? {} : { err: error }) }, message);
  // Off by default (see instrumentation.node.ts): the collector already ships stdout, so exporting
  // the same lines through the SDK would store each of them twice.
  if (!exportsLogs()) return;
  logs.getLogger("paralog").emit({
    severityNumber: severity[level],
    severityText: level.toUpperCase(),
    body: message,
    attributes: {
      ...attributes,
      ...(error instanceof Error
        ? { "exception.type": error.name, "exception.message": error.message, "exception.stacktrace": error.stack }
        : error === undefined
          ? {}
          : { "exception.message": String(error) }),
    },
  });
}

export const log = {
  debug: (message: string, attributes?: Attributes) => write("debug", message, undefined, attributes),
  info: (message: string, attributes?: Attributes) => write("info", message, undefined, attributes),
  warn: (message: string, error?: unknown, attributes?: Attributes) => write("warn", message, error, attributes),
  error: (message: string, error?: unknown, attributes?: Attributes) => write("error", message, error, attributes),
};
