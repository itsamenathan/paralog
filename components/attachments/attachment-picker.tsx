"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { attachmentMarkdown, type AttachmentKind, type AttachmentListResponse, type AttachmentSummary } from "@/lib/attachment-types";

async function uploadOne(file: File) {
  const data = new FormData();
  data.append("file", file);
  const response = await fetch("/api/uploads", { method: "POST", body: data });
  if (!response.ok) throw new Error("Upload failed");
  return response.json() as Promise<AttachmentSummary>;
}

export function AttachmentPicker({
  open,
  mode,
  entryDate,
  online,
  onClose,
  onInsert,
}: {
  open: boolean;
  mode: "all" | AttachmentKind;
  entryDate: string;
  online: boolean;
  onClose: () => void;
  onInsert: (markdown: string[]) => void;
}) {
  const [items, setItems] = useState<AttachmentSummary[]>([]);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [scope, setScope] = useState<"all" | "entry">("all");
  const [selected, setSelected] = useState(new Set<string>());
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const returnFocus = useRef<HTMLElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const lastTouch = useRef<{ path: string; at: number } | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "100", kind: mode, status: "all" });
      if (deferredQuery) params.set("q", deferredQuery);
      if (scope === "entry") params.set("entry", entryDate);
      const response = await fetch(`/api/attachments?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load attachments");
      const result = await response.json() as AttachmentListResponse;
      setItems(result.items.filter((item) => !item.missing));
    } catch {
      setError("Could not load attachments");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const scrollY = window.scrollY;
    const bodyStyle = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
    };
    const overscrollBehavior = document.documentElement.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    document.documentElement.style.overscrollBehavior = "none";
    setSelected(new Set());
    setScope("all");
    setQuery("");
    window.requestAnimationFrame(() => closeButton.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = bodyStyle.overflow;
      document.body.style.position = bodyStyle.position;
      document.body.style.top = bodyStyle.top;
      document.body.style.width = bodyStyle.width;
      document.documentElement.style.overscrollBehavior = overscrollBehavior;
      window.scrollTo(0, scrollY);
      returnFocus.current?.focus();
    };
  }, [open]);

  useEffect(() => { if (open) void load(); }, [open, deferredQuery, scope, mode, entryDate]);

  async function uploadFiles(files: File[]) {
    if (!online || files.length === 0) return;
    setUploading(true);
    setError("");
    try {
      const uploaded: AttachmentSummary[] = [];
      for (let index = 0; index < files.length; index += 3) uploaded.push(...await Promise.all(files.slice(index, index + 3).map(uploadOne)));
      setItems((current) => [...uploaded.filter((item) => mode === "all" || item.kind === mode), ...current]);
      setSelected(new Set(uploaded.filter((item) => mode === "all" || item.kind === mode).map((item) => item.path)));
    } catch {
      setError("Some files could not be uploaded");
      void load();
    } finally {
      setUploading(false);
    }
  }

  if (!open) return null;
  const chosen = items.filter((item) => selected.has(item.path));
  const insertOne = (item: AttachmentSummary) => { onInsert([attachmentMarkdown(item)]); onClose(); };
  const handleTouch = (item: AttachmentSummary, event: React.PointerEvent) => {
    if (event.pointerType !== "touch") return;
    const now = Date.now();
    if (lastTouch.current?.path === item.path && now - lastTouch.current.at < 350) {
      lastTouch.current = null;
      insertOne(item);
      return;
    }
    lastTouch.current = { path: item.path, at: now };
  };
  return <div className="attachment-picker-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="attachment-picker" role="dialog" aria-modal="true" aria-labelledby="attachment-picker-title">
      <header><div><p className="eyebrow">ADD TO ENTRY</p><h2 id="attachment-picker-title">{mode === "image" ? "Choose an image" : "Choose attachments"}</h2></div><button ref={closeButton} type="button" onClick={onClose} aria-label="Close attachment picker">×</button></header>
      <div className="attachment-picker-controls">
        <input type="search" placeholder="Search files" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="attachment-scope" role="group" aria-label="Attachment scope"><button type="button" className={scope === "all" ? "active" : ""} onClick={() => setScope("all")}>All attachments</button><button type="button" className={scope === "entry" ? "active" : ""} onClick={() => setScope("entry")}>This entry</button></div>
        <label className={`attachment-upload-button ${!online ? "disabled" : ""}`}><input type="file" multiple accept={mode === "image" ? "image/*" : undefined} disabled={!online || uploading} onChange={(event) => { void uploadFiles([...event.currentTarget.files || []]); event.currentTarget.value = ""; }} />{uploading ? "Uploading…" : "Upload files"}</label>
      </div>
      {error && <p className="attachment-error" role="alert">{error}</p>}
      <div className="attachment-picker-grid" aria-busy={loading}>
        {!loading && items.length === 0 && <p className="attachment-empty">{scope === "entry" ? "No attachments are linked to this entry." : "No matching attachments."}</p>}
        {items.map((item) => <button type="button" className={`attachment-choice ${selected.has(item.path) ? "selected" : ""}`} key={item.path} onPointerUp={(event) => handleTouch(item, event)} onDoubleClick={() => insertOne(item)} onClick={() => setSelected((current) => { const next = new Set(current); if (next.has(item.path)) next.delete(item.path); else next.add(item.path); return next; })}>
          <span className="attachment-choice-preview">{item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" loading="lazy" /> : <b>{item.displayName.split(".").pop()?.slice(0, 4).toUpperCase() || "FILE"}</b>}</span>
          <span title={item.displayName}>{item.displayName}</span><small>{item.references.length ? `${item.references.length} linked ${item.references.length === 1 ? "entry" : "entries"}` : "Unlinked"}</small>
        </button>)}
      </div>
      <footer><Link href={`/attachments?entry=${entryDate}`}>Manage library</Link><span /><button type="button" className="text-button" onClick={onClose}>Cancel</button><button type="button" className="save-button" disabled={chosen.length === 0} onClick={() => { onInsert(chosen.map(attachmentMarkdown)); onClose(); }}>Insert {chosen.length || ""}</button></footer>
    </section>
  </div>;
}

export { uploadOne };
