import fs from "node:fs";
import path from "node:path";
import { dataDir, db } from "@/lib/db";
import { entries } from "@/lib/db/schema";

export function discoverEntries() {
  const walk = (directory: string) => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      if (item.name === "attachments" || item.name === "journal.db" || item.name.startsWith("journal.db-")) continue;
      const file = path.join(directory, item.name);
      if (item.isDirectory()) walk(file);
      else if (item.isFile() && item.name.endsWith(".md")) {
        const date = item.name.match(/(\d{4}-\d{2}-\d{2})/)?.[1];
        if (!date) continue;
        const updatedAt = fs.statSync(file).mtime.toISOString();
        db().insert(entries).values({ date, path: file, updatedAt }).onConflictDoUpdate({
          target: entries.date,
          set: { path: file, updatedAt },
        }).run();
      }
    }
  };
  walk(dataDir);
}
