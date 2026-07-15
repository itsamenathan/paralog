import { defineConfig } from "drizzle-kit";
import path from "node:path";

const dataDir = process.env.PARALOG_DATA_DIR || path.join(process.cwd(), "data");

export default defineConfig({
  dialect: "sqlite",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: path.join(dataDir, "journal.db"),
  },
});
