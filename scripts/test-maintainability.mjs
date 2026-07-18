import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { entryMap, mergeCalendarEntries } from "../lib/calendar-entries.ts";
import { exitEmptyMarkdownBlock } from "../lib/editor/commands.ts";
import { journalWordCount, markdownBody, setLocationFrontMatter } from "../lib/front-matter.ts";
import { renderEntryPath, resolveEntryPath, validateSaveFormat } from "../lib/journal/path-format.ts";
import { revisionChanges } from "../lib/journal/revision-diff.ts";
import { calculateWritingStats, searchJournalDocuments, selectRandomMemory } from "../lib/journal/insight-calculations.ts";
import { journalReferences } from "../lib/markdown-references.ts";
import { localClock, notificationDue } from "../lib/notifications/clock.ts";
import { cleanSchedule, validTimezone } from "../lib/notifications/validation.ts";

test("renders every supported journal path token", () => {
  assert.equal(
    renderEntryPath("2026-07-11", "YYYY/MM-MMMM/YYYY-MM-DD-dddd-YY-M-MMM-D-ddd.md"),
    "2026/07-July/2026-07-11-Saturday-26-7-Jul-11-Sat.md",
  );
});

test("rejects unsafe or incomplete save formats", () => {
  assert.equal(validateSaveFormat("YYYY/MM/YYYY-MM-DD.md"), "YYYY/MM/YYYY-MM-DD.md");
  for (const format of ["MM/DD.md", "../YYYY/MM/DD.md", path.resolve("YYYY-MM-DD.md")]) {
    assert.throws(() => validateSaveFormat(format), /relative path containing YYYY, MM, and DD/);
  }
});

test("resolved entry paths stay below the journal root", () => {
  const root = path.resolve("temporary-journal-root");
  assert.equal(
    resolveEntryPath(root, "2026-07-11", "YYYY/MM/YYYY-MM-DD.md"),
    path.join(root, "2026", "07", "2026-07-11.md"),
  );
  assert.throws(() => resolveEntryPath(root, "2026-07-11", "../../YYYY-MM-DD.md"), /Invalid save format/);
});

test("word counts exclude YAML front matter", () => {
  const markdown = "---\nlocation: \"Portland, Oregon\"\nmood: thoughtful\n---\n\nOne two\nthree.";
  assert.equal(markdownBody(markdown), "\nOne two\nthree.");
  assert.equal(journalWordCount(markdown), 3);
  assert.equal(journalWordCount("---\nlocation: home\n---\n"), 0);
});

test("location metadata is added and updated without replacing journal content", () => {
  const created = setLocationFrontMatter("A journal entry", "Portland, Oregon, United States");
  assert.match(created, /^---\nlocation: "Portland, Oregon, United States"\n---\n\nA journal entry$/);
  const updated = setLocationFrontMatter("---\ntitle: Today\nlocation: old\n  nested: value\n---\nBody", "Seattle, Washington");
  assert.equal(updated, "---\ntitle: Today\nlocation: \"Seattle, Washington\"\n---\nBody");
  assert.throws(() => setLocationFrontMatter("---\nlocation: unfinished", "Anywhere"), /unclosed YAML/);
});

test("journal references recognize tags and people at valid boundaries", () => {
  assert.deepEqual(journalReferences("Met @Nathan about #Paralog and #journaling_today."), [
    { kind: "person", label: "Nathan", from: 4, to: 11 },
    { kind: "tag", label: "Paralog", from: 18, to: 26 },
    { kind: "tag", label: "journaling_today", from: 31, to: 48 },
  ]);
  assert.deepEqual(journalReferences("mail@example.com https://example.com/#fragment"), []);
});

test("revision diffs report additions, deletions, and collapsed context", () => {
  const before = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n");
  const after = before.replace("line 6", "changed line");
  const diff = revisionChanges(before, after);
  assert.equal(diff.additions, 1);
  assert.equal(diff.deletions, 1);
  assert.ok(diff.lines.some((line) => line.type === "removed" && line.text === "line 6"));
  assert.ok(diff.lines.some((line) => line.type === "added" && line.text === "changed line"));
  assert.ok(diff.lines.some((line) => line.type === "skip" && (line.count ?? 0) > 0));
});

test("offline calendar merging gives the latest source precedence", () => {
  const cached = [{ date: "2026-07-10", words: 100 }, { date: "2026-07-11", words: 200 }];
  const server = [{ date: "2026-07-11", words: 180 }, { date: "2026-07-12", words: 300 }];
  const pending = [{ date: "2026-07-11", words: 225 }];
  const merged = mergeCalendarEntries(cached, server, pending);
  assert.deepEqual(entryMap(merged), {
    "2026-07-10": 100,
    "2026-07-11": 225,
    "2026-07-12": 300,
  });
});

const insightDocuments = [
  { date: "2026-06-03", content: "Last month had five words total." },
  { date: "2026-07-01", content: "One two three four." },
  { date: "2026-07-02", content: "Five six." },
  { date: "2026-07-04", content: "Met @Nathan to discuss #Paralog search behavior." },
  { date: "2026-07-05", content: "The compact search should find a phrase near the end." },
];

test("writing stats calculate monthly totals, active days, comparisons, and all-time streaks", () => {
  assert.deepEqual(calculateWritingStats(insightDocuments, "2026-07"), {
    month: "2026-07",
    totalWords: 23,
    activeDays: 4,
    longestStreak: 2,
    previousMonthWords: 6,
    wordChange: 17,
    percentChange: 283,
  });
});

test("writing stats handle a month with no prior words", () => {
  const stats = calculateWritingStats(insightDocuments, "2026-06");
  assert.equal(stats.previousMonthWords, 0);
  assert.equal(stats.percentChange, null);
});

test("journal search finds text, tags, people, and partial dates", () => {
  assert.deepEqual(searchJournalDocuments(insightDocuments, "#paralog")[0].matches, ["tag", "text"]);
  assert.deepEqual(searchJournalDocuments(insightDocuments, "@nathan")[0].matches, ["person", "text"]);
  assert.equal(searchJournalDocuments(insightDocuments, "compact search")[0].date, "2026-07-05");
  assert.ok(searchJournalDocuments(insightDocuments, "2026-07").every((result) => result.matches.includes("date")));
  assert.deepEqual(searchJournalDocuments(insightDocuments, "does not exist"), []);
});

test("journal search prioritizes exact dates and respects its result limit", () => {
  const results = searchJournalDocuments(insightDocuments, "2026-07-04", 1);
  assert.equal(results.length, 1);
  assert.equal(results[0].date, "2026-07-04");
  assert.equal(results[0].matches[0], "date");
});

const memoryDocuments = [
  { date: "2023-01-08", content: "A winter memory." },
  { date: "2024-04-12", content: "A spring memory." },
  { date: "2024-07-03", content: "---\ntitle: Hidden\n---\nA **July** memory with [a link](https://example.com)." },
  { date: "2025-06-22", content: "A summer memory." },
  { date: "2026-07-17", content: "The selected entry is never a memory." },
  { date: "2026-07-18", content: "Future entries are never memories." },
  { date: "2022-07-01", content: "---\ntitle: Empty\n---\n" },
];

test("random memories only select older non-empty entries", () => {
  assert.deepEqual(selectRandomMemory(memoryDocuments, "2026-07-17", "all", () => 0), {
    date: "2023-01-08",
    excerpt: "A winter memory.",
    words: 3,
  });
  assert.equal(selectRandomMemory(memoryDocuments.slice(4), "2026-07-17", "all", () => 0), null);
});

test("random memory month and season scopes span prior years", () => {
  assert.deepEqual(selectRandomMemory(memoryDocuments, "2026-07-17", "month", () => 0), {
    date: "2024-07-03",
    excerpt: "A July memory with a link.",
    words: 6,
  });
  assert.equal(selectRandomMemory(memoryDocuments, "2026-07-17", "season", () => 0.99)?.date, "2025-06-22");
});

const validSchedule = {
  id: "evening",
  enabled: true,
  time: "22:00",
  weekdays: [5, 3, 5],
  rule: "empty",
  title: " Time to journal ",
  body: " Write something down. ",
};

test("notification schedules are normalized before storage", () => {
  assert.deepEqual(cleanSchedule(validSchedule), {
    ...validSchedule,
    weekdays: [3, 5],
    title: "Time to journal",
    body: "Write something down.",
  });
  assert.equal(validTimezone("America/Los_Angeles"), true);
  assert.equal(validTimezone("Not/A_Timezone"), false);
});

test("invalid notification schedule fields are rejected", () => {
  const invalidValues = [
    { ...validSchedule, id: "bad id" },
    { ...validSchedule, enabled: "yes" },
    { ...validSchedule, time: "25:00" },
    { ...validSchedule, weekdays: [] },
    { ...validSchedule, weekdays: [7] },
    { ...validSchedule, rule: "sometimes" },
    { ...validSchedule, title: "" },
    { ...validSchedule, body: "x".repeat(201) },
  ];
  for (const value of invalidValues) assert.throws(() => cleanSchedule(value));
});

test("notification clocks use the configured timezone", () => {
  assert.deepEqual(localClock(new Date("2026-07-16T06:30:00.000Z"), "America/Los_Angeles"), {
    date: "2026-07-15",
    weekday: 3,
    minutes: 23 * 60 + 30,
  });
});

test("notifications are due only on enabled weekdays within the delivery window", () => {
  const schedule = cleanSchedule({ ...validSchedule, time: "22:00", weekdays: [3] });
  assert.equal(notificationDue(schedule, { date: "2026-07-15", weekday: 3, minutes: 22 * 60 }), true);
  assert.equal(notificationDue(schedule, { date: "2026-07-15", weekday: 3, minutes: 23 * 60 }), true);
  assert.equal(notificationDue(schedule, { date: "2026-07-15", weekday: 3, minutes: 23 * 60 + 1 }), false);
  assert.equal(notificationDue(schedule, { date: "2026-07-15", weekday: 3, minutes: 21 * 60 + 59 }), false);
  assert.equal(notificationDue(schedule, { date: "2026-07-16", weekday: 4, minutes: 22 * 60 }), false);
  assert.equal(notificationDue({ ...schedule, enabled: false }, { date: "2026-07-15", weekday: 3, minutes: 22 * 60 }), false);
});

function editorState(lineText, selectionHead = lineText.length) {
  return {
    selection: { main: { empty: true, head: selectionHead } },
    doc: {
      lineAt: () => ({ from: 0, to: lineText.length, text: lineText }),
      sliceString: (from, to) => lineText.slice(from, to),
    },
    update: (transaction) => transaction,
  };
}

test("pressing Enter exits an empty Markdown list or quote", () => {
  for (const marker of ["- ", "1. ", "- [ ] ", "> "]) {
    let transaction;
    assert.equal(exitEmptyMarkdownBlock({ state: editorState(marker), dispatch: (value) => { transaction = value; } }), true);
    assert.deepEqual(transaction, { changes: { from: 0, to: marker.length, insert: "" }, selection: { anchor: 0 } });
  }
});

test("pressing Enter preserves non-empty Markdown blocks", () => {
  let dispatched = false;
  assert.equal(exitEmptyMarkdownBlock({ state: editorState("- keep writing"), dispatch: () => { dispatched = true; } }), false);
  assert.equal(dispatched, false);
});
