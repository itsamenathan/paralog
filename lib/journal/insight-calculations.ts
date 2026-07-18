import type { JournalSearchResult, RandomMemory, RandomMemoryScope, SearchMatchKind, WritingStats } from "../journal-insight-types";

export type JournalDocument = { date: string; content: string };

const frontMatter = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;
const referencePattern = /(^|[\s([{"'.,!?;:>])([#@])([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu;

function markdownBody(markdown: string) {
  const match = markdown.match(frontMatter);
  return match ? markdown.slice(match[0].length) : markdown;
}

function journalWordCount(markdown: string) {
  const body = markdownBody(markdown).trim();
  return body ? body.split(/\s+/).length : 0;
}

function documentReferences(value: string) {
  return [...value.matchAll(referencePattern)].map((match) => ({
    kind: match[2] === "#" ? "tag" as const : "person" as const,
    label: match[3],
  }));
}

function previousMonth(month: string) {
  const [year, value] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, value - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function longestDateStreak(dates: string[]) {
  const days = [...new Set(dates)].map((date) => Date.parse(`${date}T00:00:00Z`)).sort((a, b) => a - b);
  let longest = 0;
  let current = 0;
  let previous = Number.NaN;
  for (const day of days) {
    current = day - previous === 86_400_000 ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = day;
  }
  return longest;
}

export function calculateWritingStats(documents: JournalDocument[], month: string): WritingStats {
  const active = documents.map((document) => ({ ...document, words: journalWordCount(document.content) })).filter((document) => document.words > 0);
  const current = active.filter((document) => document.date.startsWith(`${month}-`));
  const previous = active.filter((document) => document.date.startsWith(`${previousMonth(month)}-`));
  const totalWords = current.reduce((total, document) => total + document.words, 0);
  const previousMonthWords = previous.reduce((total, document) => total + document.words, 0);
  const wordChange = totalWords - previousMonthWords;
  return {
    month,
    totalWords,
    activeDays: current.length,
    longestStreak: longestDateStreak(active.map((document) => document.date)),
    previousMonthWords,
    wordChange,
    percentChange: previousMonthWords ? Math.round((wordChange / previousMonthWords) * 100) : null,
  };
}

function season(month: number) {
  if (month === 12 || month <= 2) return "winter";
  if (month <= 5) return "spring";
  if (month <= 8) return "summer";
  return "autumn";
}

export function selectRandomMemory(
  documents: JournalDocument[],
  selected: string,
  scope: RandomMemoryScope,
  random: () => number = Math.random,
): RandomMemory | null {
  const selectedMonth = Number(selected.slice(5, 7));
  const candidates = documents.flatMap((document) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(document.date) || document.date >= selected) return [];
    const documentMonth = Number(document.date.slice(5, 7));
    if (scope === "month" && documentMonth !== selectedMonth) return [];
    if (scope === "season" && season(documentMonth) !== season(selectedMonth)) return [];
    const words = journalWordCount(document.content);
    return words > 0 ? [{ date: document.date, excerpt: plainText(document.content).slice(0, 180), words }] : [];
  });
  if (candidates.length === 0) return null;
  const index = Math.min(candidates.length - 1, Math.max(0, Math.floor(random() * candidates.length)));
  return candidates[index];
}

function plainText(content: string) {
  return markdownBody(content)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^[#>*_`~-]+/gm, " ")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function matchingExcerpt(text: string, query: string) {
  if (!text) return "Empty entry";
  const index = text.toLocaleLowerCase().indexOf(query);
  const start = index < 0 ? 0 : Math.max(0, index - 48);
  const end = Math.min(text.length, start + 150);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

export function searchJournalDocuments(documents: JournalDocument[], rawQuery: string, limit = 8): JournalSearchResult[] {
  const query = rawQuery.trim().normalize("NFC").toLocaleLowerCase();
  if (!query) return [];
  const referenceQuery = query.replace(/^[#@]/, "");
  return documents.flatMap((document) => {
    const body = markdownBody(document.content);
    const text = plainText(document.content);
    const normalizedBody = body.normalize("NFC").toLocaleLowerCase();
    const matches: SearchMatchKind[] = [];
    let score = 0;
    if (document.date.includes(query)) { matches.push("date"); score += document.date === query ? 100 : 45; }
    const references = documentReferences(body);
    const tagMatch = references.some((reference) => reference.kind === "tag" && reference.label.normalize("NFC").toLocaleLowerCase().includes(referenceQuery));
    const personMatch = references.some((reference) => reference.kind === "person" && reference.label.normalize("NFC").toLocaleLowerCase().includes(referenceQuery));
    if (tagMatch && (!query.startsWith("@") || query.startsWith("#"))) { matches.push("tag"); score += query.startsWith("#") ? 70 : 35; }
    if (personMatch && (!query.startsWith("#") || query.startsWith("@"))) { matches.push("person"); score += query.startsWith("@") ? 70 : 35; }
    if (normalizedBody.includes(query) || (!query.startsWith("#") && !query.startsWith("@") && text.toLocaleLowerCase().includes(query))) { matches.push("text"); score += 20; }
    if (matches.length === 0) return [];
    return [{
      result: { date: document.date, excerpt: matchingExcerpt(text, referenceQuery || query), words: journalWordCount(document.content), matches: [...new Set(matches)] },
      score,
    }];
  }).sort((left, right) => right.score - left.score || right.result.date.localeCompare(left.result.date)).slice(0, limit).map(({ result }) => result);
}
