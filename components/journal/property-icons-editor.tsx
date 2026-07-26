"use client";

import { useMemo, useRef, useState } from "react";
import { normalizePropertyKey, propertyIconName, type PropertyIcons } from "@/lib/property-icons";
import { PropertyIcon } from "@/components/icons/property-icon";
import { PropertyIconPopover } from "@/components/editor/property-icon-picker";

export function PropertyIconsEditor({ propertyIcons, propertyNames, onChange }: {
  propertyIcons: PropertyIcons;
  propertyNames: string[];
  onChange: (propertyIcons: PropertyIcons) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [added, setAdded] = useState<string[]>([]);
  const triggers = useRef<Record<string, HTMLButtonElement>>({});

  // Only properties the journal actually uses, plus anything already configured
  // or just added here — never the built-in defaults for their own sake.
  const properties = useMemo(
    () => [...new Set([...propertyNames, ...Object.keys(propertyIcons), ...added])].sort(),
    [propertyIcons, propertyNames, added],
  );

  function setIcon(property: string, icon: string | null) {
    const next = { ...propertyIcons };
    if (icon) next[property] = icon;
    else delete next[property];
    onChange(next);
    setEditing(null);
  }

  function addProperty() {
    const key = normalizePropertyKey(draft);
    setDraft("");
    if (!key) return;
    setAdded((current) => (current.includes(key) ? current : [...current, key]));
    setEditing(key);
  }

  return <section className="property-icons-setting" aria-labelledby="property-icons-title">
    <div><p className="eyebrow">PROPERTIES</p><h3 id="property-icons-title">Front matter icons</h3></div>
    <small>Choose the icon shown beside each front matter property your journal uses. You can also click an icon directly in the Properties panel.</small>
    {properties.length === 0 && <p className="property-icon-empty">No front matter properties yet. Add one to an entry, or name it below.</p>}
    <div className="property-icon-list">
      {properties.map((property) => {
        const icon = propertyIconName(propertyIcons, property);
        return <div className="property-icon-row" key={property}>
          <button
            ref={(element) => {
              if (element) triggers.current[property] = element;
              else delete triggers.current[property];
            }}
            type="button"
            className="property-icon-trigger"
            aria-label={`Change the ${property} icon`}
            onClick={() => setEditing((current) => (current === property ? null : property))}
          ><PropertyIcon name={icon} /></button>
          <span className="property-icon-name">{property}</span>
          {property in propertyIcons
            ? <button type="button" className="property-icon-reset" onClick={() => setIcon(property, null)}>Reset</button>
            : <small>Default</small>}
        </div>;
      })}
    </div>
    <label className="property-icon-add">
      Add a property
      <span>
        <input
          type="text"
          value={draft}
          placeholder="mood"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            addProperty();
          }}
        />
        <button type="button" onClick={addProperty} disabled={!normalizePropertyKey(draft)}>Add</button>
      </span>
    </label>
    {editing && <PropertyIconPopover
      property={editing}
      value={propertyIconName(propertyIcons, editing)}
      canReset={editing in propertyIcons}
      anchor={() => triggers.current[editing] ?? null}
      onSelect={(icon) => setIcon(editing, icon)}
      onReset={() => setIcon(editing, null)}
      onClose={() => setEditing(null)}
    />}
  </section>;
}
