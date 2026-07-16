import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/db";

export function saveUpload(file: File) {
  const safeName = path.basename(file.name).replace(/[^a-zA-Z0-9._-]/g, "-") || "attachment";
  const now = new Date();
  const relativePath = path.join("attachments", String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, "0"), `${crypto.randomUUID()}-${safeName}`);
  const destination = path.join(dataDir, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  return file.arrayBuffer().then((buffer) => {
    fs.writeFileSync(destination, Buffer.from(buffer));
    return { name: file.name, path: relativePath.replaceAll(path.sep, "/"), type: file.type };
  });
}

export function uploadPath(relativePath: string) {
  const target = path.resolve(dataDir, relativePath);
  return target.startsWith(`${path.resolve(dataDir)}${path.sep}`) ? target : null;
}
