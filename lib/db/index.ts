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

export function migrateDatabase() {
  const current = state();
  if (current.migrated) return;
  const migrationsFolder = path.join(process.cwd(), "drizzle");
  try {
    migrate(current.database, { migrationsFolder });
    current.migrated = true;
  } catch (error) {
    console.error(`Failed to migrate Paralog database at ${dbPath}.`, error);
    throw error;
  }
}
