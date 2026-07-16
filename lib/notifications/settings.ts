import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notificationConfig } from "@/lib/db/schema";
import type { NotificationSchedule } from "./types";

const DEFAULT_SCHEDULE: NotificationSchedule = {
  id: "default-evening",
  enabled: false,
  time: "22:00",
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  rule: "always",
  title: "Time to journal",
  body: "Add a thought to today’s entry.",
};

export function notificationConfigValue(key: string) {
  return db().select({ value: notificationConfig.value }).from(notificationConfig).where(eq(notificationConfig.key, key)).get()?.value;
}

export function setNotificationConfig(key: string, value: string) {
  db().insert(notificationConfig).values({ key, value }).onConflictDoUpdate({ target: notificationConfig.key, set: { value } }).run();
}

function validTimezone(value: string) {
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

export function notificationSettings() {
  const timezone = notificationConfigValue("timezone") || "UTC";
  let schedules: NotificationSchedule[] = [DEFAULT_SCHEDULE];
  try {
    const stored = notificationConfigValue("schedules");
    if (stored) schedules = JSON.parse(stored).map(cleanSchedule);
  } catch {
    schedules = [DEFAULT_SCHEDULE];
  }
  return { notificationTimezone: timezone, notificationSchedules: schedules };
}

export function updateNotificationSettings(values: { notificationTimezone?: unknown; notificationSchedules?: unknown }) {
  if (values.notificationTimezone !== undefined) {
    if (typeof values.notificationTimezone !== "string" || !validTimezone(values.notificationTimezone)) throw new Error("Choose a valid timezone.");
    setNotificationConfig("timezone", values.notificationTimezone);
  }
  if (values.notificationSchedules !== undefined) {
    if (!Array.isArray(values.notificationSchedules) || values.notificationSchedules.length > 10) throw new Error("You can configure up to 10 reminders.");
    const schedules = values.notificationSchedules.map(cleanSchedule);
    if (new Set(schedules.map((schedule) => schedule.id)).size !== schedules.length) throw new Error("Reminder IDs must be unique.");
    setNotificationConfig("schedules", JSON.stringify(schedules));
  }
  return notificationSettings();
}
