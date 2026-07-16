import type { NotificationSchedule } from "./types";

export function validTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function cleanSchedule(value: unknown): NotificationSchedule {
  if (!value || typeof value !== "object") throw new Error("Each reminder must be an object.");
  const item = value as Partial<NotificationSchedule>;
  if (typeof item.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(item.id)) throw new Error("Each reminder needs a valid ID.");
  if (typeof item.enabled !== "boolean") throw new Error("Each reminder needs an enabled state.");
  if (typeof item.time !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item.time)) throw new Error("Reminder time must use HH:mm.");
  if (!Array.isArray(item.weekdays) || item.weekdays.length === 0 || item.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error("Choose at least one valid weekday.");
  if (item.rule !== "always" && item.rule !== "empty") throw new Error("Choose a valid reminder rule.");
  const title = typeof item.title === "string" ? item.title.trim() : "";
  const body = typeof item.body === "string" ? item.body.trim() : "";
  if (!title || title.length > 80) throw new Error("Reminder titles must be 1–80 characters.");
  if (!body || body.length > 200) throw new Error("Reminder messages must be 1–200 characters.");
  return { id: item.id, enabled: item.enabled, time: item.time, weekdays: [...new Set(item.weekdays)].sort(), rule: item.rule, title, body };
}
