import { markdownBody } from "./front-matter.ts";
import { journalReferences, type JournalReference } from "./markdown-references.ts";

export type IndexedJournalReference = {
  kind: JournalReference["kind"];
  normalizedName: string;
  displayName: string;
  occurrences: number;
};

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

export function indexedJournalReferences(content: string): IndexedJournalReference[] {
  const searchable = withoutFencedCode(markdownBody(content))
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<([A-Za-z][\w:-]*)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/!?\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/!?\[[^\]]*\]\[[^\]]*\]/g, " ")
    .replace(/^\s*\[[^\]\n]+\]:\s*\S+.*$/gm, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/https?:\/\/\S+/g, " ");
  const found = new Map<string, IndexedJournalReference>();
  for (const reference of journalReferences(searchable)) {
    const normalizedName = reference.label.normalize("NFC").toLocaleLowerCase();
    const key = `${reference.kind}:${normalizedName}`;
    const existing = found.get(key);
    if (existing) existing.occurrences += 1;
    else found.set(key, { kind: reference.kind, normalizedName, displayName: reference.label, occurrences: 1 });
  }
  return [...found.values()];
}
