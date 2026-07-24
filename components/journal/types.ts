import type { DayActivity, DayPhoto } from "@/lib/day-activity-types";
import type { WidgetLayout } from "@/lib/widget-layout";
import type { WidgetSettings } from "@/lib/widget-settings";
import type { Memory, ReferenceSummary } from "@/components/widgets/types";

export type Entry = {
  content: string;
  exists: boolean;
  previousYears: string[];
  memories: Memory[];
  template: string;
};

export type NotificationRule = "always" | "empty";

export type NotificationSchedule = {
  id: string;
  enabled: boolean;
  time: string;
  weekdays: number[];
  rule: NotificationRule;
  title: string;
  body: string;
};

export type JournalSettings = {
  saveFormat: string;
  template: string;
  widgetLayout: WidgetLayout;
  widgetSettings: WidgetSettings;
  showTagCloud: boolean;
  vimMode: boolean;
  autoSave: boolean;
  autoLocation: boolean;
  providerOrder: WidgetLayout["context"];
  notificationTimezone: string;
  notificationSchedules: NotificationSchedule[];
};

export type CalendarEntry = { date: string; words: number };
export type RevisionDiffLine = { type: "added" | "removed" | "context" | "skip"; text: string; count?: number };
export type RevisionSummary = {
  id: number;
  createdAt: string;
  words: number;
  diff: { additions: number; deletions: number; lines: RevisionDiffLine[] };
};
export type SaveState = "saved" | "saving" | "unsaved" | "offline";
export type CachedEntry = Entry & { pending: boolean; updatedAt: string };
export type JournalReferences = { tags: ReferenceSummary[]; people: ReferenceSummary[] };
export type DayContext = { activities: DayActivity[]; photos: DayPhoto[]; photoTotal: number };

export const EMPTY_ENTRY: Entry = {
  content: "",
  exists: false,
  previousYears: [],
  memories: [],
  template: "",
};
