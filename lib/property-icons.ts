export type PropertyIcons = Record<string, string>;

export const FALLBACK_PROPERTY_ICON = "diamond";
export const MAX_PROPERTY_ICONS = 200;
const MAX_PROPERTY_KEY_LENGTH = 64;

// Grouped by theme so the picker grid stays scannable.
export const PROPERTY_ICON_CHOICES = [
  "diamond", "circle", "square", "star", "heart", "flag", "bookmark", "tag", "hash", "at-sign",
  "pin", "paperclip", "map-pin", "map", "globe", "compass", "route", "home", "hotel", "building-2",
  "plane", "car", "bus", "train-front", "bike", "ship", "anchor", "luggage", "backpack", "tent",
  "mountain", "trees", "tree-pine", "flower", "leaf", "sprout", "waves", "footprints", "ticket", "telescope",
  "clock", "alarm-clock", "calendar", "calendar-days", "calendar-check", "hourglass", "timer", "repeat", "sunrise", "sunset",
  "sun", "moon", "cloud", "cloud-sun", "cloud-rain", "cloud-snow", "cloud-lightning", "snowflake", "umbrella", "rainbow",
  "thermometer", "droplet", "wind", "gauge", "trending-up", "scale", "weight", "ruler", "target", "award",
  "users", "user", "baby", "smile", "laugh", "frown", "meh", "angry", "annoyed", "brain",
  "heart-pulse", "activity", "dumbbell", "bed", "pill", "stethoscope", "syringe", "glasses", "watch", "shirt",
  "coffee", "utensils", "apple", "salad", "milk", "egg", "beef", "cake", "gift", "party-popper",
  "dog", "cat", "bird", "fish", "bug", "puzzle", "rocket", "trophy", "sparkles", "zap",
  "music", "headphones", "camera", "image", "film", "video", "tv", "mic", "gamepad-2", "palette",
  "book", "book-open", "book-marked", "notebook-pen", "pen-line", "file-text", "newspaper", "quote", "type", "languages",
  "graduation-cap", "lightbulb", "link", "mail", "phone", "message-circle", "flame", "wrench", "laptop", "monitor",
  "briefcase", "dollar-sign", "wallet", "credit-card", "piggy-bank", "receipt", "banknote", "coins", "shopping-cart", "list",
  "list-checks", "circle-check", "clipboard-list", "layers", "folder", "box", "key", "lock", "shield",
] as const;

export type PropertyIconName = typeof PROPERTY_ICON_CHOICES[number];

const CHOICES = new Set<string>(PROPERTY_ICON_CHOICES);

export const DEFAULT_PROPERTY_ICONS: PropertyIcons = {
  location: "map-pin",
  tags: "hash",
  people: "users",
  date: "clock",
  created: "clock",
  updated: "clock",
  mood: "smile",
  weather: "cloud-sun",
  title: "type",
};

// Mirrors the class-name sanitizing the Live Preview editor applies to a front
// matter key, so stored overrides and rendered rows always agree on the key.
export function normalizePropertyKey(name: string) {
  return name.normalize("NFC").toLocaleLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, MAX_PROPERTY_KEY_LENGTH);
}

export function propertyIconName(icons: PropertyIcons, key: string) {
  return icons[key] ?? DEFAULT_PROPERTY_ICONS[key] ?? FALLBACK_PROPERTY_ICON;
}

export function normalizePropertyIcons(value: unknown): PropertyIcons {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const icons: PropertyIcons = {};
  for (const [name, icon] of Object.entries(value as Record<string, unknown>)) {
    if (typeof icon !== "string" || !CHOICES.has(icon)) continue;
    const key = normalizePropertyKey(name);
    if (!key || key in icons) continue;
    icons[key] = icon;
    if (Object.keys(icons).length >= MAX_PROPERTY_ICONS) break;
  }
  return icons;
}

export function resolvePropertyIconsUpdate(current: PropertyIcons, supplied: unknown) {
  return supplied === undefined ? current : normalizePropertyIcons(supplied);
}

// Root-level keys of the leading front matter block, in document order.
export function frontMatterPropertyNames(markdown: string) {
  const lines = markdown.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return [];
  const names: string[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "---") return names;
    const key = /^([\w-]+)\s*:/.exec(line)?.[1];
    if (!key) continue;
    const normalized = normalizePropertyKey(key);
    if (normalized && !names.includes(normalized)) names.push(normalized);
  }
  return [];
}
