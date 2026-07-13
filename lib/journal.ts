import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const dataDir = process.env.PARALOG_DATA_DIR || path.join(process.cwd(), "data");
const dbPath = path.join(dataDir, "journal.db");
const defaultFormat = "YYYY/MM-MMMM/YYYY-MM-DD-dddd.md";
let database: Database.Database | undefined;

function db() {
  if (!database) {
    fs.mkdirSync(dataDir, { recursive: true });
    database = new Database(dbPath);
    database.pragma("journal_mode = WAL");
    database.exec("CREATE TABLE IF NOT EXISTS entries (date TEXT PRIMARY KEY, path TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  }
  return database;
}

function parts(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const local = new Date(year, month - 1, day);
  return { YYYY: String(year), YY: String(year).slice(-2), MM: String(month).padStart(2, "0"), M: String(month), DD: String(day).padStart(2, "0"), D: String(day), MMMM: new Intl.DateTimeFormat("en-US", { month: "long" }).format(local), MMM: new Intl.DateTimeFormat("en-US", { month: "short" }).format(local), dddd: new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(local), ddd: new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(local) };
}

function setting(key: string, fallback: string) { return (db().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value?: string } | undefined)?.value || fallback; }
export function settings() { return { saveFormat: setting("saveFormat", defaultFormat), template: setting("template", "") }; }
export function updateSettings(values: { saveFormat?: string; template?: string }) {
  const current = settings();
  const saveFormat = values.saveFormat?.trim() || current.saveFormat;
  if (!saveFormat.includes("YYYY") || !saveFormat.includes("MM") || !saveFormat.includes("DD") || saveFormat.includes("..") || path.isAbsolute(saveFormat)) throw new Error("Save format must be a relative path containing YYYY, MM, and DD.");
  const template = values.template ?? current.template;
  const insert = db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  insert.run("saveFormat", saveFormat);
  insert.run("template", template);
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
    const excerpt = memory
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/^[#>*_`~-]+/gm, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
    return [{ date: value.date, excerpt, words: memory.trim() ? memory.trim().split(/\s+/).length : 0 }];
  });
  return { date, content, exists, previousYears: memories.map((value) => value.date), memories, template: settings().template };
}

export function saveEntry(date: string, content: string) {
  const filePath = entryPath(date);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  db().prepare("INSERT INTO entries (date, path, updated_at) VALUES (?, ?, ?) ON CONFLICT(date) DO UPDATE SET path = excluded.path, updated_at = excluded.updated_at").run(date, filePath, new Date().toISOString());
  return { date, saved: true };
}

export function entriesForMonth(month: string) { discoverEntries(); return (db().prepare("SELECT date FROM entries WHERE date LIKE ? ORDER BY date").all(`${month}-%`) as { date: string }[]).map((row) => row.date); }

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
