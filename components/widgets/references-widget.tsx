"use client";

import type { ReferenceSummary } from "./types";

export function ReferencesWidget({ references, kind }: {
  references: ReferenceSummary[];
  kind: "tag" | "person";
}) {
  if (references.length === 0) return null;
  const largest = Math.max(...references.map((reference) => reference.count), 1);
  const marker = kind === "tag" ? "#" : "@";
  const collection = kind === "tag" ? "tags" : "people";
  return <section className={`tag-browser widget widget-${collection}`} aria-label={`Journal ${collection}`}>
    <div className="tag-heading"><p className="eyebrow">{collection.toUpperCase()}</p></div>
    <div className="tag-cloud">
      {references.map((reference) => <a
        href={`/${collection}/${encodeURIComponent(reference.name.normalize("NFC").toLocaleLowerCase())}`}
        key={reference.name}
        style={{ "--tag-weight": String(reference.count / largest) } as React.CSSProperties}
        aria-label={`${marker}${reference.name}, ${reference.count} ${reference.count === 1 ? "entry" : "entries"}`}
      >{marker}{reference.name}</a>)}
    </div>
  </section>;
}
