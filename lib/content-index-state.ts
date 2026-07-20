export type EntryContentScanState = {
  entryPath: string;
  entryUpdatedAt: string;
  entrySize: number;
  indexVersion: number;
};

export type EntryFileState = {
  entryPath: string;
  entryUpdatedAt: string;
  entrySize: number;
};

export function entryNeedsContentIndex(scan: EntryContentScanState | undefined, file: EntryFileState, indexVersion: number, force = false) {
  return force
    || !scan
    || scan.entryPath !== file.entryPath
    || scan.entryUpdatedAt !== file.entryUpdatedAt
    || scan.entrySize !== file.entrySize
    || scan.indexVersion !== indexVersion;
}
