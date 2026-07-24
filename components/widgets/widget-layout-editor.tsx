"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WidgetId, WidgetLayout } from "@/lib/widget-layout";
import type { WidgetSettings } from "@/lib/widget-settings";
import { WIDGETS } from "./registry";
import { ImmichSettingsDialog } from "./widget-settings-dialog";

type WidgetZone = "navigation" | "context";

export function WidgetLayoutEditor({ layout, widgetSettings, onLayoutChange, onWidgetSettingsChange }: {
  layout: WidgetLayout;
  widgetSettings: WidgetSettings;
  onLayoutChange: (layout: WidgetLayout) => void;
  onWidgetSettingsChange: (settings: WidgetSettings) => void;
}) {
  const [dragging, setDragging] = useState<{ id: WidgetId; zone: WidgetZone } | null>(null);
  const [configuring, setConfiguring] = useState<WidgetId | null>(null);
  const draggingRef = useRef(dragging);
  const settingsTriggers = useRef<Partial<Record<WidgetId, HTMLButtonElement>>>({});
  draggingRef.current = dragging;

  const closeSettings = useCallback(() => setConfiguring(null), []);

  useEffect(() => {
    if (!configuring) return;
    const settingsDialog = settingsTriggers.current[configuring]?.closest<HTMLElement>(".settings");
    settingsDialog?.setAttribute("inert", "");
    return () => {
      settingsDialog?.removeAttribute("inert");
      window.requestAnimationFrame(() => settingsTriggers.current[configuring]?.focus());
    };
  }, [configuring]);

  function ordered(zone: WidgetZone) {
    return layout[zone] as WidgetId[];
  }

  function updateOrder(zone: WidgetZone, ids: WidgetId[]) {
    onLayoutChange({
      ...layout,
      [zone]: ids,
    } as WidgetLayout);
  }

  function move(zone: WidgetZone, id: WidgetId, offset: -1 | 1) {
    const ids = [...ordered(zone)];
    const index = ids.indexOf(id);
    const target = index + offset;
    const firstMovable = zone === "navigation" ? 1 : 0;
    if (index < firstMovable || target < firstMovable || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    updateOrder(zone, ids);
  }

  function place(zone: WidgetZone, id: WidgetId, target: WidgetId) {
    if (id === target) return;
    const ids = [...ordered(zone)];
    const from = ids.indexOf(id);
    const to = ids.indexOf(target);
    const firstMovable = zone === "navigation" ? 1 : 0;
    if (from < firstMovable || to < firstMovable) return;
    ids.splice(from, 1);
    ids.splice(to, 0, id);
    updateOrder(zone, ids);
  }

  function toggle(id: WidgetId, visible: boolean) {
    const hidden = new Set(layout.hidden);
    if (visible) hidden.delete(id);
    else hidden.add(id);
    hidden.delete("calendar");
    onLayoutChange({ ...layout, hidden: [...hidden] });
  }

  function start(zone: WidgetZone, id: WidgetId) {
    const next = { zone, id };
    draggingRef.current = next;
    setDragging(next);
  }

  function finish() {
    draggingRef.current = null;
    setDragging(null);
  }

  function group(zone: WidgetZone, title: string, help: string) {
    return <fieldset className="widget-order-group">
      <legend>{title}</legend>
      <small>{help}</small>
      <div className="widget-order-list">
        {ordered(zone).map((id, index) => {
          const definition = WIDGETS[id];
          const isDragging = dragging?.id === id && dragging.zone === zone;
          const visible = !layout.hidden.includes(id);
          return <div
            className={`widget-order-row ${isDragging ? "dragging" : ""}`}
            data-widget={id}
            data-widget-zone={zone}
            draggable={definition.hideable}
            key={id}
            onDragStart={(event) => {
              if (!definition.hideable) return;
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", id);
              start(zone, id);
            }}
            onDragEnter={() => {
              const current = draggingRef.current;
              if (current?.zone === zone) place(zone, current.id, id);
            }}
            onDragOver={(event) => {
              if (draggingRef.current?.zone !== zone) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => { event.preventDefault(); finish(); }}
            onDragEnd={finish}
          >
            <span className="widget-order-name"><b>{index + 1}</b>{definition.label}</span>
            <span className="widget-order-actions">
              {definition.hideable
                ? <label className="widget-visibility"><input type="checkbox" checked={visible} onChange={(event) => toggle(id, event.target.checked)} /><span>{visible ? "Shown" : "Hidden"}</span></label>
                : <small>Always shown</small>}
              {definition.configurable && <button
                ref={(element) => {
                  if (element) settingsTriggers.current[id] = element;
                  else delete settingsTriggers.current[id];
                }}
                type="button"
                className="widget-configure"
                aria-label={`Configure ${definition.label}`}
                title={`Configure ${definition.label}`}
                onClick={() => setConfiguring(id)}
              ><span aria-hidden="true">⚙</span></button>}
              {definition.hideable && <button
                type="button"
                className="widget-drag-handle"
                draggable
                aria-label={`Reorder ${definition.label}`}
                aria-pressed={isDragging}
                title={`Drag to reorder ${definition.label}`}
                onKeyDown={(event) => {
                  if (event.key === " " || event.key === "Enter") {
                    event.preventDefault();
                    isDragging ? finish() : start(zone, id);
                  } else if (isDragging && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
                    event.preventDefault();
                    move(zone, id, event.key === "ArrowUp" ? -1 : 1);
                  } else if (isDragging && event.key === "Escape") {
                    event.preventDefault();
                    finish();
                  }
                }}
                onPointerDown={(event) => {
                  if (event.pointerType === "mouse") return;
                  event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  start(zone, id);
                }}
                onPointerMove={(event) => {
                  const current = draggingRef.current;
                  if (!current || event.pointerType === "mouse") return;
                  event.preventDefault();
                  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-widget]")?.dataset;
                  if (target?.widget && target.widgetZone === zone) place(zone, current.id, target.widget as WidgetId);
                }}
                onPointerUp={finish}
                onPointerCancel={finish}
              ><span aria-hidden="true">⠿</span></button>}
            </span>
          </div>;
        })}
      </div>
    </fieldset>;
  }

  const active = dragging ? WIDGETS[dragging.id].label : null;
  return <section className="widget-layout-setting" aria-labelledby="widget-layout-title">
    <div><p className="eyebrow">WIDGETS</p><h3 id="widget-layout-title">Layout and visibility</h3></div>
    {group("navigation", "Navigation", "Shown in the desktop sidebar and mobile date browser. The month stays first.")}
    {group("context", "Daily context", "Shown beside the editor on desktop and below it on mobile.")}
    <p className="widget-order-status" aria-live="polite">{active ? `${active} picked up. Drag it, or use the arrow keys, then press Enter to drop.` : ""}</p>
    {configuring === "immich" && <ImmichSettingsDialog
      settings={widgetSettings.immich}
      onChange={(immich) => onWidgetSettingsChange({ ...widgetSettings, immich })}
      onClose={closeSettings}
    />}
  </section>;
}
