import { and, desc, eq } from "drizzle-orm";
import fs from "node:fs";
import { db } from "@/lib/db";
import { revisions } from "@/lib/db/schema";
import { markdownBody } from "@/lib/front-matter";
import { entryPath } from "./paths";
import { revisionChanges } from "./revision-diff";

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
