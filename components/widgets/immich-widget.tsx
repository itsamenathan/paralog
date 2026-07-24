"use client";

import { useMemo } from "react";
import type { DayPhoto } from "@/lib/day-activity-types";
import { selectImmichWidgetPhotos } from "@/lib/immich-photo-selection";
import type { ImmichWidgetSettings } from "@/lib/widget-settings";
import { displayDate } from "./date-utils";
import type { WidgetPlacement } from "./types";

const immichImageUrl = (id: string, size: "thumbnail" | "preview") =>
  `/api/immich/thumbnail/${encodeURIComponent(id)}?size=${size}`;

export function ImmichWidget({ photos, total, selected, placement, settings, onOpen }: {
  photos: DayPhoto[];
  total: number;
  selected: string;
  placement: WidgetPlacement;
  settings: ImmichWidgetSettings;
  onOpen: (photo: DayPhoto) => void;
}) {
  const visiblePhotos = useMemo(
    () => selectImmichWidgetPhotos(photos, selected, settings),
    [photos, selected, settings],
  );
  if (photos.length === 0) return null;
  const titleId = `photo-title-${placement}`;
  const count = total === 1 ? "1 photo" : total > visiblePhotos.length ? `${visiblePhotos.length} of ${total} photos` : `${total} photos`;
  return <section className={`photo-shelf photo-shelf-${placement} widget widget-immich`} aria-labelledby={titleId}>
    <div className="photo-heading"><div><p className="eyebrow">FROM IMMICH</p><h3 id={titleId}>Photos from this day</h3></div><span>{count}</span></div>
    <div className="photo-grid">
      {visiblePhotos.map((photo, index) => <button type="button" className="photo-card" key={photo.id} onClick={() => onOpen(photo)} aria-label={`Open photo ${index + 1} from ${displayDate(selected)} larger`}>
        <img src={immichImageUrl(photo.id, "thumbnail")} alt="" width={photo.width || 640} height={photo.height || 480} loading="lazy" decoding="async" />
      </button>)}
    </div>
  </section>;
}

export { immichImageUrl };
