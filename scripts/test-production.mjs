// Builds Paralog the way the Docker image does and drives the production server
// against a data directory shaped like a real journal. The e2e suite runs a dev
// server with tidy fixtures, which is how two regressions reached deployments:
// pages prerendered at build time, and macOS metadata files read as entries.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { after, before, test } from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const next = path.join(root, "node_modules", "next", "dist", "bin", "next");
const dataDir = path.join(root, ".test-data", "production");
const password = "paralog-production-test";
let server;
let base;
let cookie = "";

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function write(relative, content, modified) {
  const file = path.join(dataDir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  if (modified) fs.utimesSync(file, modified, modified);
}

// macOS writes one of these beside every file it copies; this header and these
// attribute names are what showed up in the history widgets.
const appleDouble = Buffer.concat([
  Buffer.from([0x00, 0x05, 0x16, 0x07, 0x00, 0x02, 0x00, 0x00]),
  Buffer.from("Mac OS X        \u0000\u0002ATTR\u0000com.apple.provenance\u0000com.dropbox.attrs\u0000", "latin1"),
]);

function seed() {
  fs.rmSync(dataDir, { recursive: true, force: true });
  const older = new Date("2020-01-01T00:00:00Z");
  write("2016/10-October/2016-10-22-Saturday.md", "The real entry for October twenty-second.\n", older);
  write("2016/10-October/._2016-10-22-Saturday.md", appleDouble);
  write("2017/02-February/._2017-02-10-Friday.md", appleDouble);
  write(".DS_Store", appleDouble);
  write(".git/2016-10-23.md", "Tooling, not a journal entry.\n");
  write(".obsidian/2016-10-24.md", "Editor state, not a journal entry.\n");
  // The same day in an old save format and the current one; the newer copy wins.
  write("imported/2018-05-06.md", "An older copy of May sixth.\n", older);
  write("2018/05-May/2018-05-06-Sunday.md", "The newest copy of May sixth.\n");
  write("notes/2019-07-04.md", "Dropped in by hand, outside the save format.\n", older);
}

async function request(pathname, init = {}) {
  return fetch(`${base}${pathname}`, { ...init, redirect: "manual", headers: { ...init.headers, ...(cookie ? { Cookie: cookie } : {}) } });
}

async function json(pathname, init) {
  const response = await request(pathname, init);
  assert.equal(response.status, 200, `${pathname} answered ${response.status}`);
  return response.json();
}

before(async () => {
  // Docker builds the image before any secret exists, so the build must not
  // see the password a deployment will run with.
  const env = { ...process.env, NODE_ENV: "production" };
  delete env.PARALOG_PASSWORD;
  delete env.PARALOG_AUTH_SECRET;
  const build = spawnSync(process.execPath, [next, "build"], { cwd: root, env, stdio: ["ignore", "inherit", "inherit"] });
  assert.equal(build.status, 0, "next build failed");

  seed();
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [next, "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...env, PARALOG_DATA_DIR: dataDir, PARALOG_PASSWORD: password, PARALOG_AUTH_SECRET: "paralog-production-test-secret" },
  });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(base, { signal: AbortSignal.timeout(1_000) })).ok) return;
    } catch { /* Not listening yet. */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("The production server did not start.");
}, { timeout: 300_000 });

after(() => {
  server?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("pages that depend on the session are rendered per request, not at build time", () => {
  const routes = Object.keys(JSON.parse(fs.readFileSync(path.join(root, ".next", "prerender-manifest.json"), "utf8")).routes);
  for (const route of ["/", "/attachments"]) assert.ok(!routes.includes(route), `${route} was prerendered`);
});

test("signing in works on a build made without the password", async () => {
  const login = await (await request("/")).text();
  assert.match(login, /type="password"/);
  assert.doesNotMatch(login, /Set <code>PARALOG_PASSWORD/);
  assert.equal((await request("/api/entries?date=2016-10-22")).status, 401);

  const response = await request("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
  assert.equal(response.status, 200);
  cookie = response.headers.get("set-cookie").split(";")[0];
  assert.doesNotMatch(await (await request("/")).text(), /type="password"/);
  assert.doesNotMatch(await (await request("/attachments")).text(), /type="password"/);
});

test("hidden files and folders never become entries", async () => {
  assert.deepEqual((await json("/api/calendar?month=2016-10")).dates, ["2016-10-22"]);
  assert.deepEqual((await json("/api/calendar?month=2017-02")).dates, []);
  assert.equal((await json("/api/entries?date=2016-10-22")).content, "The real entry for October twenty-second.\n");
  const memories = (await json("/api/entries?date=2026-10-22")).memories;
  assert.deepEqual(memories.map((memory) => [memory.date, memory.excerpt]), [["2016-10-22", "The real entry for October twenty-second."]]);
  assert.deepEqual((await json("/api/search?q=dropbox")).results, []);
});

test("a day saved in two places opens the newest copy, and edits stay in the file they came from", async () => {
  assert.equal((await json("/api/entries?date=2018-05-06")).content, "The newest copy of May sixth.\n");

  const manual = await json("/api/entries?date=2019-07-04");
  assert.equal(manual.content, "Dropped in by hand, outside the save format.\n");
  const saved = await json("/api/entries?date=2019-07-04", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "Edited in the app.", baseVersion: manual.version }),
  });
  assert.equal(saved.saved, true);
  assert.equal(fs.readFileSync(path.join(dataDir, "notes/2019-07-04.md"), "utf8"), "Edited in the app.\n");
  assert.equal(fs.existsSync(path.join(dataDir, "2019/07-July/2019-07-04-Thursday.md")), false);
});
