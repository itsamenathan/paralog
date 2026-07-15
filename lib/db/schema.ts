import { desc } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const entries = sqliteTable("entries", {
  date: text("date").primaryKey(),
  path: text("path").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const settingsTable = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const revisions = sqliteTable("revisions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("revisions_date_created").on(table.date, desc(table.createdAt)),
]);

export const notificationConfig = sqliteTable("notification_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const pushSubscriptions = sqliteTable("push_subscriptions", {
  endpoint: text("endpoint").primaryKey(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const notificationDeliveries = sqliteTable("notification_deliveries", {
  scheduleId: text("schedule_id").notNull(),
  localDate: text("local_date").notNull(),
  endpoint: text("endpoint").notNull(),
  sentAt: text("sent_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.scheduleId, table.localDate, table.endpoint] }),
]);

export const notificationSuppressions = sqliteTable("notification_suppressions", {
  scheduleId: text("schedule_id").notNull(),
  localDate: text("local_date").notNull(),
  checkedAt: text("checked_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.scheduleId, table.localDate] }),
]);
