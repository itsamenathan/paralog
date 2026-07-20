import { and, desc, eq, like, lt, notInArray } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { entries, revisions } from "@/lib/db/schema";
import { markdownBody } from "@/lib/front-matter";
import { discoverEntries } from "./discovery";
import { entryPath } from "./paths";
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
  indexEntryContent(date, filePath, content);
  return { date, saved: true };
}

export function entriesForMonth(month: string) {
  discoverEntries();
  return db().select({ date: entries.date, path: entries.path }).from(entries).where(like(entries.date, `${month}-%`)).orderBy(entries.date).all().flatMap((row) => {
    if (!fs.existsSync(row.path)) return [];
    const body = markdownBody(fs.readFileSync(row.path, "utf8")).trim();
    return [{ date: row.date, words: body ? body.split(/\s+/).length : 0 }];
  });
}
