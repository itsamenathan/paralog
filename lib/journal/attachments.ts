import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { AttachmentKind, AttachmentListResponse, AttachmentReference, AttachmentSummary } from "@/lib/attachment-types";
import { db } from "@/lib/db";
import { attachmentReferences, attachments, revisions } from "@/lib/db/schema";
import { attachmentReferencesInMarkdown } from "@/lib/attachment-references";
import { attachmentRelativePath, attachmentsDir, ensureAttachmentsDir, normalizeAttachmentPath, resolveAttachmentPath, thumbnailDir } from "./attachment-paths";
import { syncEntryContentIndex } from "./content-index";

const MIME_TYPES: Record<string, string> = {
  avif: "image/avif", gif: "image/gif", jpeg: "image/jpeg", jpg: "image/jpeg", png: "image/png", webp: "image/webp", svg: "image/svg+xml",
  pdf: "application/pdf", txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json", zip: "application/zip",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
const PREVIEW_IMAGES = new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]);
const UUID_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-/i;

export function attachmentMediaType(filePath: string) {
  return MIME_TYPES[path.extname(filePath).slice(1).toLowerCase()] || "application/octet-stream";
}

export function attachmentKind(mediaType: string): AttachmentKind {
  return PREVIEW_IMAGES.has(mediaType) ? "image" : "document";
}

function displayNameFor(relativePath: string) {
  return path.posix.basename(relativePath).replace(UUID_PREFIX, "");
}

function summary(row: typeof attachments.$inferSelect, referencesForPath: AttachmentReference[] = []): AttachmentSummary {
  const encoded = encodeURIComponent(row.path);
  return {
    path: row.path,
    displayName: row.displayName,
    mediaType: row.mediaType,
    kind: row.kind as AttachmentKind,
    size: row.size,
    addedAt: row.addedAt,
    modifiedAt: row.modifiedAt,
    fileUrl: `/api/files?path=${encoded}`,
    thumbnailUrl: row.kind === "image" ? `/api/attachments/thumbnail?path=${encoded}` : null,
    references: referencesForPath,
    missing: false,
  };
}

function walkAttachments(directory: string, found: Set<string>) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    if (item.name.startsWith(".") || item.isSymbolicLink()) continue;
    const filePath = path.join(directory, item.name);
    if (item.isDirectory()) walkAttachments(filePath, found);
    else if (item.isFile() && !item.name.endsWith(".part")) found.add(attachmentRelativePath(filePath));
  }
}

export function discoverAttachments() {
  ensureAttachmentsDir();
  const found = new Set<string>();
  walkAttachments(attachmentsDir, found);
  const existing = new Map(db().select().from(attachments).all().map((row) => [row.path, row]));
  const indexedAt = new Date().toISOString();
  for (const relativePath of found) {
    const filePath = resolveAttachmentPath(relativePath);
    if (!filePath) continue;
    const stat = fs.statSync(filePath);
    const previous = existing.get(relativePath);
    const mediaType = attachmentMediaType(relativePath);
    db().insert(attachments).values({
      path: relativePath,
      displayName: previous?.displayName || displayNameFor(relativePath),
      mediaType,
      kind: attachmentKind(mediaType),
      size: stat.size,
      addedAt: previous?.addedAt || (stat.birthtimeMs > 0 ? stat.birthtime : stat.mtime).toISOString(),
      modifiedAt: stat.mtime.toISOString(),
      indexedAt,
    }).onConflictDoUpdate({ target: attachments.path, set: {
      mediaType, kind: attachmentKind(mediaType), size: stat.size, modifiedAt: stat.mtime.toISOString(), indexedAt,
    } }).run();
  }
  let removed = 0;
  for (const relativePath of existing.keys()) {
    if (!found.has(relativePath)) {
      db().delete(attachments).where(eq(attachments.path, relativePath)).run();
      removed += 1;
    }
  }
  return { files: found.size, removed };
}

function referenceMap() {
  const result = new Map<string, AttachmentReference[]>();
  for (const row of db().select().from(attachmentReferences).all()) {
    const values = result.get(row.attachmentPath) || [];
    values.push({ date: row.entryDate, occurrences: row.occurrences });
    result.set(row.attachmentPath, values);
  }
  for (const values of result.values()) values.sort((a, b) => b.date.localeCompare(a.date));
  return result;
}

export type AttachmentQuery = {
  q?: string; kind?: "all" | AttachmentKind; status?: "all" | "linked" | "unlinked" | "missing";
  entry?: string; from?: string; to?: string; sort?: "added-desc" | "added-asc" | "name-asc" | "size-desc";
  cursor?: string; limit?: number;
};

export function listAttachments(query: AttachmentQuery = {}): AttachmentListResponse {
  discoverAttachments();
  syncEntryContentIndex();
  const refs = referenceMap();
  const rows = db().select().from(attachments).all();
  const paths = new Set(rows.map((row) => row.path));
  const allItems: AttachmentSummary[] = rows.map((row) => summary(row, refs.get(row.path) || []));
  for (const [missingPath, referencesForPath] of refs) {
    if (paths.has(missingPath)) continue;
    allItems.push({
      path: missingPath, displayName: displayNameFor(missingPath), mediaType: attachmentMediaType(missingPath),
      kind: attachmentKind(attachmentMediaType(missingPath)), size: 0, addedAt: "", modifiedAt: "", fileUrl: "", thumbnailUrl: null,
      references: referencesForPath, missing: true,
    });
  }
  const present = allItems.filter((item) => !item.missing);
  const totals = {
    files: present.length,
    images: present.filter((item) => item.kind === "image").length,
    documents: present.filter((item) => item.kind === "document").length,
    linked: present.filter((item) => item.references.length > 0).length,
    unlinked: present.filter((item) => item.references.length === 0).length,
    missing: allItems.filter((item) => item.missing).length,
    bytes: present.reduce((sum, item) => sum + item.size, 0),
  };
  const needle = query.q?.normalize("NFC").toLocaleLowerCase() || "";
  const filtered = allItems.filter((item) => {
    if (needle && !item.displayName.normalize("NFC").toLocaleLowerCase().includes(needle) && !item.path.toLocaleLowerCase().includes(needle)) return false;
    if (query.kind && query.kind !== "all" && item.kind !== query.kind) return false;
    if (query.status === "linked" && (item.missing || item.references.length === 0)) return false;
    if (query.status === "unlinked" && (item.missing || item.references.length > 0)) return false;
    if (query.status === "missing" && !item.missing) return false;
    if (query.entry && !item.references.some((reference) => reference.date === query.entry)) return false;
    if (query.from && item.addedAt && item.addedAt.slice(0, 10) < query.from) return false;
    if (query.to && item.addedAt && item.addedAt.slice(0, 10) > query.to) return false;
    return true;
  });
  const sort = query.sort || "added-desc";
  filtered.sort((a, b) => {
    if (sort === "added-asc") return a.addedAt.localeCompare(b.addedAt) || a.path.localeCompare(b.path);
    if (sort === "name-asc") return a.displayName.localeCompare(b.displayName) || a.path.localeCompare(b.path);
    if (sort === "size-desc") return b.size - a.size || a.path.localeCompare(b.path);
    return b.addedAt.localeCompare(a.addedAt) || a.path.localeCompare(b.path);
  });
  let offset = 0;
  if (query.cursor) {
    try { offset = Number.parseInt(Buffer.from(query.cursor, "base64url").toString("utf8"), 10) || 0; } catch { offset = 0; }
  }
  const limit = Math.min(Math.max(query.limit || 48, 1), 100);
  const items = filtered.slice(offset, offset + limit);
  return { items, nextCursor: offset + limit < filtered.length ? Buffer.from(String(offset + limit)).toString("base64url") : null, total: filtered.length, totals };
}

export async function saveAttachment(file: File) {
  const safeName = path.basename(file.name).replace(/[^a-zA-Z0-9._-]/g, "-") || "attachment";
  const now = new Date();
  const directory = path.join(attachmentsDir, String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, "0"));
  ensureAttachmentsDir();
  fs.mkdirSync(directory, { recursive: true });
  const root = fs.realpathSync(attachmentsDir);
  if (!fs.realpathSync(directory).startsWith(`${root}${path.sep}`)) throw new Error("Unsafe attachment destination");
  const filename = `${crypto.randomUUID()}-${safeName}`;
  const destination = path.join(directory, filename);
  const temporary = `${destination}.${crypto.randomUUID()}.part`;
  try {
    fs.writeFileSync(temporary, Buffer.from(await file.arrayBuffer()), { flag: "wx" });
    fs.renameSync(temporary, destination);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  const relativePath = attachmentRelativePath(destination);
  const stat = fs.statSync(destination);
  const mediaType = attachmentMediaType(relativePath);
  const row = {
    path: relativePath, displayName: file.name, mediaType, kind: attachmentKind(mediaType), size: stat.size,
    addedAt: now.toISOString(), modifiedAt: stat.mtime.toISOString(), indexedAt: now.toISOString(),
  };
  db().insert(attachments).values(row).onConflictDoUpdate({ target: attachments.path, set: row }).run();
  return summary(row);
}

export class AttachmentDeleteError extends Error {
  constructor(public code: "invalid" | "not_found" | "referenced" | "revision_warning", public details: { references?: AttachmentReference[]; revisionDates?: string[] } = {}) {
    super(code);
  }
}

function revisionDatesFor(attachmentPath: string) {
  const dates = new Set<string>();
  for (const revision of db().select({ date: revisions.date, content: revisions.content }).from(revisions).all()) {
    if (attachmentReferencesInMarkdown(revision.content).has(attachmentPath)) dates.add(revision.date);
  }
  return [...dates].sort().reverse();
}

function removeEmptyParents(filePath: string) {
  let directory = path.dirname(filePath);
  while (directory !== attachmentsDir && directory.startsWith(`${attachmentsDir}${path.sep}`)) {
    if (fs.readdirSync(directory).length > 0) break;
    fs.rmdirSync(directory);
    directory = path.dirname(directory);
  }
}

function thumbnailPrefix(attachmentPath: string) {
  return crypto.createHash("sha256").update(attachmentPath).digest("hex").slice(0, 20);
}

function clearThumbnails(attachmentPath: string) {
  if (!fs.existsSync(thumbnailDir)) return;
  const prefix = `${thumbnailPrefix(attachmentPath)}-`;
  for (const filename of fs.readdirSync(thumbnailDir)) if (filename.startsWith(prefix)) fs.unlinkSync(path.join(thumbnailDir, filename));
}

export function deleteAttachment(attachmentPath: string, acknowledgeRevisionReferences = false) {
  const normalized = normalizeAttachmentPath(attachmentPath);
  if (!normalized) throw new AttachmentDeleteError("invalid");
  discoverAttachments();
  syncEntryContentIndex();
  const filePath = resolveAttachmentPath(normalized);
  if (!filePath || !fs.statSync(filePath).isFile()) throw new AttachmentDeleteError("not_found");
  const currentReferences = db().select().from(attachmentReferences).where(eq(attachmentReferences.attachmentPath, normalized)).all()
    .map((row) => ({ date: row.entryDate, occurrences: row.occurrences }));
  if (currentReferences.length) throw new AttachmentDeleteError("referenced", { references: currentReferences });
  const revisionDates = revisionDatesFor(normalized);
  if (revisionDates.length && !acknowledgeRevisionReferences) throw new AttachmentDeleteError("revision_warning", { revisionDates });
  fs.unlinkSync(filePath);
  clearThumbnails(normalized);
  db().delete(attachments).where(eq(attachments.path, normalized)).run();
  db().delete(attachmentReferences).where(eq(attachmentReferences.attachmentPath, normalized)).run();
  removeEmptyParents(filePath);
  return { deleted: true, path: normalized };
}

export async function attachmentThumbnail(attachmentPath: string) {
  const normalized = normalizeAttachmentPath(attachmentPath);
  const filePath = normalized && resolveAttachmentPath(normalized);
  if (!normalized || !filePath) return null;
  const mediaType = attachmentMediaType(filePath);
  if (!PREVIEW_IMAGES.has(mediaType)) return null;
  const stat = fs.statSync(filePath);
  fs.mkdirSync(thumbnailDir, { recursive: true });
  const filename = `${thumbnailPrefix(normalized)}-${Math.trunc(stat.mtimeMs)}-${stat.size}.webp`;
  const destination = path.join(thumbnailDir, filename);
  if (!fs.existsSync(destination)) {
    const temporary = `${destination}.${crypto.randomUUID()}.part`;
    const sharp = (await import("sharp")).default;
    try {
      await sharp(filePath).rotate().resize(480, 360, { fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toFile(temporary);
      fs.renameSync(temporary, destination);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    clearThumbnailsExcept(normalized, filename);
  }
  return { path: destination, etag: `"${filename}"` };
}

function clearThumbnailsExcept(attachmentPath: string, keep: string) {
  const prefix = `${thumbnailPrefix(attachmentPath)}-`;
  for (const filename of fs.readdirSync(thumbnailDir)) {
    if (filename.startsWith(prefix) && filename !== keep) fs.unlinkSync(path.join(thumbnailDir, filename));
  }
}
