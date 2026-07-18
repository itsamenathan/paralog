"use client";

import { MemoryEntryCard, MemoryWidgetShell } from "./memory-widget-ui";
import type { Memory, WidgetPlacement } from "./types";

export function ArchiveWidget({ memories, selected, expanded, placement, onToggle, onChoose }: {
  memories: Memory[];
  selected: string;
  expanded: boolean;
  placement: WidgetPlacement;
  onToggle: () => void;
  onChoose: (date: string) => void;
}) {
  if (memories.length === 0) return null;
  const titleId = `memory-title-${placement}`;
  const listId = `memory-list-${placement}`;
  return <MemoryWidgetShell placement={placement} widgetClass="widget-archive" titleId={titleId} eyebrow="FROM YOUR ARCHIVE" title="This day, other years" action={<span>{memories.length} {memories.length === 1 ? "memory" : "memories"}</span>}>
    <div className="memory-list" id={listId}>
      {(expanded ? memories : memories.slice(0, 3)).map((memory) => <MemoryEntryCard key={memory.date} memory={memory} selected={selected} fallback="A quiet page from this day." onChoose={onChoose} />)}
    </div>
    {memories.length > 3 && <button type="button" className="memory-toggle" aria-expanded={expanded} aria-controls={listId} onClick={onToggle}>
      {expanded ? "Show fewer" : `Show all ${memories.length} years`}
    </button>}
  </MemoryWidgetShell>;
}
