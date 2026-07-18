"use client";

import type { ReactNode } from "react";
import { displayDate, fromIso } from "./date-utils";
import type { Memory, WidgetPlacement } from "./types";

export function MemoryWidgetShell({ placement, widgetClass, titleId, eyebrow, title, action, children }: {
  placement: WidgetPlacement;
  widgetClass: string;
  titleId: string;
  eyebrow: string;
  title: string;
  action: ReactNode;
  children: ReactNode;
}) {
  return <section className={`memory-shelf memory-shelf-${placement} widget ${widgetClass}`} aria-labelledby={titleId}>
    <div className="memory-heading">
      <div><p className="eyebrow">{eyebrow}</p><h3 id={titleId}>{title}</h3></div>
      <div className="memory-heading-action">{action}</div>
    </div>
    {children}
  </section>;
}

export function MemoryEntryCard({ memory, selected, fallback, onChoose }: {
  memory: Memory;
  selected: string;
  fallback: string;
  onChoose: (date: string) => void;
}) {
  const yearsAgo = fromIso(selected).getFullYear() - fromIso(memory.date).getFullYear();
  return <button type="button" className="memory-card" onClick={() => onChoose(memory.date)}>
    <span className="memory-year"><b>{displayDate(memory.date)}</b><small>{yearsAgo > 0 ? `${yearsAgo} ${yearsAgo === 1 ? "year" : "years"} ago` : "Earlier this year"}</small></span>
    <span className="memory-excerpt">{memory.excerpt || fallback}</span>
    <span className="memory-meta">{memory.words} {memory.words === 1 ? "word" : "words"} <b aria-hidden="true">→</b></span>
  </button>;
}
