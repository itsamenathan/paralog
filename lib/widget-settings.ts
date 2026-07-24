export const MIN_IMMICH_PHOTO_LIMIT = 1;
export const MAX_IMMICH_PHOTO_LIMIT = 24;

export type ImmichWidgetSettings = {
  randomize: boolean;
  photoLimit: number;
};

export type WidgetSettings = {
  immich: ImmichWidgetSettings;
};

export const DEFAULT_WIDGET_SETTINGS: WidgetSettings = {
  immich: {
    randomize: true,
    photoLimit: 6,
  },
};

export function resolveWidgetSettingsUpdate(current: WidgetSettings, supplied: unknown) {
  return supplied === undefined ? current : normalizeWidgetSettings(supplied);
}

export function normalizeWidgetSettings(value: unknown): WidgetSettings {
  const candidate = value && typeof value === "object"
    ? value as { immich?: unknown }
    : null;
  const immich = candidate?.immich && typeof candidate.immich === "object"
    ? candidate.immich as Partial<Record<keyof ImmichWidgetSettings, unknown>>
    : null;
  const suppliedPhotoLimit = immich?.photoLimit;
  const photoLimit = typeof suppliedPhotoLimit === "number" && Number.isInteger(suppliedPhotoLimit)
    ? Math.min(MAX_IMMICH_PHOTO_LIMIT, Math.max(MIN_IMMICH_PHOTO_LIMIT, suppliedPhotoLimit))
    : DEFAULT_WIDGET_SETTINGS.immich.photoLimit;

  return {
    immich: {
      randomize: typeof immich?.randomize === "boolean"
        ? immich.randomize
        : DEFAULT_WIDGET_SETTINGS.immich.randomize,
      photoLimit,
    },
  };
}
