import { logs, SeverityNumber } from "@opentelemetry/api";

type Level = "debug" | "info" | "warn" | "error";
type Attributes = Record<string, string | number | boolean | undefined>;

const severity: Record<Level, { number: SeverityNumber; text: string }> = {
  debug: { number: SeverityNumber.DEBUG, text: "DEBUG" },
  info: { number: SeverityNumber.INFO, text: "INFO" },
  warn: { number: SeverityNumber.WARN, text: "WARN" },
  error: { number: SeverityNumber.ERROR, text: "ERROR" },
};

function errorAttributes(error: unknown): Attributes {
  if (error instanceof Error) {
    return { "exception.type": error.name, "exception.message": error.message, "exception.stacktrace": error.stack };
  }
  return { "exception.message": String(error) };
}

/**
 * Logs to stdout, where Docker collects it, and to the OpenTelemetry logs pipeline. The pipeline is
 * a no-op unless instrumentation.node.ts started the SDK, and it attaches the active trace context.
 */
function write(level: Level, message: string, error?: unknown, attributes?: Attributes) {
  if (error === undefined) console[level](message);
  else console[level](message, error);
  const { number, text } = severity[level];
  logs.getLogger("paralog").emit({
    severityNumber: number,
    severityText: text,
    body: message,
    attributes: { ...attributes, ...(error === undefined ? {} : errorAttributes(error)) },
  });
}

export const log = {
  debug: (message: string, attributes?: Attributes) => write("debug", message, undefined, attributes),
  info: (message: string, attributes?: Attributes) => write("info", message, undefined, attributes),
  warn: (message: string, error?: unknown, attributes?: Attributes) => write("warn", message, error, attributes),
  error: (message: string, error?: unknown, attributes?: Attributes) => write("error", message, error, attributes),
};
