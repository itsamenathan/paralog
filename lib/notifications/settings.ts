import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notificationConfig } from "@/lib/db/schema";
import type { NotificationSchedule } from "./types";
import { cleanSchedule, validTimezone } from "./validation";

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
