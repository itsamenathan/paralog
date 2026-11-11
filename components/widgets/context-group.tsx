"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CONTEXT_GROUP_IDS, type ContextGroupId } from "@/lib/widget-layout";
import { CONTEXT_GROUP_LABELS } from "./registry";
import type { WidgetPlacement } from "./types";

const COLLAPSED_KEY = "paralog-collapsed-context-groups";

// Which groups this browser keeps folded. A convenience only: it falls back to
// everything open when storage is unavailable.
export function useCollapsedContextGroups() {
  const [collapsed, setCollapsed] = useState<ContextGroupId[]>([]);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || "[]");
      if (Array.isArray(stored)) setCollapsed(CONTEXT_GROUP_IDS.filter((id) => stored.includes(id)));
    } catch { /* Keep every group open. */ }
  }, []);

  const toggle = useCallback((group: ContextGroupId) => {
    setCollapsed((current) => {
      const next = current.includes(group) ? current.filter((id) => id !== group) : [...current, group];
      try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next)); } catch { /* Not remembered. */ }
      return next;
    });
  }, []);

  return { collapsed, toggle };
}

export function ContextGroup({ group, placement, collapsed, onToggle, children }: {
  group: ContextGroupId;
  placement: WidgetPlacement;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const bodyId = `context-group-${group}-${placement}`;
  const { title } = CONTEXT_GROUP_LABELS[group];
  return <section className={`context-group context-group-${group} context-group-${placement}`} aria-label={title}>
    <h2 className="context-group-heading">
      <button type="button" aria-expanded={!collapsed} aria-controls={bodyId} onClick={onToggle}>
        <span>{title}</span>
        <span className="context-group-chevron" aria-hidden="true">{collapsed ? "+" : "−"}</span>
      </button>
    </h2>
    <div className="context-group-body" id={bodyId} hidden={collapsed}>{children}</div>
  </section>;
}
