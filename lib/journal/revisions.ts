import { and, desc, eq } from "drizzle-orm";
import fs from "node:fs";
import { diffLines } from "diff";
import { db } from "@/lib/db";
import { revisions } from "@/lib/db/schema";
import { markdownBody } from "@/lib/front-matter";
import { entryPath } from "./paths";

type RevisionDiffLine = { type: "added" | "removed" | "context" | "skip"; text: string; count?: number };

function revisionChanges(before: string, after: string) {
  const changes = diffLines(before, after, { timeout: 100 }) ?? [
    { value: before, added: false, removed: true, count: before.split("\n").length },
    { value: after, added: true, removed: false, count: after.split("\n").length },
  ];
  const lines: RevisionDiffLine[] = [];
  let additions = 0;
  let deletions = 0;
  changes.forEach((change, index) => {
    const values = change.value.split("\n");
    if (values.at(-1) === "") values.pop();
    if (change.added) additions += values.length;
    if (change.removed) deletions += values.length;
    if (change.added || change.removed || values.length <= 4) {
      const type = change.added ? "added" : change.removed ? "removed" : "context";
      lines.push(...values.map((text) => ({ type, text }) as RevisionDiffLine));
      return;
    }
    const leading = index === 0 ? [] : values.slice(0, 2);
    const trailing = index === changes.length - 1 ? [] : values.slice(-2);
    lines.push(...leading.map((text) => ({ type: "context" as const, text })));
    lines.push({ type: "skip", text: "", count: values.length - leading.length - trailing.length });
    lines.push(...trailing.map((text) => ({ type: "context" as const, text })));
  });
  return { additions, deletions, lines };
}

export function revisionsForDate(date: string) {
  const stored = db().select({ id: revisions.id, content: revisions.content, createdAt: revisions.createdAt }).from(revisions).where(eq(revisions.date, date)).orderBy(desc(revisions.id)).limit(50).all();
  const currentPath = entryPath(date);
  let nextContent = fs.existsSync(currentPath) ? fs.readFileSync(currentPath, "utf8") : "";
  return stored.map((revision) => {
    const diff = revisionChanges(revision.content, nextContent);
    nextContent = revision.content;
    const body = markdownBody(revision.content).trim();
    return { id: revision.id, createdAt: revision.createdAt, words: body ? body.split(/\s+/).length : 0, diff };
  });
}

export function revisionForDate(date: string, id: number) {
  return db().select({ id: revisions.id, content: revisions.content, createdAt: revisions.createdAt }).from(revisions).where(and(eq(revisions.date, date), eq(revisions.id, id))).get();
}
