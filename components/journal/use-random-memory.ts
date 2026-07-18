"use client";

import { useCallback, useEffect, useState } from "react";
import type { RandomMemory, RandomMemoryScope } from "@/lib/journal-insight-types";

const SCOPE_KEY = "paralog:random-memory-scope";
const scopes: RandomMemoryScope[] = ["all", "month", "season"];

export function useRandomMemory(selected: string) {
  const [scope, setScopeState] = useState<RandomMemoryScope>("all");
  const [memory, setMemory] = useState<RandomMemory | null>(null);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [shuffle, setShuffle] = useState(0);

  useEffect(() => {
    const stored = localStorage.getItem(SCOPE_KEY);
    if (stored && scopes.includes(stored as RandomMemoryScope)) setScopeState(stored as RandomMemoryScope);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    let active = true;
    const query = new URLSearchParams({ date: selected, scope });
    if (shuffle) query.set("shuffle", String(shuffle));
    setMemory(null);
    setLoading(true);
    fetch(`/api/random-memory?${query}`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((value) => { if (active) setMemory(value?.memory || null); })
      .catch(() => undefined)
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [ready, scope, selected, shuffle]);

  const setScope = useCallback((next: RandomMemoryScope) => {
    localStorage.setItem(SCOPE_KEY, next);
    setScopeState(next);
    setShuffle(0);
  }, []);

  const refresh = useCallback(() => setShuffle(Date.now()), []);
  return { memory, scope, loading, setScope, refresh };
}
