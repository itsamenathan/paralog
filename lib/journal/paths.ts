import path from "node:path";
import { dataDir } from "@/lib/db";
import { settings } from "./settings";

function dateParts(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const local = new Date(year, month - 1, day);
  return {
    YYYY: String(year),
    YY: String(year).slice(-2),
    MM: String(month).padStart(2, "0"),
    M: String(month),
    DD: String(day).padStart(2, "0"),
    D: String(day),
    MMMM: new Intl.DateTimeFormat("en-US", { month: "long" }).format(local),
    MMM: new Intl.DateTimeFormat("en-US", { month: "short" }).format(local),
    dddd: new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(local),
    ddd: new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(local),
  };
}

export function entryPath(date: string) {
  const tokens = dateParts(date);
  const rendered = settings().saveFormat.replace(/YYYY|MMMM|MMM|MM|M|DD|D|dddd|ddd|YY/g, (token) => tokens[token as keyof typeof tokens]);
  const resolved = path.resolve(dataDir, rendered);
  if (!resolved.startsWith(`${path.resolve(dataDir)}${path.sep}`)) throw new Error("Invalid save format.");
  return resolved;
}
