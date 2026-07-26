import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PROPERTY_ICONS,
  FALLBACK_PROPERTY_ICON,
  MAX_PROPERTY_ICONS,
  PROPERTY_ICON_CHOICES,
  frontMatterPropertyNames,
  normalizePropertyIcons,
  normalizePropertyKey,
  propertyIconName,
  resolvePropertyIconsUpdate,
} from "../lib/property-icons.ts";
import { propertyIconNode } from "../lib/icons/property-icon-nodes.ts";

test("normalizes missing and malformed stored values to no overrides", () => {
  for (const value of [undefined, null, "hash", 7, ["hash"]]) {
    assert.deepEqual(normalizePropertyIcons(value), {});
  }
});

test("drops entries that are not a known icon", () => {
  assert.deepEqual(normalizePropertyIcons({
    location: "map-pin",
    tags: "not-a-lucide-icon",
    mood: 12,
    weather: null,
  }), { location: "map-pin" });
});

test("drops keys that normalize to nothing", () => {
  assert.deepEqual(normalizePropertyIcons({ "!!!": "star", "  ": "star", ok: "star" }), { ok: "star" });
});

test("normalizes keys on the way in", () => {
  assert.deepEqual(normalizePropertyIcons({ "Tags ": "hash" }), { tags: "hash" });
});

test("caps the number of stored overrides", () => {
  const supplied = {};
  for (let index = 0; index < MAX_PROPERTY_ICONS + 25; index += 1) supplied[`p${index}`] = "star";
  assert.equal(Object.keys(normalizePropertyIcons(supplied)).length, MAX_PROPERTY_ICONS);
});

test("keeps the current overrides when an update omits them", () => {
  const current = { location: "globe" };
  assert.equal(resolvePropertyIconsUpdate(current, undefined), current);
});

test("clears every override when an update supplies an empty map", () => {
  assert.deepEqual(resolvePropertyIconsUpdate({ location: "globe" }, {}), {});
});

test("resolves an override ahead of the default, and the default ahead of the fallback", () => {
  assert.equal(propertyIconName({ location: "globe" }, "location"), "globe");
  assert.equal(propertyIconName({}, "location"), DEFAULT_PROPERTY_ICONS.location);
  assert.equal(propertyIconName({}, "sleep"), FALLBACK_PROPERTY_ICON);
});

test("normalizes property keys the way the editor sanitizes its class names", () => {
  const editorKey = (name) => name.toLocaleLowerCase().replace(/[^a-z0-9-]/g, "");
  for (const name of ["Location", "created_at", "Ort", "#tags", "date-added"]) {
    assert.equal(normalizePropertyKey(name), editorKey(name));
  }
});

test("reads root-level front matter keys only", () => {
  assert.deepEqual(frontMatterPropertyNames("---\nlocation: Berlin\n  city: Berlin\ntags: a\n---\nBody"), ["location", "tags"]);
});

test("reads front matter keys across CRLF line endings", () => {
  assert.deepEqual(frontMatterPropertyNames("---\r\nlocation: Berlin\r\n---\r\nBody"), ["location"]);
});

test("reads no front matter keys without a closed leading block", () => {
  assert.deepEqual(frontMatterPropertyNames("Just a journal entry."), []);
  assert.deepEqual(frontMatterPropertyNames("---\nlocation: Berlin\nstill open"), []);
  assert.deepEqual(frontMatterPropertyNames("Intro\n---\nlocation: Berlin\n---"), []);
});

test("every offered icon resolves to a distinct lucide icon", () => {
  const fallback = propertyIconNode(FALLBACK_PROPERTY_ICON);
  for (const icon of PROPERTY_ICON_CHOICES) {
    const node = propertyIconNode(icon);
    assert.ok(Array.isArray(node) && node.length > 0, `${icon} has no icon data`);
    if (icon !== FALLBACK_PROPERTY_ICON) assert.notEqual(node, fallback, `${icon} fell back to ${FALLBACK_PROPERTY_ICON}`);
  }
});

test("every default icon is offered by the picker", () => {
  for (const icon of Object.values(DEFAULT_PROPERTY_ICONS)) {
    assert.ok(PROPERTY_ICON_CHOICES.includes(icon), `${icon} is not an offered choice`);
  }
  assert.ok(PROPERTY_ICON_CHOICES.includes(FALLBACK_PROPERTY_ICON));
});
