import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { diffLines } from "diff";
import { markdownBody } from "@/lib/front-matter";

export const dataDir = process.env.PARALOG_DATA_DIR || path.join(process.cwd(), "data");
const dbPath = path.join(dataDir, "journal.db");
const defaultFormat = "YYYY/MM-MMMM/YYYY-MM-DD-dddd.md";
let database: Database.Database | undefined;

function db() {
  if (!database) {
    fs.mkdirSync(dataDir, { recursive: true });
    database = new Database(dbPath);
    database.pragma("journal_mode = WAL");
    database.exec("CREATE TABLE IF NOT EXISTS entries (date TEXT PRIMARY KEY, path TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS revisions (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS revisions_date_created ON revisions(date, created_at DESC)");
  }
  return database;
}

function parts(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const local = new Date(year, month - 1, day);
  return { YYYY: String(year), YY: String(year).slice(-2), MM: String(month).padStart(2, "0"), M: String(month), DD: String(day).padStart(2, "0"), D: String(day), MMMM: new Intl.DateTimeFormat("en-US", { month: "long" }).format(local), MMM: new Intl.DateTimeFormat("en-US", { month: "short" }).format(local), dddd: new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(local), ddd: new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(local) };
}

function setting(key: string, fallback: string) { return (db().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value?: string } | undefined)?.value || fallback; }
export function settings() { return { saveFormat: setting("saveFormat", defaultFormat), template: setting("template", ""), showTagCloud: setting("showTagCloud", "true") !== "false", vimMode: setting("vimMode", "false") === "true", autoSave: setting("autoSave", "true") !== "false", autoLocation: setting("autoLocation", "false") === "true" }; }
export function updateSettings(values: { saveFormat?: string; template?: string; showTagCloud?: boolean; vimMode?: boolean; autoSave?: boolean; autoLocation?: boolean }) {
  const current = settings();
  const saveFormat = values.saveFormat?.trim() || current.saveFormat;
  if (!saveFormat.includes("YYYY") || !saveFormat.includes("MM") || !saveFormat.includes("DD") || saveFormat.includes("..") || path.isAbsolute(saveFormat)) throw new Error("Save format must be a relative path containing YYYY, MM, and DD.");
  const template = values.template ?? current.template;
  const showTagCloud = values.showTagCloud ?? current.showTagCloud;
  const vimMode = values.vimMode ?? current.vimMode;
  const autoSave = values.autoSave ?? current.autoSave;
  const autoLocation = values.autoLocation ?? current.autoLocation;
  const insert = db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  insert.run("saveFormat", saveFormat);
  insert.run("template", template);
  insert.run("showTagCloud", String(showTagCloud));
  insert.run("vimMode", String(vimMode));
  insert.run("autoSave", String(autoSave));
  insert.run("autoLocation", String(autoLocation));
  return settings();
}

export function entryPath(date: string) {
  const tokens = parts(date);
  const format = settings().saveFormat;
  const rendered = format.replace(/YYYY|MMMM|MMM|MM|M|DD|D|dddd|ddd|YY/g, (token) => tokens[token as keyof typeof tokens]);
  const resolved = path.resolve(dataDir, rendered);
  if (!resolved.startsWith(`${path.resolve(dataDir)}${path.sep}`)) throw new Error("Invalid save format.");
  return resolved;
}

function discoverEntries() {
  const index = db().prepare("INSERT INTO entries (date, path, updated_at) VALUES (?, ?, ?) ON CONFLICT(date) DO UPDATE SET path = excluded.path, updated_at = excluded.updated_at");
  const walk = (directory: string) => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      if (item.name === "attachments" || item.name === "journal.db" || item.name.startsWith("journal.db-")) continue;
      const file = path.join(directory, item.name);
      if (item.isDirectory()) walk(file);
      else if (item.isFile() && item.name.endsWith(".md")) {
        const date = item.name.match(/(\d{4}-\d{2}-\d{2})/)?.[1];
        if (date) index.run(date, file, fs.statSync(file).mtime.toISOString());
      }
    }
  };
  walk(dataDir);
}

export function getEntry(date: string) {
  discoverEntries();
  const row = db().prepare("SELECT path FROM entries WHERE date = ?").get(date) as { path: string } | undefined;
  const filePath = row?.path || entryPath(date);
  const exists = fs.existsSync(filePath);
  const content = exists ? fs.readFileSync(filePath, "utf8") : "";
  const previousYears = db().prepare("SELECT date, path FROM entries WHERE substr(date, 6) = substr(?, 6) AND date < ? ORDER BY date DESC").all(date, date) as { date: string; path: string }[];
  const memories = previousYears.flatMap((value) => {
    if (!fs.existsSync(value.path)) return [];
    const memory = fs.readFileSync(value.path, "utf8");
    const body = markdownBody(memory);
    const excerpt = body
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/^[#>*_`~-]+/gm, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
    return [{ date: value.date, excerpt, words: body.trim() ? body.trim().split(/\s+/).length : 0 }];
  });
  return { date, content, exists, previousYears: memories.map((value) => value.date), memories, template: settings().template };
}

export function saveEntry(date: string, content: string) {
  const filePath = entryPath(date);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath)) {
    const previous = fs.readFileSync(filePath, "utf8");
    if (previous !== content && previous !== `${content}\n`) {
      const latest = db().prepare("SELECT content FROM revisions WHERE date = ? ORDER BY id DESC LIMIT 1").get(date) as { content: string } | undefined;
      if (latest?.content !== previous) db().prepare("INSERT INTO revisions (date, content, created_at) VALUES (?, ?, ?)").run(date, previous, new Date().toISOString());
      db().prepare("DELETE FROM revisions WHERE date = ? AND id NOT IN (SELECT id FROM revisions WHERE date = ? ORDER BY id DESC LIMIT 50)").run(date, date);
    }
  }
  fs.writeFileSync(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  db().prepare("INSERT INTO entries (date, path, updated_at) VALUES (?, ?, ?) ON CONFLICT(date) DO UPDATE SET path = excluded.path, updated_at = excluded.updated_at").run(date, filePath, new Date().toISOString());
  return { date, saved: true };
}

export function entriesForMonth(month: string) { discoverEntries(); return (db().prepare("SELECT date FROM entries WHERE date LIKE ? ORDER BY date").all(`${month}-%`) as { date: string }[]).map((row) => row.date); }

function withoutFencedCode(content: string) {
  let fence: { character: string; length: number } | null = null;
  return content.split("\n").map((line) => {
    const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1];
    if (fence) {
      if (marker?.[0] === fence.character && marker.length >= fence.length) fence = null;
      return "";
    }
    if (marker) {
      fence = { character: marker[0], length: marker.length };
      return "";
    }
    return line;
  }).join("\n");
}

export function revisionsForDate(date: string) {
  const revisions = db().prepare("SELECT id, content, created_at AS createdAt FROM revisions WHERE date = ? ORDER BY id DESC LIMIT 50").all(date) as { id: number; content: string; createdAt: string }[];
  const currentPath = entryPath(date);
  let nextContent = fs.existsSync(currentPath) ? fs.readFileSync(currentPath, "utf8") : "";
  return revisions.map((revision) => {
    const diff = revisionChanges(revision.content, nextContent);
    nextContent = revision.content;
    return {
      id: revision.id,
      createdAt: revision.createdAt,
      words: markdownBody(revision.content).trim() ? markdownBody(revision.content).trim().split(/\s+/).length : 0,
      diff,
    };
  });
}

type RevisionDiffLine = { type: "added" | "removed" | "context" | "skip"; text: string; count?: number };

function revisionChanges(before: string, after: string) {
  const changes = diffLines(before, after, { timeout: 100 }) ?? [
    { value: before, added: false, removed: true, count: before.split("\n").length },
    { value: after, added: true, removed: false, count: after.split("\n").length },
  ];
  const lines: RevisionDiffLine[] = [];
  let additions = 0;
  let deletions = 0;

  changes.forEach((change, index) => {
    const values = change.value.split("\n");
    if (values.at(-1) === "") values.pop();
    if (change.added) additions += values.length;
    if (change.removed) deletions += values.length;
    if (change.added || change.removed || values.length <= 4) {
      const type = change.added ? "added" : change.removed ? "removed" : "context";
      lines.push(...values.map((text) => ({ type, text }) as RevisionDiffLine));
      return;
    }

    const leading = index === 0 ? [] : values.slice(0, 2);
    const trailing = index === changes.length - 1 ? [] : values.slice(-2);
    lines.push(...leading.map((text) => ({ type: "context" as const, text })));
    lines.push({ type: "skip", text: "", count: values.length - leading.length - trailing.length });
    lines.push(...trailing.map((text) => ({ type: "context" as const, text })));
  });

  return { additions, deletions, lines };
}

export function revisionForDate(date: string, id: number) {
  return db().prepare("SELECT id, content, created_at AS createdAt FROM revisions WHERE date = ? AND id = ?").get(date, id) as { id: number; content: string; createdAt: string } | undefined;
}

function entryTags(content: string) {
  const searchable = withoutFencedCode(markdownBody(content))
    .replace(/`[^`\n]*`/g, " ")
    .replace(/!?\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/https?:\/\/\S+/g, " ");
  const found = new Map<string, string>();
  for (const match of searchable.matchAll(/(^|[\s([{"'.,!?;:>])#([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu)) {
    const label = match[2];
    const key = label.normalize("NFC").toLocaleLowerCase();
    if (!found.has(key)) found.set(key, label);
  }
  return found;
}

export function tags() {
  discoverEntries();
  const rows = db().prepare("SELECT date, path FROM entries ORDER BY date DESC").all() as { date: string; path: string }[];
  const cloud = new Map<string, { name: string; dates: string[] }>();
  for (const row of rows) {
    if (!fs.existsSync(row.path)) continue;
    for (const [key, label] of entryTags(fs.readFileSync(row.path, "utf8"))) {
      const tag = cloud.get(key) ?? { name: label, dates: [] };
      tag.dates.push(row.date);
      cloud.set(key, tag);
    }
  }
  return [...cloud.values()]
    .map((tag) => ({ ...tag, count: tag.dates.length }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function excerpt(content: string) {
  return markdownBody(content)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^[#>*_`~-]+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

export function entriesTagged(tag: string) {
  const key = tag.normalize("NFC").toLocaleLowerCase();
  if (!/^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(key)) return [];
  discoverEntries();
  const rows = db().prepare("SELECT date, path FROM entries ORDER BY date DESC").all() as { date: string; path: string }[];
  return rows.flatMap((row) => {
    if (!fs.existsSync(row.path)) return [];
    const content = fs.readFileSync(row.path, "utf8");
    if (!entryTags(content).has(key)) return [];
    const body = markdownBody(content);
    return [{ date: row.date, excerpt: excerpt(content), words: body.trim() ? body.trim().split(/\s+/).length : 0 }];
  });
}

export function saveUpload(file: File) {
  const safeName = path.basename(file.name).replace(/[^a-zA-Z0-9._-]/g, "-") || "attachment";
  const now = new Date();
  const relativePath = path.join("attachments", String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, "0"), `${crypto.randomUUID()}-${safeName}`);
  const destination = path.join(dataDir, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  return file.arrayBuffer().then((buffer) => { fs.writeFileSync(destination, Buffer.from(buffer)); return { name: file.name, path: relativePath.replaceAll(path.sep, "/"), type: file.type }; });
}

export function uploadPath(relativePath: string) {
  const target = path.resolve(dataDir, relativePath);
  return target.startsWith(`${path.resolve(dataDir)}${path.sep}`) ? target : null;
}
