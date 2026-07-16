import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notificationDeliveries, notificationSuppressions, pushSubscriptions } from "@/lib/db/schema";
import { getEntry } from "@/lib/journal/entries";
import { sendPush } from "./push";
import { notificationSettings } from "./settings";
import { localClock, notificationDue } from "./clock";

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
