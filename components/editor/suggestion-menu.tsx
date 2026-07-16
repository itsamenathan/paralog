"use client";

import type { RefObject } from "react";

export type SuggestionMenuItem = { label: string; hint: string; run: () => void };

export function SuggestionMenu({
  menuRef,
  items,
  activeIndex,
  label,
  onActiveIndexChange,
}: {
  menuRef: RefObject<HTMLDivElement | null>;
  items: SuggestionMenuItem[];
  activeIndex: number;
  label: string;
  onActiveIndexChange: (index: number) => void;
}) {
  if (items.length === 0) return null;
  return <div ref={menuRef} className="slash-menu" role="menu" aria-label={label}>
    {items.map((item, index) => <button
      type="button"
      role="menuitem"
      className={index === activeIndex ? "active" : ""}
      aria-current={index === activeIndex ? "true" : undefined}
      key={item.label}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={() => onActiveIndexChange(index)}
      onClick={item.run}
    ><b>{item.label}</b><span>{item.hint}</span></button>)}
  </div>;
}
