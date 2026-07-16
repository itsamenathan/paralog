export type DayPhoto = {
  id: string;
  width: number | null;
  height: number | null;
  capturedAt: string | null;
};

export type DayPhotoActivity = {
  provider: string;
  source: string;
  title: string;
  kind: "photos";
  total: number;
  photos: DayPhoto[];
};

export type DaySummaryItem = {
  id: string;
  label: string;
  count: number;
  url?: string;
};

export type DaySummaryActivity = {
  provider: string;
  source: string;
  title: string;
  kind: "summary";
  total: number;
  totalLabel: string;
  itemUnit: { singular: string; plural: string };
  items: DaySummaryItem[];
};

export type DayActivity = DayPhotoActivity | DaySummaryActivity;

export type DayProviderContext = { utcOffsetMinutes: number; nextUtcOffsetMinutes: number };
