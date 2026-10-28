import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const logModule = new URL("../lib/log.ts", import.meta.url).href;
const traceId = "0af7651916cd43dd8448eb211c80319c";
const spanId = "b7ad6b7169203331";

// pino writes straight to the process's stdout, so run the logger in a child and read what it printed.
function runLogger(body, env = {}) {
  const program = `
    import { context, trace } from "@opentelemetry/api";
    import { NodeSDK } from "@opentelemetry/sdk-node";
    import { log } from ${JSON.stringify(logModule)};
    new NodeSDK().start(); // registers the context manager that makes a span "active"
    ${body}
  `;
  const result = spawnSync(process.execPath, ["--no-warnings", "--input-type=module", "-e", program], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env: { ...process.env, OTEL_TRACES_EXPORTER: "none", OTEL_LOGS_EXPORTER: "none", ...env },
  });
  assert.equal(result.status, 0, result.stderr);
  return { lines: result.stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line)), stderr: result.stderr };
}

test("writes one JSON object per line with a readable level and ISO time", () => {
  const { lines } = runLogger(`log.info("hello", { "app.key": "value" });`);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].level, "info");
  assert.equal(lines[0].msg, "hello");
  assert.equal(lines[0]["app.key"], "value");
  assert.match(lines[0].time, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal("pid" in lines[0] || "hostname" in lines[0], false);
});

test("adds trace context only inside an active span", () => {
  const { lines } = runLogger(`
    log.info("outside");
    const span = trace.wrapSpanContext({ traceId: "${traceId}", spanId: "${spanId}", traceFlags: 1 });
    context.with(trace.setSpan(context.active(), span), () => log.info("inside"));
  `);
  const [outside, inside] = lines;
  assert.equal("trace_id" in outside, false);
  assert.equal(inside.trace_id, traceId);
  assert.equal(inside.span_id, spanId);
  assert.equal(inside.trace_flags, "01");
});

test("serializes errors and keeps every level on stdout", () => {
  const { lines, stderr } = runLogger(`
    log.warn("careful", new Error("soft"));
    log.error("failed", new TypeError("bad"), { "http.route": "/x" });
    log.error("odd", "not an error object");
  `);
  assert.equal(stderr, "");
  assert.deepEqual(lines.map((line) => line.level), ["warn", "error", "error"]);
  assert.equal(lines[1].err.type, "TypeError");
  assert.equal(lines[1].err.message, "bad");
  assert.match(lines[1].err.stack, /TypeError: bad/);
  assert.equal(lines[1]["http.route"], "/x");
  assert.equal(lines[2].err, "not an error object");
});

test("PARALOG_LOG_LEVEL filters quieter messages", () => {
  const { lines } = runLogger(`log.debug("d"); log.info("i"); log.warn("w");`, { PARALOG_LOG_LEVEL: "warn" });
  assert.deepEqual(lines.map((line) => line.msg), ["w"]);
});
