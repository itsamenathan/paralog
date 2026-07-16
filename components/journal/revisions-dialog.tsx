"use client";

import type { RevisionSummary } from "./types";

export function RevisionsDialog({
  revisions,
  loading,
  onClose,
  onRestore,
}: {
  revisions: RevisionSummary[];
  loading: boolean;
  onClose: () => void;
  onRestore: (id: number) => void;
}) {
  return <div className="modal-backdrop" role="presentation" onClick={onClose}>
    <section className="revisions-panel" role="dialog" aria-modal="true" aria-labelledby="revisions-title" onClick={(event) => event.stopPropagation()}>
      <div className="settings-title"><div><p className="eyebrow">ENTRY HISTORY</p><h2 id="revisions-title">Previous versions</h2></div><button type="button" onClick={onClose} aria-label="Close versions">×</button></div>
      {loading ? <p className="panel-empty">Loading versions…</p> : revisions.length === 0 ? <p className="panel-empty">No previous versions yet. Paralog creates one when saved content changes.</p> : <div className="revision-list">
        {revisions.map((revision, index) => <article key={revision.id}>
          <div className="revision-meta">
            <strong>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(revision.createdAt))}</strong>
            <small>{revision.words} {revision.words === 1 ? "word" : "words"}</small>
            <span className="revision-additions">+{revision.diff.additions}</span>
            <span className="revision-deletions">−{revision.diff.deletions}</span>
          </div>
          <details open={index === 0}>
            <summary>View changes</summary>
            <div className="revision-diff" aria-label="Changes made after this version">
              {revision.diff.lines.map((line, lineIndex) => line.type === "skip"
                ? <div className="diff-skip" key={`${revision.id}-line-${lineIndex}`}>⋯ {line.count} unchanged {line.count === 1 ? "line" : "lines"}</div>
                : <div className={`diff-line diff-${line.type}`} aria-label={`${line.type === "added" ? "Added" : line.type === "removed" ? "Removed" : "Unchanged"}: ${line.text || "blank line"}`} key={`${revision.id}-line-${lineIndex}`}>
                  <span aria-hidden="true">{line.type === "added" ? "+" : line.type === "removed" ? "−" : " "}</span><code>{line.text || " "}</code>
                </div>)}
            </div>
          </details>
          <button type="button" onClick={() => onRestore(revision.id)}>Restore this version</button>
        </article>)}
      </div>}
    </section>
  </div>;
}
