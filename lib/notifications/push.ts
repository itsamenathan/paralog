import { count, eq } from "drizzle-orm";
import webpush, { type PushSubscription } from "web-push";
import { db } from "@/lib/db";
import { notificationConfig, pushSubscriptions } from "@/lib/db/schema";
import { notificationConfigValue } from "./settings";

function vapidKeys() {
  let publicKey = notificationConfigValue("vapid_public_key");
  let privateKey = notificationConfigValue("vapid_private_key");
  if (!publicKey || !privateKey) {
    const generated = webpush.generateVAPIDKeys();
    publicKey = generated.publicKey;
    privateKey = generated.privateKey;
    db().transaction((tx) => {
      tx.insert(notificationConfig).values({ key: "vapid_public_key", value: publicKey! }).onConflictDoUpdate({ target: notificationConfig.key, set: { value: publicKey! } }).run();
      tx.insert(notificationConfig).values({ key: "vapid_private_key", value: privateKey! }).onConflictDoUpdate({ target: notificationConfig.key, set: { value: privateKey! } }).run();
    });
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
  const subscriptions = db().select({ count: count() }).from(pushSubscriptions).get()!.count;
  return { publicKey, subscriptions };
}

export function registerPushSubscription(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("A push subscription is required.");
  const subscription = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof subscription.endpoint !== "string" || !subscription.endpoint.startsWith("https://") || subscription.endpoint.length > 2048) throw new Error("Invalid push endpoint.");
  if (typeof subscription.keys?.p256dh !== "string" || typeof subscription.keys.auth !== "string") throw new Error("Invalid push subscription keys.");
  const now = new Date().toISOString();
  db().insert(pushSubscriptions).values({
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: pushSubscriptions.endpoint,
    set: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth, updatedAt: now },
  }).run();
  return { subscribed: true };
}

export function removePushSubscription(endpoint: unknown) {
  if (typeof endpoint !== "string") throw new Error("A push endpoint is required.");
  db().delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)).run();
  return { subscribed: false };
}

function subscriptionForEndpoint(endpoint: string): PushSubscription | null {
  const row = db().select({ endpoint: pushSubscriptions.endpoint, p256dh: pushSubscriptions.p256dh, auth: pushSubscriptions.auth }).from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)).get();
  return row ? { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } } : null;
}

export async function sendPush(subscription: PushSubscription, payload: object) {
  configureWebPush();
  await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 60 * 60, urgency: "normal" });
}

export async function sendTestNotification(endpoint: unknown, title: unknown, body: unknown) {
  if (typeof endpoint !== "string") throw new Error("Subscribe this device before sending a test.");
  const subscription = subscriptionForEndpoint(endpoint);
  if (!subscription) throw new Error("Subscribe this device before sending a test.");
  const cleanTitle = typeof title === "string" && title.trim() ? title.trim().slice(0, 80) : "Paralog notifications are ready";
  const cleanBody = typeof body === "string" && body.trim() ? body.trim().slice(0, 200) : "Your journal reminders will appear here.";
  await sendPush(subscription, { title: cleanTitle, body: cleanBody, url: "/", tag: `paralog-test-${Date.now()}` });
  return { sent: true };
}
