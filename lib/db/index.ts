import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import * as schema from "@/lib/db/schema";

export const dataDir = process.env.PARALOG_DATA_DIR || path.join(process.cwd(), "data");
export const dbPath = path.join(dataDir, "journal.db");

type ParalogDatabase = BetterSQLite3Database<typeof schema>;
type DatabaseState = {
  sqlite: Database.Database;
  database: ParalogDatabase;
  migrated: boolean;
};

const globalState = globalThis as typeof globalThis & { __paralogDatabase?: DatabaseState };

function state() {
  if (!globalState.__paralogDatabase) {
    fs.mkdirSync(dataDir, { recursive: true });
    const sqlite = new Database(dbPath);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("busy_timeout = 5000");
    globalState.__paralogDatabase = {
      sqlite,
      database: drizzle(sqlite, { schema }),
      migrated: false,
    };
  }
  return globalState.__paralogDatabase;
}

export function db() {
  migrateDatabase();
  return state().database;
}

function migrationCount(sqlite: Database.Database) {
  const table = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'").get();
  if (!table) return 0;
  return (sqlite.prepare("SELECT COUNT(*) AS count FROM __drizzle_migrations").get() as { count: number }).count;
}

export function migrateDatabase() {
  const current = state();
  if (current.migrated) return;
  const migrationsFolder = path.join(process.cwd(), "drizzle");
  try {
    const before = migrationCount(current.sqlite);
    migrate(current.database, { migrationsFolder });
    const applied = migrationCount(current.sqlite) - before;
    current.migrated = true;
    if (applied > 0) {
      console.info(`Paralog database: applied ${applied} migration${applied === 1 ? "" : "s"} to ${dbPath}.`);
    } else {
      console.info(`Paralog database: schema is up to date at ${dbPath}.`);
    }
  } catch (error) {
    console.error(`Failed to migrate Paralog database at ${dbPath}.`, error);
    throw error;
  }
}
