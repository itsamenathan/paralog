import fs from "node:fs";
import { eq } from "drizzle-orm";
import { attachmentReferencesInMarkdown } from "@/lib/attachment-references";
import { entryNeedsContentIndex } from "@/lib/content-index-state";
import { db } from "@/lib/db";
import { attachmentReferences, entries, entryContentScans, journalReferencesTable } from "@/lib/db/schema";
import { indexedJournalReferences } from "@/lib/entry-journal-references";
import { discoverEntries } from "./discovery";

export const ENTRY_CONTENT_INDEX_VERSION = 1;

export function indexEntryContent(date: string, entryPath: string, content: string, stat = fs.statSync(entryPath)) {
  const attachments = attachmentReferencesInMarkdown(content);
  const references = indexedJournalReferences(content);
  const entryUpdatedAt = stat.mtime.toISOString();
  db().transaction((transaction) => {
    transaction.delete(attachmentReferences).where(eq(attachmentReferences.entryDate, date)).run();
    transaction.delete(journalReferencesTable).where(eq(journalReferencesTable.entryDate, date)).run();
    for (const [attachmentPath, occurrences] of attachments) {
      transaction.insert(attachmentReferences).values({ attachmentPath, entryDate: date, occurrences }).run();
    }
    for (const reference of references) {
      transaction.insert(journalReferencesTable).values({ entryDate: date, ...reference }).run();
    }
    transaction.insert(entryContentScans).values({
      entryDate: date,
      entryPath,
      entryUpdatedAt,
      entrySize: stat.size,
      indexVersion: ENTRY_CONTENT_INDEX_VERSION,
    }).onConflictDoUpdate({ target: entryContentScans.entryDate, set: {
      entryPath,
      entryUpdatedAt,
      entrySize: stat.size,
      indexVersion: ENTRY_CONTENT_INDEX_VERSION,
    } }).run();
  });
}

export function syncEntryContentIndex({ force = false }: { force?: boolean } = {}) {
  discoverEntries();
  const scans = new Map(db().select().from(entryContentScans).all().map((row) => [row.entryDate, row]));
  const liveDates = new Set<string>();
  let indexed = 0;
  let removed = 0;
  for (const entry of db().select().from(entries).all()) {
    if (!fs.existsSync(entry.path)) continue;
    const stat = fs.statSync(entry.path);
    if (!stat.isFile()) continue;
    liveDates.add(entry.date);
    const fileState = { entryPath: entry.path, entryUpdatedAt: stat.mtime.toISOString(), entrySize: stat.size };
    if (!entryNeedsContentIndex(scans.get(entry.date), fileState, ENTRY_CONTENT_INDEX_VERSION, force)) continue;
    indexEntryContent(entry.date, entry.path, fs.readFileSync(entry.path, "utf8"), stat);
    indexed += 1;
  }
  for (const date of scans.keys()) {
    if (liveDates.has(date)) continue;
    db().transaction((transaction) => {
      transaction.delete(attachmentReferences).where(eq(attachmentReferences.entryDate, date)).run();
      transaction.delete(journalReferencesTable).where(eq(journalReferencesTable.entryDate, date)).run();
      transaction.delete(entryContentScans).where(eq(entryContentScans.entryDate, date)).run();
    });
    removed += 1;
  }
  return { entries: liveDates.size, indexed, removed };
}
