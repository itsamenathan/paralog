import { desc } from "drizzle-orm";
import fs from "node:fs";
import { db } from "@/lib/db";
import { entries } from "@/lib/db/schema";
import { calculateWritingStats, searchJournalDocuments, selectRandomMemory, type JournalDocument } from "./insight-calculations";
import { discoverEntries } from "./discovery";
import type { RandomMemoryScope } from "../journal-insight-types";

function journalDocuments(): JournalDocument[] {
  discoverEntries();
  return db().select({ date: entries.date, path: entries.path }).from(entries).orderBy(desc(entries.date)).all().flatMap((row) =>
    fs.existsSync(row.path) ? [{ date: row.date, content: fs.readFileSync(row.path, "utf8") }] : [],
  );
}

export function writingStats(month: string) {
  return calculateWritingStats(journalDocuments(), month);
}

export function searchEntries(query: string, limit = 8) {
  return searchJournalDocuments(journalDocuments(), query, limit);
}

export function randomMemory(date: string, scope: RandomMemoryScope) {
  return selectRandomMemory(journalDocuments(), date, scope);
}
