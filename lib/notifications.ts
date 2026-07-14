import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import webpush, { type PushSubscription } from "web-push";
import { dataDir, getEntry } from "@/lib/journal";

export type NotificationRule = "always" | "empty";
export type NotificationSchedule = {
  id: string;
  enabled: boolean;
  time: string;
  weekdays: number[];
  rule: NotificationRule;
  title: string;
  body: string;
};

const DEFAULT_SCHEDULE: NotificationSchedule = {
  id: "default-evening",
  enabled: false,
  time: "22:00",
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  rule: "always",
  title: "Time to journal",
  body: "Add a thought to today’s entry.",
};
const dbPath = path.join(dataDir, "journal.db");
let database: Database.Database | undefined;

function db() {
  if (!database) {
    fs.mkdirSync(dataDir, { recursive: true });
    database = new Database(dbPath);
    database.pragma("journal_mode = WAL");
    database.exec(`
      CREATE TABLE IF NOT EXISTS notification_config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        endpoint TEXT PRIMARY KEY,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS notification_deliveries (
        schedule_id TEXT NOT NULL,
        local_date TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        PRIMARY KEY (schedule_id, local_date, endpoint)
      );
      CREATE TABLE IF NOT EXISTS notification_suppressions (
        schedule_id TEXT NOT NULL,
        local_date TEXT NOT NULL,
        checked_at TEXT NOT NULL,
        PRIMARY KEY (schedule_id, local_date)
      );
    `);
  }
  return database;
}

function config(key: string) {
  return (db().prepare("SELECT value FROM notification_config WHERE key = ?").get(key) as { value: string } | undefined)?.value;
}

function setConfig(key: string, value: string) {
  db().prepare("INSERT INTO notification_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

function validTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function cleanSchedule(value: unknown): NotificationSchedule {
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
  const timezone = config("timezone") || "UTC";
  let schedules: NotificationSchedule[] = [DEFAULT_SCHEDULE];
  try {
    const stored = config("schedules");
    if (stored) schedules = JSON.parse(stored).map(cleanSchedule);
  } catch {
    schedules = [DEFAULT_SCHEDULE];
  }
  return { notificationTimezone: timezone, notificationSchedules: schedules };
}

export function updateNotificationSettings(values: { notificationTimezone?: unknown; notificationSchedules?: unknown }) {
  if (values.notificationTimezone !== undefined) {
    if (typeof values.notificationTimezone !== "string" || !validTimezone(values.notificationTimezone)) throw new Error("Choose a valid timezone.");
    setConfig("timezone", values.notificationTimezone);
  }
  if (values.notificationSchedules !== undefined) {
    if (!Array.isArray(values.notificationSchedules) || values.notificationSchedules.length > 10) throw new Error("You can configure up to 10 reminders.");
    const schedules = values.notificationSchedules.map(cleanSchedule);
    if (new Set(schedules.map((schedule) => schedule.id)).size !== schedules.length) throw new Error("Reminder IDs must be unique.");
    setConfig("schedules", JSON.stringify(schedules));
  }
  return notificationSettings();
}

function vapidKeys() {
  let publicKey = config("vapid_public_key");
  let privateKey = config("vapid_private_key");
  if (!publicKey || !privateKey) {
    const generated = webpush.generateVAPIDKeys();
    publicKey = generated.publicKey;
    privateKey = generated.privateKey;
    const transaction = db().transaction(() => {
      setConfig("vapid_public_key", publicKey!);
      setConfig("vapid_private_key", privateKey!);
    });
    transaction();
  }
  return { publicKey, privateKey };
}

function configureWebPush() {
  const keys = vapidKeys();
  webpush.setVapidDetails(process.env.PARALOG_VAPID_SUBJECT || "mailto:paralog@localhost", keys.publicKey, keys.privateKey);
  return keys;
}

export function notificationBootstrap() {
  const { publicKey } = configureWebPush();
  const subscriptions = (db().prepare("SELECT COUNT(*) AS count FROM push_subscriptions").get() as { count: number }).count;
  return { publicKey, subscriptions };
}

export function registerPushSubscription(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("A push subscription is required.");
  const subscription = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof subscription.endpoint !== "string" || !subscription.endpoint.startsWith("https://") || subscription.endpoint.length > 2048) throw new Error("Invalid push endpoint.");
  if (typeof subscription.keys?.p256dh !== "string" || typeof subscription.keys.auth !== "string") throw new Error("Invalid push subscription keys.");
  const now = new Date().toISOString();
  db().prepare(`INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, updated_at = excluded.updated_at`)
    .run(subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, now, now);
  return { subscribed: true };
}

export function removePushSubscription(endpoint: unknown) {
  if (typeof endpoint !== "string") throw new Error("A push endpoint is required.");
  db().prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
  return { subscribed: false };
}

function subscriptionForEndpoint(endpoint: string): PushSubscription | null {
  const row = db().prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE endpoint = ?").get(endpoint) as { endpoint: string; p256dh: string; auth: string } | undefined;
  return row ? { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } } : null;
}

async function send(subscription: PushSubscription, payload: object) {
  configureWebPush();
  await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 60 * 60, urgency: "normal" });
}

export async function sendTestNotification(endpoint: unknown, title: unknown, body: unknown) {
  if (typeof endpoint !== "string") throw new Error("Subscribe this device before sending a test.");
  const subscription = subscriptionForEndpoint(endpoint);
  if (!subscription) throw new Error("Subscribe this device before sending a test.");
  const cleanTitle = typeof title === "string" && title.trim() ? title.trim().slice(0, 80) : "Paralog notifications are ready";
  const cleanBody = typeof body === "string" && body.trim() ? body.trim().slice(0, 200) : "Your journal reminders will appear here.";
  await send(subscription, { title: cleanTitle, body: cleanBody, url: "/", tag: `paralog-test-${Date.now()}` });
  return { sent: true };
}

const weekdayIndexes: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function localClock(now: Date, timezone: string) {
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

function due(schedule: NotificationSchedule, clock: ReturnType<typeof localClock>) {
  if (!schedule.enabled || !schedule.weekdays.includes(clock.weekday)) return false;
  const [hour, minute] = schedule.time.split(":").map(Number);
  const elapsed = clock.minutes - (hour * 60 + minute);
  return elapsed >= 0 && elapsed <= 60;
}

export async function runNotificationScheduler(now = new Date()) {
  const { notificationTimezone, notificationSchedules } = notificationSettings();
  const clock = localClock(now, notificationTimezone);
  const subscriptions = db().prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions").all() as { endpoint: string; p256dh: string; auth: string }[];
  for (const schedule of notificationSchedules) {
    if (!due(schedule, clock)) continue;
    const suppressed = db().prepare("SELECT 1 FROM notification_suppressions WHERE schedule_id = ? AND local_date = ?").get(schedule.id, clock.date);
    if (suppressed) continue;
    if (schedule.rule === "empty" && getEntry(clock.date).content.trim()) {
      db().prepare("INSERT OR IGNORE INTO notification_suppressions (schedule_id, local_date, checked_at) VALUES (?, ?, ?)").run(schedule.id, clock.date, now.toISOString());
      continue;
    }
    for (const row of subscriptions) {
      const delivered = db().prepare("SELECT 1 FROM notification_deliveries WHERE schedule_id = ? AND local_date = ? AND endpoint = ?").get(schedule.id, clock.date, row.endpoint);
      if (delivered) continue;
      try {
        await send({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, {
          title: schedule.title,
          body: schedule.body,
          url: `/?date=${clock.date}`,
          tag: `paralog-${schedule.id}-${clock.date}`,
        });
        db().prepare("INSERT OR IGNORE INTO notification_deliveries (schedule_id, local_date, endpoint, sent_at) VALUES (?, ?, ?, ?)").run(schedule.id, clock.date, row.endpoint, new Date().toISOString());
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) db().prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(row.endpoint);
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
