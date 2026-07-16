"use client";

import { useEffect, useState } from "react";
import type { DayActivity, DayPhoto } from "@/lib/day-activity-types";
import { fromIso } from "@/components/widgets/date-utils";

export function useDayContext(selected: string) {
  const [activities, setActivities] = useState<DayActivity[]>([]);
  const [photos, setPhotos] = useState<DayPhoto[]>([]);
  const [photoTotal, setPhotoTotal] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setActivities([]);
    setPhotos([]);
    setPhotoTotal(0);
    if (!navigator.onLine) return () => controller.abort();
    const selectedDate = fromIso(selected);
    const nextDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate() + 1);
    const params = new URLSearchParams({
      date: selected,
      utcOffset: String(selectedDate.getTimezoneOffset()),
      nextUtcOffset: String(nextDate.getTimezoneOffset()),
    });
    fetch(`/api/activity?${params}`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((result) => {
        if (!Array.isArray(result?.activities)) return;
        setActivities(result.activities);
        const photoActivity = result.activities.find((activity: DayActivity) => activity.kind === "photos");
        if (!photoActivity || photoActivity.kind !== "photos") return;
        setPhotos(photoActivity.photos);
        setPhotoTotal(photoActivity.total);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [selected]);

  return { activities, photos, photoTotal };
}
