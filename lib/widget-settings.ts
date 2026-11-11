export const MIN_IMMICH_PHOTO_LIMIT = 1;
export const MAX_IMMICH_PHOTO_LIMIT = 24;

export type ImmichWidgetSettings = {
  randomize: boolean;
  photoLimit: number;
};

export type WidgetSettings = {
  immich: ImmichWidgetSettings;
  onThisDay: ImmichWidgetSettings;
};

export const DEFAULT_WIDGET_SETTINGS: WidgetSettings = {
  immich: {
    randomize: true,
    photoLimit: 6,
  },
  onThisDay: {
    randomize: true,
    photoLimit: 6,
  },
};

export function resolveWidgetSettingsUpdate(current: WidgetSettings, supplied: unknown) {
  return supplied === undefined ? current : normalizeWidgetSettings(supplied);
}

function normalizePhotoSettings(value: unknown, defaults: ImmichWidgetSettings): ImmichWidgetSettings {
  const candidate = value && typeof value === "object"
    ? value as Partial<Record<keyof ImmichWidgetSettings, unknown>>
    : null;
  const suppliedPhotoLimit = candidate?.photoLimit;
  const photoLimit = typeof suppliedPhotoLimit === "number" && Number.isInteger(suppliedPhotoLimit)
    ? Math.min(MAX_IMMICH_PHOTO_LIMIT, Math.max(MIN_IMMICH_PHOTO_LIMIT, suppliedPhotoLimit))
    : defaults.photoLimit;
  return {
    randomize: typeof candidate?.randomize === "boolean" ? candidate.randomize : defaults.randomize,
    photoLimit,
  };
}

export function normalizeWidgetSettings(value: unknown): WidgetSettings {
  const candidate = value && typeof value === "object"
    ? value as { immich?: unknown; onThisDay?: unknown }
    : null;
  return {
    immich: normalizePhotoSettings(candidate?.immich, DEFAULT_WIDGET_SETTINGS.immich),
    onThisDay: normalizePhotoSettings(candidate?.onThisDay, DEFAULT_WIDGET_SETTINGS.onThisDay),
  };
}
