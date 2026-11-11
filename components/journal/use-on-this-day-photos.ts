"use client";

import { useEffect, useState } from "react";
import type { PastDayPhotos } from "@/lib/day-activity-types";

export function useOnThisDayPhotos(selected: string, enabled: boolean) {
  const [years, setYears] = useState<PastDayPhotos[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setYears([]);
    setTotal(0);
    if (!enabled || !navigator.onLine) return () => controller.abort();
    fetch(`/api/immich/on-this-day?${new URLSearchParams({ date: selected })}`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((result) => {
        if (!Array.isArray(result?.years)) return;
        setYears(result.years);
        setTotal(typeof result.total === "number" ? result.total : 0);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [enabled, selected]);

  return { years, total };
}
