import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

// Exporters are chosen by the standard OTEL_* variables (OTEL_EXPORTER_OTLP_ENDPOINT, _HEADERS,
// _PROTOCOL, OTEL_TRACES_EXPORTER, ...). Without an endpoint they would retry against localhost,
// so stay off instead.
const endpointVariables = [
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
  "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
];
const state = globalThis as typeof globalThis & { __paralogOtel?: NodeSDK };

if (!state.__paralogOtel && process.env.OTEL_SDK_DISABLED !== "true" && endpointVariables.some((name) => process.env[name])) {
  // Logs reach ClickStack from stdout through the host collector, so exporting them here too would
  // duplicate every line. Set OTEL_LOGS_EXPORTER=otlp to export them through the SDK instead.
  process.env.OTEL_LOGS_EXPORTER ??= "none";
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || "paralog",
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version || "0.1.0",
    }),
  });
  sdk.start();
  state.__paralogOtel = sdk;
  // Docker stops the container with SIGTERM; flush queued spans before the process exits.
  process.once("SIGTERM", () => void sdk.shutdown().catch(() => undefined));
}
