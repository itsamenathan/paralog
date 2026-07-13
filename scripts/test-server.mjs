import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const statePath = path.join(root, ".paralog-test-server.json");
const outputPath = path.join(root, ".paralog-test-server.log");
const errorPath = path.join(root, ".paralog-test-server.error.log");
const command = process.argv[2];

function readState() {
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    return null;
  }
}

function isAlive(pid) {
  if (!Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function responds(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function start() {
  const current = readState();
  if (current && isAlive(current.pid)) {
    console.log(`Paralog test server is already running at http://localhost:${current.port}`);
    console.log(current.defaultPassword ? "Password: paralog" : "Password: configured via PARALOG_TEST_PASSWORD");
    return;
  }
  if (current) fs.rmSync(statePath, { force: true });

  const port = Number.parseInt(process.env.PARALOG_TEST_PORT || "3000", 10);
  const defaultPassword = !process.env.PARALOG_TEST_PASSWORD;
  const password = process.env.PARALOG_TEST_PASSWORD || "paralog";
  const dataDir = path.resolve(process.env.PARALOG_TEST_DATA_DIR || path.join(root, ".test-data"));
  const next = path.join(root, "node_modules", "next", "dist", "bin", "next");
  if (!fs.existsSync(path.join(root, ".next", "BUILD_ID"))) {
    throw new Error("Production build not found. Run `mise run build` first.");
  }

  fs.mkdirSync(dataDir, { recursive: true });
  const output = fs.openSync(outputPath, "a");
  const error = fs.openSync(errorPath, "a");
  const child = spawn(process.execPath, [next, "start", "--hostname", "0.0.0.0", "--port", String(port)], {
    cwd: root,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", output, error],
    env: {
      ...process.env,
      NODE_ENV: "production",
      PARALOG_DATA_DIR: dataDir,
      PARALOG_PASSWORD: password,
      PARALOG_AUTH_SECRET: process.env.PARALOG_TEST_AUTH_SECRET || "paralog-local-test-secret-not-for-production",
    },
  });
  child.unref();
  fs.closeSync(output);
  fs.closeSync(error);
  fs.writeFileSync(statePath, JSON.stringify({ pid: child.pid, port, defaultPassword, startedAt: new Date().toISOString() }, null, 2));

  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (!isAlive(child.pid)) break;
    if (await responds(port)) {
      console.log(`Paralog test server is running at http://localhost:${port}`);
      console.log(`Password: ${password}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  fs.rmSync(statePath, { force: true });
  throw new Error(`Test server failed to start. See ${errorPath}`);
}

async function stop() {
  const state = readState();
  if (!state || !isAlive(state.pid)) {
    fs.rmSync(statePath, { force: true });
    console.log("Paralog test server is not running.");
    return;
  }

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(state.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } else {
    try {
      process.kill(-state.pid, "SIGTERM");
    } catch {
      process.kill(state.pid, "SIGTERM");
    }
  }
  fs.rmSync(statePath, { force: true });
  console.log("Paralog test server stopped.");
}

async function status() {
  const state = readState();
  if (!state || !isAlive(state.pid)) {
    console.log("Paralog test server is not running.");
    process.exitCode = 1;
    return;
  }
  const ready = await responds(state.port);
  console.log(`Paralog test server: ${ready ? "ready" : "starting"}`);
  console.log(`URL: http://localhost:${state.port}`);
  console.log(state.defaultPassword ? "Password: paralog" : "Password: configured via PARALOG_TEST_PASSWORD");
}

if (command === "start") await start();
else if (command === "stop") await stop();
else if (command === "status") await status();
else {
  console.error("Usage: node scripts/test-server.mjs <start|status|stop>");
  process.exitCode = 1;
}
