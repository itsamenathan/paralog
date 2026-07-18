export type WritingStats = {
  month: string;
  totalWords: number;
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
  previousMonthWords: number;
  wordChange: number;
  percentChange: number | null;
};

export type SearchMatchKind = "date" | "tag" | "person" | "text";

export type JournalSearchResult = {
  date: string;
  excerpt: string;
  words: number;
  matches: SearchMatchKind[];
};

export type RandomMemoryScope = "all" | "month" | "season";

export type RandomMemory = {
  date: string;
  excerpt: string;
  words: number;
};
