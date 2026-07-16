export type CalendarEntry = { date: string; words: number };

export function entryMap(entries: CalendarEntry[]) {
  return Object.fromEntries(entries.map((entry) => [entry.date, entry.words]));
}

export function mergeCalendarEntries(...groups: CalendarEntry[][]) {
  const merged = new Map<string, number>();
  groups.forEach((group) => group.forEach((entry) => merged.set(entry.date, entry.words)));
  return [...merged].map(([date, words]) => ({ date, words }));
}
