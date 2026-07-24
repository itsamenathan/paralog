import type { ContextWidgetId, NavigationWidgetId, WidgetId } from "@/lib/widget-layout";

export type WidgetDefinition = {
  id: WidgetId;
  label: string;
  zone: "navigation" | "context";
  defaultOrder: number;
  hideable: boolean;
  configurable: boolean;
};

export const NAVIGATION_WIDGETS: Record<NavigationWidgetId, WidgetDefinition> = {
  calendar: { id: "calendar", label: "Month", zone: "navigation", defaultOrder: 0, hideable: false, configurable: false },
  stats: { id: "stats", label: "Writing stats", zone: "navigation", defaultOrder: 1, hideable: true, configurable: false },
  search: { id: "search", label: "Search", zone: "navigation", defaultOrder: 2, hideable: true, configurable: false },
  tags: { id: "tags", label: "Tags", zone: "navigation", defaultOrder: 3, hideable: true, configurable: false },
  people: { id: "people", label: "People", zone: "navigation", defaultOrder: 4, hideable: true, configurable: false },
};

export const CONTEXT_WIDGETS: Record<ContextWidgetId, WidgetDefinition> = {
  immich: { id: "immich", label: "Immich", zone: "context", defaultOrder: 0, hideable: true, configurable: true },
  archive: { id: "archive", label: "Your archive", zone: "context", defaultOrder: 1, hideable: true, configurable: false },
  github: { id: "github", label: "GitHub", zone: "context", defaultOrder: 2, hideable: true, configurable: false },
  random: { id: "random", label: "Random memory", zone: "context", defaultOrder: 3, hideable: true, configurable: false },
};

export const WIDGETS: Record<WidgetId, WidgetDefinition> = { ...NAVIGATION_WIDGETS, ...CONTEXT_WIDGETS };
