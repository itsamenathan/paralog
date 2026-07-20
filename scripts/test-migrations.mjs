import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const migrationsFolder = path.resolve(import.meta.dirname, "..", "drizzle");
const applicationTables = [
  "attachment_references",
  "attachments",
  "entries",
  "entry_content_scans",
  "journal_references",
  "notification_config",
  "notification_deliveries",
  "notification_suppressions",
  "push_subscriptions",
  "revisions",
  "settings",
];

function temporaryDatabase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "paralog-migrations-"));
  const sqlite = new Database(path.join(directory, "journal.db"));
  return { directory, sqlite, database: drizzle(sqlite) };
}

function tableNames(sqlite) {
  return sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name);
}

test("migrations initialize a fresh database and are repeatable", () => {
  const fixture = temporaryDatabase();
  try {
    migrate(fixture.database, { migrationsFolder });
    for (const table of applicationTables) assert.ok(tableNames(fixture.sqlite).includes(table), `missing ${table}`);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM __drizzle_migrations").get().count, 2);
    assert.equal(tableNames(fixture.sqlite).includes("attachment_entry_scans"), false);

    migrate(fixture.database, { migrationsFolder });
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM __drizzle_migrations").get().count, 2);
  } finally {
    fixture.sqlite.close();
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});
test("the baseline adopts a legacy database without losing data", () => {
  const fixture = temporaryDatabase();
  try {
    fixture.sqlite.exec(`
      CREATE TABLE entries (date TEXT PRIMARY KEY, path TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE revisions (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX revisions_date_created ON revisions(date, created_at DESC);
      CREATE TABLE notification_config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE push_subscriptions (endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE notification_deliveries (schedule_id TEXT NOT NULL, local_date TEXT NOT NULL, endpoint TEXT NOT NULL, sent_at TEXT NOT NULL, PRIMARY KEY (schedule_id, local_date, endpoint));
      CREATE TABLE notification_suppressions (schedule_id TEXT NOT NULL, local_date TEXT NOT NULL, checked_at TEXT NOT NULL, PRIMARY KEY (schedule_id, local_date));
      INSERT INTO entries VALUES ('2026-07-15', '/data/2026-07-15.md', '2026-07-15T12:00:00.000Z');
      INSERT INTO settings VALUES ('template', '# Existing template');
      INSERT INTO revisions (date, content, created_at) VALUES ('2026-07-15', 'Earlier content', '2026-07-15T11:00:00.000Z');
      INSERT INTO notification_config VALUES ('timezone', 'America/Los_Angeles');
      INSERT INTO push_subscriptions VALUES ('https://push.example/subscription', 'key', 'auth', '2026-07-15T10:00:00.000Z', '2026-07-15T10:00:00.000Z');
      INSERT INTO notification_deliveries VALUES ('evening', '2026-07-15', 'https://push.example/subscription', '2026-07-15T22:00:00.000Z');
      INSERT INTO notification_suppressions VALUES ('empty', '2026-07-15', '2026-07-15T22:00:00.000Z');
    `);

    migrate(fixture.database, { migrationsFolder });

    assert.equal(fixture.sqlite.prepare("SELECT path FROM entries WHERE date = '2026-07-15'").get().path, "/data/2026-07-15.md");
    assert.equal(fixture.sqlite.prepare("SELECT value FROM settings WHERE key = 'template'").get().value, "# Existing template");
    assert.equal(fixture.sqlite.prepare("SELECT content FROM revisions").get().content, "Earlier content");
    assert.equal(fixture.sqlite.prepare("SELECT value FROM notification_config WHERE key = 'timezone'").get().value, "America/Los_Angeles");
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM push_subscriptions").get().count, 1);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM notification_deliveries").get().count, 1);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM notification_suppressions").get().count, 1);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM __drizzle_migrations").get().count, 2);
    assert.equal(tableNames(fixture.sqlite).includes("attachment_entry_scans"), false);
  } finally {
    fixture.sqlite.close();
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});
