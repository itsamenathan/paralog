import type { DayPhoto } from "@/lib/day-activity-types";
import type { ImmichWidgetSettings } from "@/lib/widget-settings";

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function selectImmichWidgetPhotos(
  photos: DayPhoto[],
  selected: string,
  settings: ImmichWidgetSettings,
) {
  if (photos.length <= settings.photoLimit) return photos;
  if (!settings.randomize) return photos.slice(0, settings.photoLimit);
  return [...photos]
    .sort((left, right) => stableHash(`${selected}:${left.id}`) - stableHash(`${selected}:${right.id}`))
    .slice(0, settings.photoLimit);
}
