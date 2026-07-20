import path from "node:path";

export function normalizeAttachmentPath(value: string) {
  if (!value || value.includes("\0") || value.includes("\\") || path.posix.isAbsolute(value)) return null;
  const rawParts = value.split("/");
  if (rawParts.some((part) => part === ".." || part === "." || !part)) return null;
  const normalized = path.posix.normalize(value);
  if (!normalized.startsWith("attachments/") || normalized === "attachments" || normalized.includes("/.cache/") || normalized.endsWith("/.cache")) return null;
  return normalized;
}

export function attachmentPathFromUrl(rawUrl: string) {
  let value = rawUrl.trim();
  if (value.startsWith("<") && value.endsWith(">")) value = value.slice(1, -1);
  try {
    const url = new URL(value, "http://paralog.local");
    if (url.origin !== "http://paralog.local") return null;
    if (url.pathname === "/api/files") value = url.searchParams.get("path") || "";
    else if (url.pathname.startsWith("/attachments/")) value = url.pathname.slice(1);
    else if (value.startsWith("attachments/")) value = value.split(/[?#]/, 1)[0];
    else return null;
    value = decodeURIComponent(value);
  } catch {
    return null;
  }
  return normalizeAttachmentPath(value);
}

function markdownWithoutCode(markdown: string) {
  let fenced = false;
  return markdown.split("\n").map((line) => {
    if (/^\s*(`{3,}|~{3,})/.test(line)) { fenced = !fenced; return ""; }
    return fenced ? "" : line.replace(/`[^`\n]*`/g, "");
  }).join("\n");
}

export function attachmentReferencesInMarkdown(markdown: string) {
  const content = markdownWithoutCode(markdown);
  const counts = new Map<string, number>();
  const add = (url: string | undefined) => {
    if (!url) return;
    const attachmentPath = attachmentPathFromUrl(url);
    if (attachmentPath) counts.set(attachmentPath, (counts.get(attachmentPath) || 0) + 1);
  };
  for (const match of content.matchAll(/!?\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|([^\s)]+))/g)) add(match[1] || match[2]);
  for (const match of content.matchAll(/^\s*\[[^\]\n]+\]:\s*(?:<([^>\n]+)>|(\S+))/gm)) add(match[1] || match[2]);
  return counts;
}
