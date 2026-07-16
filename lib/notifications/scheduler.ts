import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notificationDeliveries, notificationSuppressions, pushSubscriptions } from "@/lib/db/schema";
import { getEntry } from "@/lib/journal/entries";
import { sendPush } from "./push";
import { notificationSettings } from "./settings";
import type { NotificationSchedule } from "./types";

const weekdayIndexes: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function localClock(now: Date, timezone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: weekdayIndexes[parts.weekday],
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function notificationDue(schedule: NotificationSchedule, clock: ReturnType<typeof localClock>) {
  if (!schedule.enabled || !schedule.weekdays.includes(clock.weekday)) return false;
  const [hour, minute] = schedule.time.split(":").map(Number);
  const elapsed = clock.minutes - (hour * 60 + minute);
  return elapsed >= 0 && elapsed <= 60;
}

export async function runNotificationScheduler(now = new Date()) {
  const { notificationTimezone, notificationSchedules } = notificationSettings();
  const clock = localClock(now, notificationTimezone);
  const subscriptions = db().select({ endpoint: pushSubscriptions.endpoint, p256dh: pushSubscriptions.p256dh, auth: pushSubscriptions.auth }).from(pushSubscriptions).all();
  for (const schedule of notificationSchedules) {
    if (!notificationDue(schedule, clock)) continue;
    const suppressed = db().select({ scheduleId: notificationSuppressions.scheduleId }).from(notificationSuppressions).where(and(eq(notificationSuppressions.scheduleId, schedule.id), eq(notificationSuppressions.localDate, clock.date))).get();
    if (suppressed) continue;
    if (schedule.rule === "empty" && getEntry(clock.date).content.trim()) {
      db().insert(notificationSuppressions).values({ scheduleId: schedule.id, localDate: clock.date, checkedAt: now.toISOString() }).onConflictDoNothing().run();
      continue;
    }
    for (const row of subscriptions) {
      const delivered = db().select({ scheduleId: notificationDeliveries.scheduleId }).from(notificationDeliveries).where(and(eq(notificationDeliveries.scheduleId, schedule.id), eq(notificationDeliveries.localDate, clock.date), eq(notificationDeliveries.endpoint, row.endpoint))).get();
      if (delivered) continue;
      try {
        await sendPush({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, {
          title: schedule.title,
          body: schedule.body,
          url: `/?date=${clock.date}`,
          tag: `paralog-${schedule.id}-${clock.date}`,
        });
        db().insert(notificationDeliveries).values({ scheduleId: schedule.id, localDate: clock.date, endpoint: row.endpoint, sentAt: new Date().toISOString() }).onConflictDoNothing().run();
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) db().delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, row.endpoint)).run();
        else console.error("Paralog reminder delivery failed", error);
      }
    }
  }
}

export function startNotificationScheduler() {
  const state = globalThis as typeof globalThis & { __paralogNotificationScheduler?: ReturnType<typeof setInterval> };
  if (state.__paralogNotificationScheduler) return;
  void runNotificationScheduler().catch((error) => console.error("Paralog reminder scheduler failed", error));
  state.__paralogNotificationScheduler = setInterval(() => {
    void runNotificationScheduler().catch((error) => console.error("Paralog reminder scheduler failed", error));
  }, 60_000);
}
