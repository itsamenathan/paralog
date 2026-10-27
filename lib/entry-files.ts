export type EntryFileCandidate = { path: string; mtimeMs: number };

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
