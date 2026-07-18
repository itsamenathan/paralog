import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_WIDGET_LAYOUT,
  applyLegacyWidgetSettings,
  legacyWidgetSettings,
  normalizeWidgetLayout,
  resolveWidgetLayoutUpdate,
} from "../lib/widget-layout.ts";

test("uses the complete default widget layout", () => {
  assert.deepEqual(normalizeWidgetLayout(undefined), DEFAULT_WIDGET_LAYOUT);
});

test("converts legacy provider order and tag visibility", () => {
  assert.deepEqual(normalizeWidgetLayout(undefined, {
    providerOrder: ["github", "archive", "immich"],
    showTagCloud: false,
  }), {
    navigation: ["calendar", "stats", "search", "tags", "people"],
    context: ["github", "archive", "immich", "random"],
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
    context: ["archive", "immich", "github", "random"],
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
    context: ["immich", "archive", "github", "random"],
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
    context: ["github", "immich", "archive", "random"],
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
    context: ["archive", "random", "immich", "github"],
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
    context: ["github", "archive", "immich", "random"],
    hidden: ["people"],
  });
});
