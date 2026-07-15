import { and, desc, eq, like, lt, notInArray } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { diffLines } from "diff";
import { dataDir, db } from "@/lib/db";
import { entries, revisions, settingsTable } from "@/lib/db/schema";
import { markdownBody } from "@/lib/front-matter";

export { dataDir } from "@/lib/db";
const defaultFormat = "YYYY/MM-MMMM/YYYY-MM-DD-dddd.md";

function parts(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const local = new Date(year, month - 1, day);
  return { YYYY: String(year), YY: String(year).slice(-2), MM: String(month).padStart(2, "0"), M: String(month), DD: String(day).padStart(2, "0"), D: String(day), MMMM: new Intl.DateTimeFormat("en-US", { month: "long" }).format(local), MMM: new Intl.DateTimeFormat("en-US", { month: "short" }).format(local), dddd: new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(local), ddd: new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(local) };
}

function setting(key: string, fallback: string) { return db().select({ value: settingsTable.value }).from(settingsTable).where(eq(settingsTable.key, key)).get()?.value || fallback; }
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
  const upsert = (key: string, value: string) => db().insert(settingsTable).values({ key, value }).onConflictDoUpdate({ target: settingsTable.key, set: { value } }).run();
  upsert("saveFormat", saveFormat);
  upsert("template", template);
  upsert("showTagCloud", String(showTagCloud));
  upsert("vimMode", String(vimMode));
  upsert("autoSave", String(autoSave));
  upsert("autoLocation", String(autoLocation));
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
  const walk = (directory: string) => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      if (item.name === "attachments" || item.name === "journal.db" || item.name.startsWith("journal.db-")) continue;
      const file = path.join(directory, item.name);
      if (item.isDirectory()) walk(file);
      else if (item.isFile() && item.name.endsWith(".md")) {
        const date = item.name.match(/(\d{4}-\d{2}-\d{2})/)?.[1];
        if (date) {
          const updatedAt = fs.statSync(file).mtime.toISOString();
          db().insert(entries).values({ date, path: file, updatedAt }).onConflictDoUpdate({
            target: entries.date,
            set: { path: file, updatedAt },
          }).run();
        }
      }
    }
  };
  walk(dataDir);
}

export function getEntry(date: string) {
  discoverEntries();
  const row = db().select({ path: entries.path }).from(entries).where(eq(entries.date, date)).get();
  const filePath = row?.path || entryPath(date);
  const exists = fs.existsSync(filePath);
  const content = exists ? fs.readFileSync(filePath, "utf8") : "";
  const previousYears = db().select({ date: entries.date, path: entries.path }).from(entries)
    .where(and(like(entries.date, `____-${date.slice(5)}`), lt(entries.date, date)))
    .orderBy(desc(entries.date)).all();
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
      const latest = db().select({ content: revisions.content }).from(revisions).where(eq(revisions.date, date)).orderBy(desc(revisions.id)).limit(1).get();
      if (latest?.content !== previous) db().insert(revisions).values({ date, content: previous, createdAt: new Date().toISOString() }).run();
      const retained = db().select({ id: revisions.id }).from(revisions).where(eq(revisions.date, date)).orderBy(desc(revisions.id)).limit(50);
      db().delete(revisions).where(and(eq(revisions.date, date), notInArray(revisions.id, retained))).run();
    }
  }
  fs.writeFileSync(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  const updatedAt = new Date().toISOString();
  db().insert(entries).values({ date, path: filePath, updatedAt }).onConflictDoUpdate({ target: entries.date, set: { path: filePath, updatedAt } }).run();
  return { date, saved: true };
}

export function entriesForMonth(month: string) { discoverEntries(); return db().select({ date: entries.date }).from(entries).where(like(entries.date, `${month}-%`)).orderBy(entries.date).all().map((row) => row.date); }

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
  const storedRevisions = db().select({ id: revisions.id, content: revisions.content, createdAt: revisions.createdAt }).from(revisions).where(eq(revisions.date, date)).orderBy(desc(revisions.id)).limit(50).all();
  const currentPath = entryPath(date);
  let nextContent = fs.existsSync(currentPath) ? fs.readFileSync(currentPath, "utf8") : "";
  return storedRevisions.map((revision) => {
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
  return db().select({ id: revisions.id, content: revisions.content, createdAt: revisions.createdAt }).from(revisions).where(and(eq(revisions.date, date), eq(revisions.id, id))).get();
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
  const rows = db().select({ date: entries.date, path: entries.path }).from(entries).orderBy(desc(entries.date)).all();
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
  const rows = db().select({ date: entries.date, path: entries.path }).from(entries).orderBy(desc(entries.date)).all();
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
