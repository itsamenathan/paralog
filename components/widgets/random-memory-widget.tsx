"use client";

import type { RandomMemory, RandomMemoryScope } from "@/lib/journal-insight-types";
import { MemoryEntryCard, MemoryWidgetShell } from "./memory-widget-ui";
import type { WidgetPlacement } from "./types";

const scopeLabels: Record<RandomMemoryScope, string> = { all: "Any time", month: "This month", season: "This season" };

export function RandomMemoryWidget({ memory, selected, scope, loading, placement, onScopeChange, onRefresh, onChoose }: {
  memory: RandomMemory | null;
  selected: string;
  scope: RandomMemoryScope;
  loading: boolean;
  placement: WidgetPlacement;
  onScopeChange: (scope: RandomMemoryScope) => void;
  onRefresh: () => void;
  onChoose: (date: string) => void;
}) {
  if (!loading && !memory) return null;
  const titleId = `random-memory-title-${placement}`;
  return <MemoryWidgetShell placement={placement} widgetClass="widget-random" titleId={titleId} eyebrow="RANDOM MEMORY" title="A page from your journal" action={<button type="button" onClick={onRefresh} disabled={loading} aria-label="Show another random memory">Another</button>}>
    <div className="random-memory-scopes" aria-label="Random memory range">
      {(Object.keys(scopeLabels) as RandomMemoryScope[]).map((value) => <button type="button" key={value} aria-pressed={scope === value} onClick={() => onScopeChange(value)}>{scopeLabels[value]}</button>)}
    </div>
    {loading && !memory ? <p className="widget-loading">Opening the archive...</p> : memory && <div className="memory-list"><MemoryEntryCard memory={memory} selected={selected} fallback="A quiet page from the archive." onChoose={onChoose} /></div>}
  </MemoryWidgetShell>;
}
