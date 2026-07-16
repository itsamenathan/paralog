import { desc } from "drizzle-orm";
import fs from "node:fs";
import { db } from "@/lib/db";
import { entries } from "@/lib/db/schema";
import { markdownBody } from "@/lib/front-matter";
import { journalReferences, type JournalReference } from "@/lib/markdown-references";
import { discoverEntries } from "./discovery";

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

function entryReferences(content: string) {
  const searchable = withoutFencedCode(markdownBody(content))
    .replace(/`[^`\n]*`/g, " ")
    .replace(/!?\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/https?:\/\/\S+/g, " ");
  const found = { tag: new Map<string, string>(), person: new Map<string, string>() };
  for (const reference of journalReferences(searchable)) {
    const key = reference.label.normalize("NFC").toLocaleLowerCase();
    if (!found[reference.kind].has(key)) found[reference.kind].set(key, reference.label);
  }
  return found;
}

export function references() {
  discoverEntries();
  const rows = db().select({ date: entries.date, path: entries.path }).from(entries).orderBy(desc(entries.date)).all();
  const clouds = {
    tag: new Map<string, { name: string; dates: string[] }>(),
    person: new Map<string, { name: string; dates: string[] }>(),
  };
  for (const row of rows) {
    if (!fs.existsSync(row.path)) continue;
    const found = entryReferences(fs.readFileSync(row.path, "utf8"));
    for (const kind of ["tag", "person"] as const) {
      for (const [key, label] of found[kind]) {
        const reference = clouds[kind].get(key) ?? { name: label, dates: [] };
        reference.dates.push(row.date);
        clouds[kind].set(key, reference);
      }
    }
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
  discoverEntries();
  const rows = db().select({ date: entries.date, path: entries.path }).from(entries).orderBy(desc(entries.date)).all();
  return rows.flatMap((row) => {
    if (!fs.existsSync(row.path)) return [];
    const content = fs.readFileSync(row.path, "utf8");
    if (!entryReferences(content)[kind].has(key)) return [];
    const body = markdownBody(content);
    return [{ date: row.date, excerpt: excerpt(content), words: body.trim() ? body.trim().split(/\s+/).length : 0 }];
  });
}

export function entriesTagged(tag: string) { return entriesWithReference(tag, "tag"); }
export function entriesMentioning(person: string) { return entriesWithReference(person, "person"); }
