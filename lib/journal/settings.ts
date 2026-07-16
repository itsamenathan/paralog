import { eq } from "drizzle-orm";
import path from "node:path";
import { db } from "@/lib/db";
import { settingsTable } from "@/lib/db/schema";
import { legacyWidgetSettings, normalizeWidgetLayout, resolveWidgetLayoutUpdate, type WidgetLayout } from "@/lib/widget-layout";

export const DEFAULT_SAVE_FORMAT = "YYYY/MM-MMMM/YYYY-MM-DD-dddd.md";
const DEFAULT_PROVIDER_ORDER = ["immich", "archive", "github"] as const;
export type ProviderId = typeof DEFAULT_PROVIDER_ORDER[number];

function settingValue(key: string) {
  return db().select({ value: settingsTable.value }).from(settingsTable).where(eq(settingsTable.key, key)).get()?.value;
}

function setting(key: string, fallback: string) {
  return settingValue(key) || fallback;
}

function providerOrder(): ProviderId[] {
  try {
    const value = JSON.parse(setting("providerOrder", JSON.stringify(DEFAULT_PROVIDER_ORDER)));
    if (Array.isArray(value) && value.length === DEFAULT_PROVIDER_ORDER.length && DEFAULT_PROVIDER_ORDER.every((provider) => value.includes(provider))) return value;
  } catch {
    // Fall back to the default order.
  }
  return [...DEFAULT_PROVIDER_ORDER];
}

function widgetLayout() {
  const stored = settingValue("widgetLayout");
  let value: unknown;
  if (stored) {
    try { value = JSON.parse(stored); } catch { /* Normalize an invalid stored value. */ }
  }
  return normalizeWidgetLayout(value, {
    providerOrder: providerOrder(),
    showTagCloud: setting("showTagCloud", "true") !== "false",
  });
}

export function settings() {
  const layout = widgetLayout();
  return {
    saveFormat: setting("saveFormat", DEFAULT_SAVE_FORMAT),
    template: setting("template", ""),
    widgetLayout: layout,
    ...legacyWidgetSettings(layout),
    vimMode: setting("vimMode", "false") === "true",
    autoSave: setting("autoSave", "true") !== "false",
    autoLocation: setting("autoLocation", "false") === "true",
  };
}

export function updateSettings(values: {
  saveFormat?: string;
  template?: string;
  widgetLayout?: WidgetLayout;
  showTagCloud?: boolean;
  vimMode?: boolean;
  autoSave?: boolean;
  autoLocation?: boolean;
  providerOrder?: ProviderId[];
}) {
  const current = settings();
  const saveFormat = values.saveFormat?.trim() || current.saveFormat;
  if (!saveFormat.includes("YYYY") || !saveFormat.includes("MM") || !saveFormat.includes("DD") || saveFormat.includes("..") || path.isAbsolute(saveFormat)) {
    throw new Error("Save format must be a relative path containing YYYY, MM, and DD.");
  }
  const template = values.template ?? current.template;
  const vimMode = values.vimMode ?? current.vimMode;
  const autoSave = values.autoSave ?? current.autoSave;
  const autoLocation = values.autoLocation ?? current.autoLocation;
  const nextWidgetLayout = resolveWidgetLayoutUpdate(current.widgetLayout, values);
  const legacy = legacyWidgetSettings(nextWidgetLayout);
  const upsert = (key: string, value: string) => db().insert(settingsTable).values({ key, value }).onConflictDoUpdate({ target: settingsTable.key, set: { value } }).run();
  upsert("saveFormat", saveFormat);
  upsert("template", template);
  upsert("widgetLayout", JSON.stringify(nextWidgetLayout));
  upsert("showTagCloud", String(legacy.showTagCloud));
  upsert("vimMode", String(vimMode));
  upsert("autoSave", String(autoSave));
  upsert("autoLocation", String(autoLocation));
  upsert("providerOrder", JSON.stringify(legacy.providerOrder));
  return settings();
}
