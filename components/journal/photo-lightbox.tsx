"use client";

import { useRef } from "react";
import type { DayPhoto } from "@/lib/day-activity-types";
import { displayDate } from "@/components/widgets/date-utils";
import { immichImageUrl } from "@/components/widgets/immich-widget";

export function PhotoLightbox({
  photo,
  photos,
  selected,
  loadedPhotoId,
  onLoaded,
  onClose,
  onMove,
}: {
  photo: DayPhoto;
  photos: DayPhoto[];
  selected: string;
  loadedPhotoId: string | null;
  onLoaded: (id: string) => void;
  onClose: () => void;
  onMove: (offset: number) => void;
}) {
  const swipeStart = useRef<number | null>(null);
  return <div className="photo-lightbox-backdrop" role="presentation" onClick={onClose}>
    <section
      className="photo-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`Large photo from ${displayDate(selected)}`}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        swipeStart.current = event.clientX;
      }}
      onPointerUp={(event) => {
        const start = swipeStart.current;
        swipeStart.current = null;
        if (start === null || photos.length < 2) return;
        const distance = event.clientX - start;
        if (Math.abs(distance) >= 48) onMove(distance < 0 ? 1 : -1);
      }}
      onPointerCancel={() => { swipeStart.current = null; }}
    >
      <button type="button" className="photo-lightbox-close" onClick={onClose} aria-label="Close photo">×</button>
      <img
        className={`photo-lightbox-image ${loadedPhotoId === photo.id ? "loaded" : ""}`}
        src={immichImageUrl(photo.id, "preview")}
        alt={`Photo from ${displayDate(selected)}`}
        decoding="async"
        draggable={false}
        onLoad={() => onLoaded(photo.id)}
      />
      {photos.length > 1 && <>
        <button type="button" className="photo-lightbox-nav previous" onClick={() => onMove(-1)} aria-label="Previous photo">←</button>
        <span className="photo-lightbox-position" aria-live="polite">{photos.findIndex((item) => item.id === photo.id) + 1} / {photos.length}</span>
        <button type="button" className="photo-lightbox-nav next" onClick={() => onMove(1)} aria-label="Next photo">→</button>
      </>}
    </section>
  </div>;
}
