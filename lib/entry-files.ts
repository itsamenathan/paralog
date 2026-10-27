export type EntryFileCandidate = { path: string; mtimeMs: number };

// The date an entry file holds, read from its name. Hidden files are never
// entries: macOS writes an AppleDouble companion such as
// `._2016-10-22-Saturday.md` beside each file it copies, holding Finder
// metadata under the same date-bearing name.
export function entryFileDate(name: string) {
  if (name.startsWith(".") || !name.endsWith(".md")) return null;
  return name.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
}

// Several Markdown files can carry the same date, for example after the save
// format changes or when a file is copied into the data directory by hand. The
// most recently written one holds the newest writing; the path breaks ties so
// every scan picks the same file regardless of directory walk order.
export function preferredEntryFile<T extends EntryFileCandidate>(candidates: T[]) {
  return candidates.reduce<T | undefined>((best, candidate) => {
    if (!best || candidate.mtimeMs > best.mtimeMs) return candidate;
    if (candidate.mtimeMs === best.mtimeMs && candidate.path < best.path) return candidate;
    return best;
  }, undefined);
}
