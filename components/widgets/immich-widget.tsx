"use client";

import type { DayPhoto } from "@/lib/day-activity-types";
import { displayDate } from "./date-utils";
import type { WidgetPlacement } from "./types";

const immichImageUrl = (id: string, size: "thumbnail" | "preview") =>
  `/api/immich/thumbnail/${encodeURIComponent(id)}?size=${size}`;

export function ImmichWidget({ photos, total, selected, placement, onOpen }: {
  photos: DayPhoto[];
  total: number;
  selected: string;
  placement: WidgetPlacement;
  onOpen: (photo: DayPhoto) => void;
}) {
  if (photos.length === 0) return null;
  const titleId = `photo-title-${placement}`;
  const count = total === 1 ? "1 photo" : total > photos.length ? `${photos.length} of ${total} photos` : `${total} photos`;
  return <section className={`photo-shelf photo-shelf-${placement} widget widget-immich`} aria-labelledby={titleId}>
    <div className="photo-heading"><div><p className="eyebrow">FROM IMMICH</p><h3 id={titleId}>Photos from this day</h3></div><span>{count}</span></div>
    <div className="photo-grid">
      {photos.map((photo, index) => <button type="button" className="photo-card" key={photo.id} onClick={() => onOpen(photo)} aria-label={`Open photo ${index + 1} from ${displayDate(selected)} larger`}>
        <img src={immichImageUrl(photo.id, "thumbnail")} alt="" width={photo.width || 640} height={photo.height || 480} loading="lazy" decoding="async" />
      </button>)}
    </div>
  </section>;
}

export { immichImageUrl };
