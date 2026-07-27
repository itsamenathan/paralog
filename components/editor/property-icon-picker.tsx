"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PROPERTY_ICON_CHOICES } from "@/lib/property-icons";
import { PropertyIcon } from "@/components/icons/property-icon";

export function PropertyIconGrid({ value, onSelect, autoFocus }: { value: string; onSelect: (icon: string) => void; autoFocus?: boolean }) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  // The React autoFocus attribute does not survive the portal mount here.
  useEffect(() => { if (autoFocus) searchRef.current?.focus(); }, [autoFocus]);
  const search = query.trim().toLocaleLowerCase();
  const icons = search
    ? PROPERTY_ICON_CHOICES.filter((icon) => icon.replace(/-/g, " ").includes(search))
    : PROPERTY_ICON_CHOICES;

  return (
    <>
      <input
        ref={searchRef}
        className="property-icon-search"
        type="search"
        value={query}
        placeholder="Search icons"
        aria-label="Search icons"
        onChange={(event) => setQuery(event.target.value)}
      />
      {icons.length === 0
        ? <p className="property-icon-empty">No icons match that search.</p>
        : <div className="property-icon-grid" role="group" aria-label="Property icons">
          {icons.map((icon) => (
            <button
              key={icon}
              type="button"
              className="property-icon-choice"
              aria-label={icon.replace(/-/g, " ")}
              aria-pressed={icon === value}
              onClick={() => onSelect(icon)}
            >
              <PropertyIcon name={icon} />
            </button>
          ))}
        </div>}
    </>
  );
}

export function PropertyIconPopover({
  property,
  value,
  anchor,
  canReset,
  onSelect,
  onReset,
  onClose,
}: {
  property: string;
  value: string;
  // Re-queried on every reposition: the Live Preview widget DOM is replaced
  // whenever decorations recompute, so a captured element goes stale.
  anchor: () => HTMLElement | null;
  canReset: boolean;
  onSelect: (icon: string) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const position = useCallback(() => {
    const panel = panelRef.current;
    const anchorElement = anchorRef.current();
    if (!panel) return;
    if (!anchorElement?.isConnected) {
      onClose();
      return;
    }
    const rect = anchorElement.getBoundingClientRect();
    const viewport = window.visualViewport;
    const visibleTop = (viewport?.offsetTop ?? 0) + 8;
    const visibleBottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) - 8;
    const gap = 6;
    const height = panel.offsetHeight;
    const belowSpace = visibleBottom - rect.bottom - gap;
    const below = belowSpace >= height || belowSpace >= rect.top - visibleTop - gap;
    panel.style.top = `${below
      ? Math.min(rect.bottom + gap, visibleBottom - height)
      : Math.max(rect.top - gap - height, visibleTop)}px`;
    const width = panel.offsetWidth;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportRight = viewportLeft + (viewport?.width ?? window.innerWidth);
    panel.style.left = `${Math.min(Math.max(rect.left, viewportLeft + 8), Math.max(viewportLeft + 8, viewportRight - width - 8))}px`;
    panel.dataset.positioned = "true";
  }, [onClose]);

  useLayoutEffect(() => {
    if (!mounted) return;
    position();
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", position);
    viewport?.addEventListener("scroll", position);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      viewport?.removeEventListener("resize", position);
      viewport?.removeEventListener("scroll", position);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [mounted, position]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      // The picker can sit above the settings dialog; only close the picker.
      event.stopPropagation();
      onClose();
    }
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (panelRef.current?.contains(target) || (target instanceof Node && anchorRef.current()?.contains(target))) return;
      onClose();
    }
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div ref={panelRef} className="property-icon-popover" role="dialog" aria-label={`Icon for ${property}`}>
      <header>
        <span className="eyebrow">{property}</span>
        {canReset ? <button type="button" className="property-icon-reset" onClick={onReset}>Reset</button> : null}
      </header>
      <PropertyIconGrid value={value} onSelect={onSelect} autoFocus />
    </div>,
    document.body,
  );
}
