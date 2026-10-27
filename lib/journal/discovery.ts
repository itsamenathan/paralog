import fs from "node:fs";
import path from "node:path";
import { dataDir, db } from "@/lib/db";
import { inArray } from "drizzle-orm";
import { entries } from "@/lib/db/schema";
import { entryFileDate, preferredEntryFile, type EntryFileCandidate } from "@/lib/entry-files";

export function discoverEntries() {
  const found = new Map<string, Array<EntryFileCandidate & { updatedAt: string }>>();
  const walk = (directory: string) => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      // Hidden folders hold tooling rather than writing (.git, .obsidian, .Trash).
      if (item.name.startsWith(".") || item.name === "attachments" || item.name === "journal.db" || item.name.startsWith("journal.db-")) continue;
      const file = path.join(directory, item.name);
      if (item.isDirectory()) walk(file);
      else if (item.isFile()) {
        const date = entryFileDate(item.name);
        if (!date) continue;
        const stat = fs.statSync(file);
        const candidates = found.get(date) || [];
        candidates.push({ path: file, mtimeMs: stat.mtimeMs, updatedAt: stat.mtime.toISOString() });
        found.set(date, candidates);
      }
    }
  };
  walk(dataDir);
  db().transaction((transaction) => {
    for (const [date, candidates] of found) {
      const { path: file, updatedAt } = preferredEntryFile(candidates)!;
      transaction.insert(entries).values({ date, path: file, updatedAt }).onConflictDoUpdate({
        target: entries.date,
        set: { path: file, updatedAt },
      }).run();
    }
    // A date whose file is gone, or was never an entry, leaves the index; its
    // revisions are kept by date and return if the entry does.
    const stale = transaction.select({ date: entries.date }).from(entries).all().map((row) => row.date).filter((date) => !found.has(date));
    for (let index = 0; index < stale.length; index += 500) {
      transaction.delete(entries).where(inArray(entries.date, stale.slice(index, index + 500))).run();
    }
  });
}
