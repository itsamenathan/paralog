import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_WIDGET_LAYOUT,
  applyLegacyWidgetSettings,
  legacyWidgetSettings,
  normalizeWidgetLayout,
  resolveWidgetLayoutUpdate,
} from "../lib/widget-layout.ts";
import { selectImmichWidgetPhotos, selectOnThisDayPhotos } from "../lib/immich-photo-selection.ts";
import {
  DEFAULT_WIDGET_SETTINGS,
  normalizeWidgetSettings,
  resolveWidgetSettingsUpdate,
} from "../lib/widget-settings.ts";

test("uses the complete default widget layout", () => {
  assert.deepEqual(normalizeWidgetLayout(undefined), DEFAULT_WIDGET_LAYOUT);
});

test("converts legacy provider order and tag visibility", () => {
  assert.deepEqual(normalizeWidgetLayout(undefined, {
    providerOrder: ["github", "archive", "immich"],
    showTagCloud: false,
  }), {
    navigation: ["calendar", "stats", "search", "tags", "people"],
    context: ["github", "archive", "immich", "onThisDay", "random"],
    hidden: ["tags", "people"],
  });
});

test("removes unknown and duplicate ids, keeps zones separate, and appends missing widgets", () => {
  assert.deepEqual(normalizeWidgetLayout({
    navigation: ["people", "github", "people"],
    context: ["archive", "tags", "archive"],
    hidden: ["calendar", "tags", "random", "tags", "unknown"],
  }), {
    navigation: ["calendar", "people", "stats", "search", "tags"],
    context: ["archive", "immich", "onThisDay", "github", "random"],
    hidden: ["tags", "random"],
  });
});

test("keeps the calendar pinned first and visible", () => {
  assert.deepEqual(normalizeWidgetLayout({
    navigation: ["tags", "calendar", "people"],
    context: ["immich", "archive", "github", "random"],
    hidden: ["calendar"],
  }), {
    navigation: ["calendar", "tags", "people", "stats", "search"],
    context: ["immich", "archive", "github", "random", "onThisDay"],
    hidden: [],
  });
});

test("applies legacy updates to an existing canonical layout", () => {
  const layout = normalizeWidgetLayout({
    navigation: ["calendar", "people", "stats", "search", "tags"],
    context: ["archive", "github", "immich", "random"],
    hidden: ["people", "github"],
  });
  assert.deepEqual(applyLegacyWidgetSettings(layout, {
    providerOrder: ["github", "immich", "archive"],
    showTagCloud: true,
  }), {
    navigation: ["calendar", "people", "stats", "search", "tags"],
    context: ["github", "immich", "archive", "random", "onThisDay"],
    hidden: ["github"],
  });
});

test("derives legacy settings from the canonical layout", () => {
  assert.deepEqual(legacyWidgetSettings(normalizeWidgetLayout({
    navigation: ["calendar", "stats", "search", "tags", "people"],
    context: ["github", "archive", "immich", "random"],
    hidden: ["tags", "immich"],
  })), {
    providerOrder: ["github", "archive", "immich"],
    showTagCloud: true,
  });
});

test("lets an older client update legacy fields when it echoes an unchanged canonical layout", () => {
  const current = normalizeWidgetLayout({
    navigation: ["calendar", "people", "search", "stats", "tags"],
    context: ["github", "random", "archive", "immich"],
    hidden: ["immich"],
  });
  assert.deepEqual(resolveWidgetLayoutUpdate(current, {
    widgetLayout: current,
    providerOrder: ["archive", "immich", "github"],
    showTagCloud: false,
  }), {
    navigation: ["calendar", "people", "search", "stats", "tags"],
    context: ["archive", "random", "immich", "github", "onThisDay"],
    hidden: ["immich", "tags", "people"],
  });
});

test("prefers a changed canonical layout over stale mirrored legacy fields", () => {
  const current = normalizeWidgetLayout(DEFAULT_WIDGET_LAYOUT);
  assert.deepEqual(resolveWidgetLayoutUpdate(current, {
    widgetLayout: {
      navigation: ["calendar", "people", "search", "stats", "tags"],
      context: ["github", "archive", "immich", "random"],
      hidden: ["people"],
    },
    providerOrder: current.context,
    showTagCloud: true,
  }), {
    navigation: ["calendar", "people", "search", "stats", "tags"],
    context: ["github", "archive", "immich", "random", "onThisDay"],
    hidden: ["people"],
  });
});

test("uses complete default widget settings when none are stored", () => {
  assert.deepEqual(normalizeWidgetSettings(undefined), DEFAULT_WIDGET_SETTINGS);
});

test("normalizes valid widget settings and removes unknown values", () => {
  assert.deepEqual(normalizeWidgetSettings({
    immich: { randomize: false, photoLimit: 12, unknown: true },
    unknown: { enabled: true },
  }), {
    immich: { randomize: false, photoLimit: 12 },
    onThisDay: DEFAULT_WIDGET_SETTINGS.onThisDay,
  });
});

test("clamps integer photo limits and defaults malformed values", () => {
  assert.equal(normalizeWidgetSettings({ immich: { photoLimit: -2 } }).immich.photoLimit, 1);
  assert.equal(normalizeWidgetSettings({ immich: { photoLimit: 99 } }).immich.photoLimit, 24);
  for (const photoLimit of [2.5, "12", null, Number.NaN]) {
    assert.equal(normalizeWidgetSettings({ immich: { photoLimit } }).immich.photoLimit, 6);
  }
  assert.equal(normalizeWidgetSettings({ immich: { randomize: "false" } }).immich.randomize, true);
});

test("preserves current widget settings when an older client omits them", () => {
  const current = { immich: { randomize: false, photoLimit: 18 }, onThisDay: { randomize: true, photoLimit: 4 } };
  assert.equal(resolveWidgetSettingsUpdate(current, undefined), current);
  assert.deepEqual(resolveWidgetSettingsUpdate(current, {
    immich: { randomize: true, photoLimit: 9 },
  }), {
    immich: { randomize: true, photoLimit: 9 },
    onThisDay: DEFAULT_WIDGET_SETTINGS.onThisDay,
  });
});

const photos = Array.from({ length: 10 }, (_, index) => ({
  id: `photo-${index}`,
  width: 640,
  height: 480,
  capturedAt: `2026-07-24T${String(index).padStart(2, "0")}:00:00`,
}));

test("deterministically selects randomized Immich photos without mutating the source", () => {
  const originalIds = photos.map((photo) => photo.id);
  const settings = { randomize: true, photoLimit: 4 };
  const first = selectImmichWidgetPhotos(photos, "2026-07-24", settings);
  const second = selectImmichWidgetPhotos(photos, "2026-07-24", settings);
  assert.deepEqual(first, second);
  assert.equal(first.length, 4);
  assert.deepEqual(photos.map((photo) => photo.id), originalIds);
  assert.notDeepEqual(
    first.map((photo) => photo.id),
    selectImmichWidgetPhotos(photos, "2026-07-25", settings).map((photo) => photo.id),
  );
});

test("selects the first Immich photos in source order when randomization is disabled", () => {
  assert.deepEqual(
    selectImmichWidgetPhotos(photos, "2026-07-24", { randomize: false, photoLimit: 3 }),
    photos.slice(0, 3),
  );
});

test("returns every Immich photo when the limit exceeds the available set", () => {
  assert.equal(
    selectImmichWidgetPhotos(photos, "2026-07-24", { randomize: true, photoLimit: 12 }),
    photos,
  );
});

const pastYears = [
  { date: "2025-07-24", total: 5, photos: Array.from({ length: 5 }, (_, index) => ({ ...photos[0], id: `2025-${index}` })) },
  { date: "2023-07-24", total: 1, photos: [{ ...photos[0], id: "2023-0" }] },
  { date: "2019-07-24", total: 2, photos: [{ ...photos[0], id: "2019-0" }, { ...photos[0], id: "2019-1" }] },
];

test("spreads on-this-day photos across years, newest first", () => {
  assert.deepEqual(
    selectOnThisDayPhotos(pastYears, "2026-07-24", { randomize: false, photoLimit: 5 }).map((photo) => photo.id),
    ["2025-0", "2023-0", "2019-0", "2025-1", "2019-1"],
  );
});

test("returns every on-this-day photo when the limit exceeds them", () => {
  assert.equal(selectOnThisDayPhotos(pastYears, "2026-07-24", { randomize: true, photoLimit: 24 }).length, 8);
});

test("randomizes on-this-day photos within each year deterministically", () => {
  const settings = { randomize: true, photoLimit: 3 };
  const first = selectOnThisDayPhotos(pastYears, "2026-07-24", settings);
  assert.deepEqual(first, selectOnThisDayPhotos(pastYears, "2026-07-24", settings));
  assert.deepEqual(first.map((photo) => photo.id.slice(0, 4)), ["2025", "2023", "2019"]);
});
