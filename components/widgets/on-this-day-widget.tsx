"use client";

import { useMemo } from "react";
import type { DayPhoto, PastDayPhotos } from "@/lib/day-activity-types";
import { selectOnThisDayPhotos } from "@/lib/immich-photo-selection";
import type { ImmichWidgetSettings } from "@/lib/widget-settings";
import { displayDate, fromIso } from "./date-utils";
import { immichImageUrl } from "./immich-widget";
import type { WidgetPlacement } from "./types";

const photoDate = (photo: DayPhoto, fallback: string) => photo.capturedAt?.slice(0, 10) || fallback;

function yearsAgo(selected: string, date: string) {
  const years = fromIso(selected).getFullYear() - fromIso(date).getFullYear();
  return years === 1 ? "1 year ago" : `${years} years ago`;
}

export function OnThisDayWidget({ years, total, selected, placement, settings, onOpen, onChoose }: {
  years: PastDayPhotos[];
  total: number;
  selected: string;
  placement: WidgetPlacement;
  settings: ImmichWidgetSettings;
  onOpen: (photo: DayPhoto) => void;
  onChoose: (date: string) => void;
}) {
  const visiblePhotos = useMemo(
    () => selectOnThisDayPhotos(years, selected, settings),
    [years, selected, settings],
  );
  if (visiblePhotos.length === 0) return null;
  const titleId = `on-this-day-title-${placement}`;
  const count = total === 1 ? "1 photo" : total > visiblePhotos.length ? `${visiblePhotos.length} of ${total} photos` : `${total} photos`;
  return <section className={`photo-shelf photo-shelf-${placement} widget widget-on-this-day`} aria-labelledby={titleId}>
    <div className="photo-heading"><div><p className="eyebrow">FROM IMMICH</p><h3 id={titleId}>On this day</h3></div><span>{count}</span></div>
    <div className="photo-grid">
      {visiblePhotos.map((photo) => {
        const date = photoDate(photo, selected);
        return <button type="button" className="photo-card" key={photo.id} onClick={() => onOpen(photo)} aria-label={`Open photo from ${displayDate(date)} larger`}>
          <img src={immichImageUrl(photo.id, "thumbnail")} alt="" width={photo.width || 640} height={photo.height || 480} loading="lazy" decoding="async" />
          <span className="photo-card-year" aria-hidden="true">{date.slice(0, 4)}</span>
        </button>;
      })}
    </div>
    <div className="photo-years" aria-label="Go to that day">
      {years.map((year) => <button type="button" key={year.date} onClick={() => onChoose(year.date)} title={displayDate(year.date)}>
        <b>{year.date.slice(0, 4)}</b> {yearsAgo(selected, year.date)} · {year.total}
      </button>)}
    </div>
  </section>;
}

export { photoDate };
