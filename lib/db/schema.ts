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

export const attachments = sqliteTable("attachments", {
  path: text("path").primaryKey(),
  displayName: text("display_name").notNull(),
  mediaType: text("media_type").notNull(),
  kind: text("kind").notNull(),
  size: integer("size").notNull(),
  addedAt: text("added_at").notNull(),
  modifiedAt: text("modified_at").notNull(),
  indexedAt: text("indexed_at").notNull(),
}, (table) => [
  index("attachments_kind").on(table.kind),
  index("attachments_added_at").on(table.addedAt),
  index("attachments_display_name").on(table.displayName),
]);

export const attachmentReferences = sqliteTable("attachment_references", {
  attachmentPath: text("attachment_path").notNull(),
  entryDate: text("entry_date").notNull(),
  occurrences: integer("occurrences").notNull(),
}, (table) => [
  primaryKey({ columns: [table.attachmentPath, table.entryDate] }),
  index("attachment_references_entry_date").on(table.entryDate),
]);

export const entryContentScans = sqliteTable("entry_content_scans", {
  entryDate: text("entry_date").primaryKey(),
  entryPath: text("entry_path").notNull(),
  entryUpdatedAt: text("entry_updated_at").notNull(),
  entrySize: integer("entry_size").notNull(),
  indexVersion: integer("index_version").notNull(),
});

export const journalReferencesTable = sqliteTable("journal_references", {
  entryDate: text("entry_date").notNull(),
  kind: text("kind").notNull(),
  normalizedName: text("normalized_name").notNull(),
  displayName: text("display_name").notNull(),
  occurrences: integer("occurrences").notNull(),
}, (table) => [
  primaryKey({ columns: [table.entryDate, table.kind, table.normalizedName] }),
  index("journal_references_kind_name").on(table.kind, table.normalizedName),
  index("journal_references_entry_date").on(table.entryDate),
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
