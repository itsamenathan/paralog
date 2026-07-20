import fs from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/db";
import { normalizeAttachmentPath } from "@/lib/attachment-references";

export const attachmentsDir = path.resolve(dataDir, "attachments");
export const thumbnailDir = path.join(attachmentsDir, ".cache", "thumbnails");

export function ensureAttachmentsDir() {
  fs.mkdirSync(attachmentsDir, { recursive: true });
  return fs.realpathSync(attachmentsDir);
}

export { normalizeAttachmentPath } from "@/lib/attachment-references";

export function resolveAttachmentPath(value: string) {
  const normalized = normalizeAttachmentPath(value);
  if (!normalized) return null;
  const root = ensureAttachmentsDir();
  const target = path.resolve(dataDir, ...normalized.split("/"));
  if (!target.startsWith(`${root}${path.sep}`) || !fs.existsSync(target)) return null;
  const realTarget = fs.realpathSync(target);
  return realTarget.startsWith(`${root}${path.sep}`) ? realTarget : null;
}

export function attachmentRelativePath(filePath: string) {
  return path.relative(dataDir, filePath).split(path.sep).join("/");
}
