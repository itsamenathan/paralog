import { EventEmitter } from "node:events";

export type EntryChange = { date: string; changedAt: string };
type EntryChangeListener = (change: EntryChange) => void;

const globalEvents = globalThis as typeof globalThis & {
  paralogEntryEvents?: EventEmitter;
};

const events = globalEvents.paralogEntryEvents ?? new EventEmitter();
events.setMaxListeners(0);
globalEvents.paralogEntryEvents = events;

export function publishEntryChange(date: string) {
  events.emit("entry-change", { date, changedAt: new Date().toISOString() } satisfies EntryChange);
}

export function subscribeToEntryChanges(listener: EntryChangeListener) {
  events.on("entry-change", listener);
  return () => events.off("entry-change", listener);
}
