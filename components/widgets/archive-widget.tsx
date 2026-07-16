"use client";

import { fromIso } from "./date-utils";
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
  return <section className={`memory-shelf memory-shelf-${placement} widget widget-archive`} aria-labelledby={titleId}>
    <div className="memory-heading"><div><p className="eyebrow">FROM YOUR ARCHIVE</p><h3 id={titleId}>This day, other years</h3></div><span>{memories.length} {memories.length === 1 ? "memory" : "memories"}</span></div>
    <div className="memory-list" id={listId}>
      {(expanded ? memories : memories.slice(0, 3)).map((memory) => {
        const yearsAgo = fromIso(selected).getFullYear() - fromIso(memory.date).getFullYear();
        return <button type="button" className="memory-card" key={memory.date} onClick={() => onChoose(memory.date)}>
          <span className="memory-year">{fromIso(memory.date).getFullYear()} <small>{yearsAgo} {yearsAgo === 1 ? "year" : "years"} ago</small></span>
          <span className="memory-excerpt">{memory.excerpt || "A quiet page from this day."}</span>
          <span className="memory-meta">{memory.words} words <b aria-hidden="true">→</b></span>
        </button>;
      })}
    </div>
    {memories.length > 3 && <button type="button" className="memory-toggle" aria-expanded={expanded} aria-controls={listId} onClick={onToggle}>
      {expanded ? "Show fewer" : `Show all ${memories.length} years`}
    </button>}
  </section>;
}
