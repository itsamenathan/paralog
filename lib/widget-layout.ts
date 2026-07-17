export const NAVIGATION_WIDGET_IDS = ["calendar", "stats", "search", "tags", "people"] as const;
export const CONTEXT_WIDGET_IDS = ["immich", "archive", "github"] as const;
export const WIDGET_IDS = [...NAVIGATION_WIDGET_IDS, ...CONTEXT_WIDGET_IDS] as const;

export type NavigationWidgetId = typeof NAVIGATION_WIDGET_IDS[number];
export type ContextWidgetId = typeof CONTEXT_WIDGET_IDS[number];
export type WidgetId = typeof WIDGET_IDS[number];

export type WidgetLayout = {
  navigation: NavigationWidgetId[];
  context: ContextWidgetId[];
  hidden: WidgetId[];
};

export const DEFAULT_WIDGET_LAYOUT: WidgetLayout = {
  navigation: [...NAVIGATION_WIDGET_IDS],
  context: [...CONTEXT_WIDGET_IDS],
  hidden: [],
};

function orderedIds<T extends WidgetId>(value: unknown, allowed: readonly T[]) {
  const allowedSet = new Set<WidgetId>(allowed);
  const found: T[] = [];
  if (Array.isArray(value)) {
    for (const id of value) {
      if (typeof id === "string" && allowedSet.has(id as WidgetId) && !found.includes(id as T)) found.push(id as T);
    }
  }
  for (const id of allowed) if (!found.includes(id)) found.push(id);
  return found;
}

function hiddenIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<WidgetId>(WIDGET_IDS.filter((id) => id !== "calendar"));
  return value.reduce<WidgetId[]>((found, id) => {
    if (typeof id === "string" && allowed.has(id as WidgetId) && !found.includes(id as WidgetId)) found.push(id as WidgetId);
    return found;
  }, []);
}

export function normalizeWidgetLayout(
  value: unknown,
  legacy: { providerOrder?: unknown; showTagCloud?: unknown } = {},
): WidgetLayout {
  const candidate = value && typeof value === "object" ? value as Partial<Record<keyof WidgetLayout, unknown>> : null;
  if (!candidate) {
    const hidden: WidgetId[] = legacy.showTagCloud === false ? ["tags", "people"] : [];
    return {
      navigation: [...NAVIGATION_WIDGET_IDS],
      context: orderedIds(legacy.providerOrder, CONTEXT_WIDGET_IDS),
      hidden,
    };
  }
  return {
    navigation: ["calendar", ...orderedIds(candidate.navigation, NAVIGATION_WIDGET_IDS).filter((id) => id !== "calendar")],
    context: orderedIds(candidate.context, CONTEXT_WIDGET_IDS),
    hidden: hiddenIds(candidate.hidden),
  };
}

export function applyLegacyWidgetSettings(
  layout: WidgetLayout,
  values: { providerOrder?: unknown; showTagCloud?: unknown },
) {
  const hidden = new Set(layout.hidden);
  if (typeof values.showTagCloud === "boolean") {
    for (const id of ["tags", "people"] as const) {
      if (values.showTagCloud) hidden.delete(id);
      else hidden.add(id);
    }
  }
  return normalizeWidgetLayout({
    ...layout,
    context: values.providerOrder === undefined ? layout.context : values.providerOrder,
    hidden: [...hidden],
  });
}

export function resolveWidgetLayoutUpdate(
  current: WidgetLayout,
  values: { widgetLayout?: unknown; providerOrder?: unknown; showTagCloud?: unknown },
) {
  const supplied = values.widgetLayout ? normalizeWidgetLayout(values.widgetLayout) : null;
  const canonicalChanged = supplied && JSON.stringify(supplied) !== JSON.stringify(current);
  return canonicalChanged ? supplied : applyLegacyWidgetSettings(current, values);
}

export function legacyWidgetSettings(layout: WidgetLayout) {
  return {
    providerOrder: [...layout.context],
    showTagCloud: !layout.hidden.includes("tags") || !layout.hidden.includes("people"),
  };
}
