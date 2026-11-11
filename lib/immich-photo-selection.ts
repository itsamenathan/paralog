import type { DayPhoto, PastDayPhotos } from "@/lib/day-activity-types";
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
  return orderPhotos(photos, selected, settings.randomize).slice(0, settings.photoLimit);
}

function orderPhotos(photos: DayPhoto[], selected: string, randomize: boolean) {
  if (!randomize) return photos;
  return [...photos]
    .sort((left, right) => stableHash(`${selected}:${left.id}`) - stableHash(`${selected}:${right.id}`));
}

// Fill the widget from every past year in turn, newest first, so one busy year
// cannot crowd out the others.
export function selectOnThisDayPhotos(
  years: PastDayPhotos[],
  selected: string,
  settings: ImmichWidgetSettings,
) {
  const queues = years.map((year) => orderPhotos(year.photos, selected, settings.randomize));
  const chosen: DayPhoto[] = [];
  for (let round = 0; chosen.length < settings.photoLimit; round += 1) {
    let added = false;
    for (const queue of queues) {
      if (round >= queue.length) continue;
      chosen.push(queue[round]);
      added = true;
      if (chosen.length === settings.photoLimit) break;
    }
    if (!added) break;
  }
  return chosen;
}
