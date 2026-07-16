import { dataDir } from "@/lib/db";
import { settings } from "./settings";
import { resolveEntryPath } from "./path-format";

export function entryPath(date: string) {
  return resolveEntryPath(dataDir, date, settings().saveFormat);
}
