import path from "node:path";

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

export function validateSaveFormat(format: string) {
  if (!format.includes("YYYY") || !format.includes("MM") || !format.includes("DD") || format.includes("..") || path.isAbsolute(format)) {
    throw new Error("Save format must be a relative path containing YYYY, MM, and DD.");
  }
  return format;
}

export function renderEntryPath(date: string, format: string) {
  const tokens = dateParts(date);
  return format.replace(/YYYY|MMMM|MMM|MM|M|DD|D|dddd|ddd|YY/g, (token) => tokens[token as keyof typeof tokens]);
}

export function resolveEntryPath(root: string, date: string, format: string) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, renderEntryPath(date, format));
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error("Invalid save format.");
  return resolved;
}
