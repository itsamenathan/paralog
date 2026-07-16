"use client";

import { useCallback, useState } from "react";
import type { ReferenceSummary } from "@/components/widgets/types";

export function useJournalReferences() {
  const [tags, setTags] = useState<ReferenceSummary[]>([]);
  const [people, setPeople] = useState<ReferenceSummary[]>([]);

  const refreshReferences = useCallback(async () => {
    try {
      const response = await fetch("/api/references", { cache: "no-store" });
      if (!response.ok) return;
      const result = await response.json();
      setTags(result.tags);
      setPeople(result.people);
    } catch {
      // Keep the last references available when offline.
    }
  }, []);

  return { tags, people, refreshReferences };
}
