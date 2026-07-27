import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { entryProperties } from "@/lib/db/schema";
import { syncEntryContentIndex } from "./content-index";

// Front matter property names actually used somewhere in the journal.
export function usedPropertyNames() {
  syncEntryContentIndex();
  return db()
    .selectDistinct({ name: entryProperties.name })
    .from(entryProperties)
    .orderBy(asc(entryProperties.name))
    .all()
    .map((row) => row.name);
}
