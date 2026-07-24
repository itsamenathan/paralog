"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  MAX_IMMICH_PHOTO_LIMIT,
  MIN_IMMICH_PHOTO_LIMIT,
  type ImmichWidgetSettings,
} from "@/lib/widget-settings";

export function ImmichSettingsDialog({
  settings,
  onChange,
  onClose,
}: {
  settings: ImmichWidgetSettings;
  onChange: (settings: ImmichWidgetSettings) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="widget-settings-backdrop" role="presentation" onClick={(event) => {
      event.stopPropagation();
      if (event.target === event.currentTarget) onClose();
    }}>
      <section ref={panelRef} className="widget-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="immich-settings-title">
        <header>
          <div><p className="eyebrow">IMMICH WIDGET</p><h3 id="immich-settings-title">Photo settings</h3></div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close Immich settings">×</button>
        </header>
        <label className="toggle-setting">
          <input
            type="checkbox"
            checked={settings.randomize}
            onChange={(event) => onChange({ ...settings, randomize: event.target.checked })}
          />
          <span>
            <b>Randomize displayed photos</b>
            <small>The selection stays consistent for each day.</small>
          </span>
        </label>
        <label>
          Photo limit
          <small>Choose how many photos appear in the widget. The lightbox still includes every photo.</small>
          <input
            type="number"
            min={MIN_IMMICH_PHOTO_LIMIT}
            max={MAX_IMMICH_PHOTO_LIMIT}
            step={1}
            value={settings.photoLimit}
            onChange={(event) => {
              const value = event.target.valueAsNumber;
              if (!Number.isInteger(value)) return;
              onChange({
                ...settings,
                photoLimit: Math.min(MAX_IMMICH_PHOTO_LIMIT, Math.max(MIN_IMMICH_PHOTO_LIMIT, value)),
              });
            }}
          />
        </label>
        <footer><button type="button" className="save-button" onClick={onClose}>Done</button></footer>
      </section>
    </div>,
    document.body,
  );
}
