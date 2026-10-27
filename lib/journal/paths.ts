import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { dataDir, db } from "@/lib/db";
import { entries } from "@/lib/db/schema";
import { settings } from "./settings";
import { resolveEntryPath } from "./path-format";
import { discoverEntries } from "./discovery";

export function entryPath(date: string) {
  return resolveEntryPath(dataDir, date, settings().saveFormat);
}

function indexedEntryFile(date: string) {
  const indexed = db().select({ path: entries.path }).from(entries).where(eq(entries.date, date)).get()?.path;
  if (!indexed || !fs.existsSync(indexed)) return null;
  const root = path.resolve(dataDir);
  return path.resolve(indexed).startsWith(`${root}${path.sep}`) ? indexed : null;
}

// The file that holds a date's entry today. Only entries without a file yet are
// placed with the configured save format, so editing a day keeps writing to the
// file it was read from instead of starting a second copy beside it.
export function currentEntryPath(date: string) {
  const indexed = indexedEntryFile(date);
  if (indexed) return indexed;
  discoverEntries();
  return indexedEntryFile(date) || entryPath(date);
}
