import { and, desc, eq } from "drizzle-orm";
import fs from "node:fs";
import { db } from "@/lib/db";
import { entries, journalReferencesTable } from "@/lib/db/schema";
import { markdownBody } from "@/lib/front-matter";
import type { JournalReference } from "@/lib/markdown-references";
import { syncEntryContentIndex } from "./content-index";

export function references() {
  syncEntryContentIndex();
  const rows = db().select().from(journalReferencesTable).orderBy(desc(journalReferencesTable.entryDate)).all();
  const clouds = {
    tag: new Map<string, { name: string; dates: string[] }>(),
    person: new Map<string, { name: string; dates: string[] }>(),
  };
  for (const row of rows) {
    const kind = row.kind as JournalReference["kind"];
    const reference = clouds[kind].get(row.normalizedName) ?? { name: row.displayName, dates: [] };
    reference.dates.push(row.entryDate);
    clouds[kind].set(row.normalizedName, reference);
  }
  const summarize = (cloud: Map<string, { name: string; dates: string[] }>) => [...cloud.values()]
    .map((reference) => ({ ...reference, count: reference.dates.length }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { tags: summarize(clouds.tag), people: summarize(clouds.person) };
}

export function tags() { return references().tags; }
export function people() { return references().people; }

function excerpt(content: string) {
  return markdownBody(content)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^[#>*_`~-]+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function entriesWithReference(value: string, kind: JournalReference["kind"]) {
  const key = value.normalize("NFC").toLocaleLowerCase();
  if (!/^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(key)) return [];
  syncEntryContentIndex();
  const rows = db().select({ date: entries.date, path: entries.path })
    .from(journalReferencesTable)
    .innerJoin(entries, eq(journalReferencesTable.entryDate, entries.date))
    .where(and(eq(journalReferencesTable.kind, kind), eq(journalReferencesTable.normalizedName, key)))
    .orderBy(desc(entries.date)).all();
  return rows.flatMap((row) => {
    if (!fs.existsSync(row.path)) return [];
    const content = fs.readFileSync(row.path, "utf8");
    const body = markdownBody(content);
    return [{ date: row.date, excerpt: excerpt(content), words: body.trim() ? body.trim().split(/\s+/).length : 0 }];
  });
}

export function entriesTagged(tag: string) { return entriesWithReference(tag, "tag"); }
export function entriesMentioning(person: string) { return entriesWithReference(person, "person"); }
