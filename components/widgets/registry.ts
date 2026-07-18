import type { ContextWidgetId, NavigationWidgetId, WidgetId } from "@/lib/widget-layout";

export type WidgetDefinition = {
  id: WidgetId;
  label: string;
  zone: "navigation" | "context";
  defaultOrder: number;
  hideable: boolean;
};

export const NAVIGATION_WIDGETS: Record<NavigationWidgetId, WidgetDefinition> = {
  calendar: { id: "calendar", label: "Month", zone: "navigation", defaultOrder: 0, hideable: false },
  stats: { id: "stats", label: "Writing stats", zone: "navigation", defaultOrder: 1, hideable: true },
  search: { id: "search", label: "Search", zone: "navigation", defaultOrder: 2, hideable: true },
  tags: { id: "tags", label: "Tags", zone: "navigation", defaultOrder: 3, hideable: true },
  people: { id: "people", label: "People", zone: "navigation", defaultOrder: 4, hideable: true },
};

export const CONTEXT_WIDGETS: Record<ContextWidgetId, WidgetDefinition> = {
  immich: { id: "immich", label: "Immich", zone: "context", defaultOrder: 0, hideable: true },
  archive: { id: "archive", label: "Your archive", zone: "context", defaultOrder: 1, hideable: true },
  github: { id: "github", label: "GitHub", zone: "context", defaultOrder: 2, hideable: true },
  random: { id: "random", label: "Random memory", zone: "context", defaultOrder: 3, hideable: true },
};

export const WIDGETS: Record<WidgetId, WidgetDefinition> = { ...NAVIGATION_WIDGETS, ...CONTEXT_WIDGETS };
