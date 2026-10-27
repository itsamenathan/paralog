import { and, desc, eq, like, lt, notInArray } from "drizzle-orm";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "@/lib/atomic-file";
import { db } from "@/lib/db";
import { entries, revisions } from "@/lib/db/schema";
import { markdownBody } from "@/lib/front-matter";
import { discoverEntries } from "./discovery";
import { currentEntryPath, entryPath } from "./paths";
import { settings } from "./settings";
import { indexEntryContent } from "./content-index";

function excerpt(content: string, length: number) {
  return markdownBody(content)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^[#>*_`~-]+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, length);
}

// Identifies what a file holds, so a save can tell whether it was written on top
// of the copy it started from. An entry without a file has the empty version.
export function entryVersion(content: string | null) {
  return content === null ? "" : crypto.createHash("sha256").update(content).digest("base64url");
}

const storedMarkdown = (content: string) => content.endsWith("\n") ? content : `${content}\n`;

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
    return [{ date: value.date, excerpt: excerpt(memory, 180), words: body.trim() ? body.trim().split(/\s+/).length : 0 }];
  });
  const version = entryVersion(exists ? content : null);
  return { date, content, exists, version, previousYears: memories.map((value) => value.date), memories, template: settings().template };
}

export type SaveEntryResult = { saved: true; date: string; version: string } | { saved: false; conflict: true; date: string };

// A base version names the copy the new content was written on top of. When the
// file has changed since, saving would discard writing nobody here has seen, so
// the save is refused unless it would leave the file unchanged anyway. Saves
// without a base version come from clients that predate the check.
export function saveEntry(date: string, content: string, baseVersion?: string): SaveEntryResult {
  const filePath = currentEntryPath(date);
  const previous = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
  const stored = storedMarkdown(content);
  if (baseVersion !== undefined && baseVersion !== entryVersion(previous) && previous !== stored) {
    return { saved: false, conflict: true, date };
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (previous !== null) {
    if (previous !== stored) {
      const latest = db().select({ content: revisions.content }).from(revisions).where(eq(revisions.date, date)).orderBy(desc(revisions.id)).limit(1).get();
      if (latest?.content !== previous) db().insert(revisions).values({ date, content: previous, createdAt: new Date().toISOString() }).run();
      const retained = db().select({ id: revisions.id }).from(revisions).where(eq(revisions.date, date)).orderBy(desc(revisions.id)).limit(50);
      db().delete(revisions).where(and(eq(revisions.date, date), notInArray(revisions.id, retained))).run();
    }
  }
  writeFileAtomic(filePath, stored);
  const updatedAt = new Date().toISOString();
  db().insert(entries).values({ date, path: filePath, updatedAt }).onConflictDoUpdate({ target: entries.date, set: { path: filePath, updatedAt } }).run();
  indexEntryContent(date, filePath, content);
  return { saved: true, date, version: entryVersion(stored) };
}

export function entriesForMonth(month: string) {
  discoverEntries();
  return db().select({ date: entries.date, path: entries.path }).from(entries).where(like(entries.date, `${month}-%`)).orderBy(entries.date).all().flatMap((row) => {
    if (!fs.existsSync(row.path)) return [];
    const body = markdownBody(fs.readFileSync(row.path, "utf8")).trim();
    return [{ date: row.date, words: body ? body.split(/\s+/).length : 0 }];
  });
}
