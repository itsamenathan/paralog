import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { entryMap, mergeCalendarEntries } from "../lib/calendar-entries.ts";
import { exitEmptyMarkdownBlock, moveLivePreviewVertically } from "../lib/editor/commands.ts";
import { journalWordCount, markdownBody, setLocationFrontMatter } from "../lib/front-matter.ts";
import { renderEntryPath, resolveEntryPath, validateSaveFormat } from "../lib/journal/path-format.ts";
import { revisionChanges } from "../lib/journal/revision-diff.ts";
import { calculateWritingStats, searchJournalDocuments, selectRandomMemory } from "../lib/journal/insight-calculations.ts";
import { journalReferences } from "../lib/markdown-references.ts";
import { localClock, notificationDue } from "../lib/notifications/clock.ts";
import { cleanSchedule, validTimezone } from "../lib/notifications/validation.ts";
import { attachmentPathFromUrl, attachmentReferencesInMarkdown, normalizeAttachmentPath } from "../lib/attachment-references.ts";
import { entryNeedsContentIndex } from "../lib/content-index-state.ts";
import { indexedJournalReferences } from "../lib/entry-journal-references.ts";

test("attachment paths accept supported URLs and reject unsafe destinations", () => {
  assert.equal(attachmentPathFromUrl("/api/files?path=attachments%2F2026%2F07%2Fphoto.png"), "attachments/2026/07/photo.png");
  assert.equal(attachmentPathFromUrl("/attachments/2026/07/photo.png"), "attachments/2026/07/photo.png");
  assert.equal(attachmentPathFromUrl("attachments/2026/07/photo.png"), "attachments/2026/07/photo.png");
  for (const value of ["../attachments/photo.png", "attachments/../journal.db", "attachments/.cache/thumb.webp", "/attachments/photo.png", "attachments\\photo.png"]) {
    assert.equal(normalizeAttachmentPath(value), null);
  }
  assert.equal(attachmentPathFromUrl("https://example.com/attachments/photo.png"), null);
  assert.equal(attachmentPathFromUrl("/api/files?path=..%2Fjournal.db"), null);
});

test("attachment references count Markdown links while ignoring code", () => {
  const references = attachmentReferencesInMarkdown([
    "![Photo](/api/files?path=attachments%2F2026%2F07%2Fphoto.png)",
    "[Photo again](attachments/2026/07/photo.png)",
    "[notes]: /attachments/2026/07/notes.pdf",
    "`[ignored](attachments/secret.txt)`",
    "```md",
    "[ignored](attachments/also-secret.txt)",
    "```",
  ].join("\n"));
  assert.equal(references.get("attachments/2026/07/photo.png"), 2);
  assert.equal(references.get("attachments/2026/07/notes.pdf"), 1);
  assert.equal(references.size, 2);
});

test("journal reference indexing normalizes names and counts occurrences", () => {
  assert.deepEqual(indexedJournalReferences("Met @Nathan and @nathan about #Paralog, then #paralog again."), [
    { kind: "person", normalizedName: "nathan", displayName: "Nathan", occurrences: 2 },
    { kind: "tag", normalizedName: "paralog", displayName: "Paralog", occurrences: 2 },
  ]);
});

test("journal reference indexing ignores metadata, code, links, URLs, and HTML", () => {
  const references = indexedJournalReferences([
    "---",
    "topic: \"#metadata\"",
    "---",
    "Keep #visible and @person.",
    "`#inline-code`",
    "```md",
    "#fenced-code",
    "```",
    "[#link-label](https://example.com/@link)",
    "[#reference-label][reference]",
    "[reference]: https://example.com/#definition",
    "https://example.com/#url",
    "<!-- #comment -->",
    "<span>#html</span>",
  ].join("\n"));
  assert.deepEqual(references, [
    { kind: "tag", normalizedName: "visible", displayName: "visible", occurrences: 1 },
    { kind: "person", normalizedName: "person", displayName: "person", occurrences: 1 },
  ]);
});

test("content index state changes for path, timestamp, size, and parser version", () => {
  const file = { entryPath: "/data/2026-07-20.md", entryUpdatedAt: "2026-07-20T12:00:00.000Z", entrySize: 120 };
  const scan = { ...file, indexVersion: 1 };
  assert.equal(entryNeedsContentIndex(undefined, file, 1), true);
  assert.equal(entryNeedsContentIndex(scan, file, 1), false);
  assert.equal(entryNeedsContentIndex(scan, file, 1, true), true);
  assert.equal(entryNeedsContentIndex({ ...scan, entryPath: "/old.md" }, file, 1), true);
  assert.equal(entryNeedsContentIndex({ ...scan, entryUpdatedAt: "older" }, file, 1), true);
  assert.equal(entryNeedsContentIndex({ ...scan, entrySize: 119 }, file, 1), true);
  assert.equal(entryNeedsContentIndex(scan, file, 2), true);
});

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
  assert.match(created, /^---\nlocation: Portland, Oregon, United States\n---\n\nA journal entry$/);
  const updated = setLocationFrontMatter("---\ntitle: Today\nlocation: old\n  nested: value\n---\nBody", "Seattle, Washington");
  assert.equal(updated, "---\ntitle: Today\nlocation: Seattle, Washington\n---\nBody");
  const specialCharacters = setLocationFrontMatter("", "Example: East #1");
  assert.match(specialCharacters, /^---\nlocation: "Example: East #1"\n---\n\n$/);
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

test("writing stats calculate monthly totals, active days, comparisons, and streaks", () => {
  assert.deepEqual(calculateWritingStats(insightDocuments, "2026-07", "2026-07-06"), {
    month: "2026-07",
    totalWords: 23,
    activeDays: 4,
    currentStreak: 2,
    longestStreak: 2,
    previousMonthWords: 6,
    wordChange: 17,
    percentChange: 283,
  });
});

test("writing stats handle a month with no prior words", () => {
  const stats = calculateWritingStats(insightDocuments, "2026-06", "2026-07-07");
  assert.equal(stats.previousMonthWords, 0);
  assert.equal(stats.percentChange, null);
  assert.equal(stats.currentStreak, 0);
});

test("current writing streak includes today when active and otherwise allows yesterday", () => {
  assert.equal(calculateWritingStats(insightDocuments, "2026-07", "2026-07-05").currentStreak, 2);
  assert.equal(calculateWritingStats(insightDocuments, "2026-07", "2026-07-06").currentStreak, 2);
  assert.equal(calculateWritingStats(insightDocuments, "2026-07", "2026-07-07").currentStreak, 0);
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
  { date: "2026-07-18", content: "A later entry can be a memory too." },
  { date: "2022-07-01", content: "---\ntitle: Empty\n---\n" },
];

test("random memories select non-empty entries from before or after the selected date", () => {
  assert.deepEqual(selectRandomMemory(memoryDocuments, "2014-07-17", "all", () => 0), {
    date: "2023-01-08",
    excerpt: "A winter memory.",
    words: 3,
  });
  assert.equal(selectRandomMemory(memoryDocuments, "2014-07-17", "all", () => 0.99)?.date, "2026-07-18");
  assert.equal(selectRandomMemory(memoryDocuments.slice(4, 5), "2026-07-17", "all", () => 0), null);
});

test("random memory month and season scopes span years in either direction", () => {
  assert.deepEqual(selectRandomMemory(memoryDocuments, "2014-07-17", "month", () => 0), {
    date: "2024-07-03",
    excerpt: "A July memory with a link.",
    words: 6,
  });
  assert.equal(selectRandomMemory(memoryDocuments, "2014-07-17", "season", () => 0.99)?.date, "2026-07-18");
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

function verticalNavigationView(text, head, movedHead, coordinateHead) {
  const rawLines = text.split("\n");
  const lines = [];
  let from = 0;
  for (let index = 0; index < rawLines.length; index += 1) {
    const value = rawLines[index];
    lines.push({ number: index + 1, from, to: from + value.length, text: value });
    from += value.length + 1;
  }
  const lineAt = (position) => lines.find((line) => position >= line.from && position <= line.to) || lines.at(-1);
  let transaction;
  let measurement;
  return {
    state: {
      selection: { main: { empty: true, anchor: head, head }, ranges: [{}] },
      doc: { lines: lines.length, lineAt, line: (number) => lines[number - 1] },
    },
    moveVertically: () => ({ anchor: movedHead, head: movedHead }),
    moveToLineBoundary: () => ({ anchor: movedHead, head: movedHead }),
    coordsAtPos: (position) => ({ top: lineAt(position).number * 20, left: 80 }),
    lineBlockAt: (position) => ({ top: (lineAt(position).number - 1) * 20, height: 20 }),
    posAtCoords: () => coordinateHead,
    contentDOM: { getBoundingClientRect: () => ({ left: 0 }) },
    documentTop: 0,
    dispatch: (value) => { transaction = value; },
    requestMeasure: (value) => { measurement = value; },
    transaction: () => transaction,
    measurement: () => measurement,
  };
}

test("Live Preview vertical movement cannot skip an adjacent Markdown line", () => {
  for (const text of [
    "## Heading\nbody\n## Destination",
    "- first\n- second\n- third",
    "1. first\n2. second\n3. third",
    "> first\n> second\n> third",
    "**first**\n**second**\n**third**",
    "[first](https://example.com/a-long-url)\nmiddle\n[last](https://example.com/another-long-url)",
  ]) {
    const lines = text.split("\n");
    const second = lines[0].length + 1;
    const third = second + lines[1].length + 1;
    const view = verticalNavigationView(text, third + 2, 2, second + 2);
    assert.equal(moveLivePreviewVertically(view, -1), true);
    assert.deepEqual(view.transaction(), { selection: { anchor: second + 2 } });
  }
});

test("Live Preview schedules viewport stabilization when an image changes height", () => {
  const text = "before\n![photo](/attachments/photo.jpg)\nafter";
  const second = text.indexOf("![photo]");
  const view = verticalNavigationView(text, 2, second + 2, second + 2);
  assert.equal(moveLivePreviewVertically(view, 1), true);
  assert.equal(typeof view.measurement()?.read, "function");
  assert.equal(typeof view.measurement()?.write, "function");
});

test("Live Preview vertical movement retains CodeMirror movement within wrapped rows", () => {
  const text = "first\na long wrapped middle line\nlast";
  const second = text.indexOf("a long");
  const view = verticalNavigationView(text, second + 20, second + 8, second);
  assert.equal(moveLivePreviewVertically(view, -1), true);
  assert.deepEqual(view.transaction(), { selection: { anchor: second + 8 } });
});
