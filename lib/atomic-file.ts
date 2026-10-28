import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Replaces a file so that a crash, a full disk, or a reader mid-write sees the
// old contents or the new ones, never a truncated mix. The temporary file is
// hidden and lives beside the target so the rename stays on one filesystem and
// discovery never mistakes it for an entry.
export function writeFileAtomic(filePath: string, content: string) {
  // Writing through a symlink keeps the link and replaces what it points at.
  const target = fs.existsSync(filePath) ? fs.realpathSync(filePath) : filePath;
  const existing = fs.existsSync(target) ? fs.statSync(target) : null;
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomUUID()}.tmp`);
  try {
    const descriptor = fs.openSync(temporary, "wx", existing ? existing.mode & 0o7777 : 0o666);
    try {
      fs.writeFileSync(descriptor, content, "utf8");
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
