import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

// Exporters read OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_HEADERS, and the per-signal
// variants themselves. Without an endpoint they would retry against localhost, so stay off instead.
const endpointVariables = [
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
  "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
];
const state = globalThis as typeof globalThis & { __paralogOtel?: NodeSDK };

if (!state.__paralogOtel && process.env.OTEL_SDK_DISABLED !== "true" && endpointVariables.some((name) => process.env[name])) {
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || "paralog",
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version || "0.1.0",
    }),
    traceExporter: new OTLPTraceExporter(),
    logRecordProcessors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })],
  });
  sdk.start();
  state.__paralogOtel = sdk;
  // Docker stops the container with SIGTERM; flush queued spans and logs before the process exits.
  process.once("SIGTERM", () => void sdk.shutdown().catch(() => undefined));
}
