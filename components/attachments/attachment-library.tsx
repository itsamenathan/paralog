"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import type { AttachmentListResponse, AttachmentSummary } from "@/lib/attachment-types";
import { useTheme } from "@/components/journal/use-theme";
import { uploadOne } from "./attachment-picker";

const EMPTY_TOTALS: AttachmentListResponse["totals"] = { files: 0, images: 0, documents: 0, linked: 0, unlinked: 0, missing: 0, bytes: 0 };
const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
const date = (value: string) => value ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(value)) : "Unknown";

export function AttachmentLibrary({ initialEntry = "" }: { initialEntry?: string }) {
  const { dark, setDark } = useTheme();
  const [items, setItems] = useState<AttachmentSummary[]>([]);
  const [totals, setTotals] = useState(EMPTY_TOTALS);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");
  const [entry, setEntry] = useState(initialEntry);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState("added-desc");
  const [selected, setSelected] = useState<AttachmentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState<string[]>([]);
  const [online, setOnline] = useState(true);
  const [revisionWarning, setRevisionWarning] = useState<string[]>([]);
  const input = useRef<HTMLInputElement | null>(null);

  function params(cursor?: string) {
    const result = new URLSearchParams({ limit: "48", kind, status, sort });
    if (deferredQuery) result.set("q", deferredQuery);
    if (entry) result.set("entry", entry);
    if (from) result.set("from", from);
    if (to) result.set("to", to);
    if (cursor) result.set("cursor", cursor);
    return result;
  }

  async function load(cursor?: string) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/attachments?${params(cursor)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load attachments");
      const result = await response.json() as AttachmentListResponse;
      setItems((current) => cursor ? [...current, ...result.items] : result.items);
      setTotals(result.totals);
      setTotal(result.total);
      setNextCursor(result.nextCursor);
      if (selected) setSelected(result.items.find((item) => item.path === selected.path) || (cursor ? selected : null));
    } catch {
      setError("Could not load the attachment library.");
    } finally { setLoading(false); }
  }

  useEffect(() => { setOnline(navigator.onLine); const update = () => setOnline(navigator.onLine); window.addEventListener("online", update); window.addEventListener("offline", update); return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); }; }, []);
  useEffect(() => { void load(); }, [deferredQuery, kind, status, entry, from, to, sort]);

  async function upload(files: File[]) {
    if (!online || !files.length) return;
    setUploading(files.map((file) => file.name));
    setError("");
    const failures: string[] = [];
    for (let index = 0; index < files.length; index += 3) {
      await Promise.all(files.slice(index, index + 3).map(async (file) => { try { await uploadOne(file); } catch { failures.push(file.name); } finally { setUploading((current) => current.filter((name) => name !== file.name)); } }));
    }
    if (failures.length) setError(`${failures.length} ${failures.length === 1 ? "file" : "files"} could not be uploaded.`);
    await load();
  }

  async function remove(acknowledgeRevisionReferences = false) {
    if (!selected || selected.missing || !online) return;
    setError("");
    const response = await fetch("/api/attachments", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: selected.path, acknowledgeRevisionReferences }) });
    if (response.ok) { setSelected(null); setRevisionWarning([]); await load(); return; }
    const result = await response.json();
    if (response.status === 409 && result.code === "revision_warning") { setRevisionWarning(result.revisionDates || []); return; }
    setError(result.error || "Could not delete attachment.");
  }

  return <main className="attachment-shell">
    <aside className="sidebar attachment-sidebar">
      <div className="brand"><p className="eyebrow">PRIVATE JOURNAL</p><h1>Paralog</h1></div>
      <Link className="today-button" href={entry ? `/?date=${entry}` : "/"}><span>Back to journal</span><b aria-hidden="true">↗</b></Link>
      <section className="attachment-sidebar-summary"><p className="eyebrow">LIBRARY</p><strong>{totals.files}</strong><span>files · {size(totals.bytes)}</span><small>{totals.images} images · {totals.documents} documents</small>{totals.missing > 0 && <small className="warning">{totals.missing} missing references</small>}</section>
      <div className="side-actions"><a className="active" href="/attachments"><span className="action-icon" aria-hidden="true">▧</span><span className="action-label">Attachments</span></a><button type="button" onClick={() => setDark(!dark)}><span className="action-icon" aria-hidden="true">{dark ? "☀" : "◐"}</span><span className="action-label">{dark ? "Light mode" : "Dark mode"}</span></button></div>
    </aside>
    <nav className="mobile-bar" aria-label="Attachment navigation"><Link className="mobile-brand" href={entry ? `/?date=${entry}` : "/"}>Paralog</Link><div><Link href={entry ? `/?date=${entry}` : "/"}>Journal</Link><button type="button" onClick={() => setDark(!dark)} aria-label={dark ? "Use light mode" : "Use dark mode"}><span aria-hidden="true">{dark ? "☀" : "◐"}</span></button></div></nav>
    <section className="attachment-page">
    <header className="attachment-page-header"><div><p className="eyebrow">ATTACHMENT LIBRARY</p><h1>Files and photos</h1><p>Browse everything connected to your journal.</p></div><div><button className="save-button" type="button" disabled={!online} onClick={() => input.current?.click()}>Upload files</button><input ref={input} className="editor-file-input" type="file" multiple disabled={!online} onChange={(event) => { void upload([...event.currentTarget.files || []]); event.currentTarget.value = ""; }} /></div></header>
    {!online && <div className="offline-banner"><span>Offline</span> Showing attachments saved on this device.</div>}
    <section className="attachment-filter-bar" aria-label="Attachment filters">
      <input className="attachment-search" type="search" placeholder="Search filenames and paths" value={query} onChange={(event) => setQuery(event.target.value)} />
      <select aria-label="File type" value={kind} onChange={(event) => setKind(event.target.value)}><option value="all">All types</option><option value="image">Images</option><option value="document">Documents</option></select>
      <select aria-label="Link status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Any status</option><option value="linked">Linked</option><option value="unlinked">Unlinked</option><option value="missing">Missing</option></select>
      <input type="date" aria-label="Linked entry date" value={entry} onChange={(event) => setEntry(event.target.value)} />
      <input type="date" aria-label="Added after" value={from} onChange={(event) => setFrom(event.target.value)} />
      <input type="date" aria-label="Added before" value={to} onChange={(event) => setTo(event.target.value)} />
      <select aria-label="Sort attachments" value={sort} onChange={(event) => setSort(event.target.value)}><option value="added-desc">Newest first</option><option value="added-asc">Oldest first</option><option value="name-asc">Name</option><option value="size-desc">Largest first</option></select>
    </section>
    {uploading.length > 0 && <div className="attachment-upload-status" role="status">Uploading {uploading.join(", ")}</div>}
    {error && <p className="attachment-error" role="alert">{error}</p>}
    <div className={`attachment-library-layout ${selected ? "has-detail" : ""}`} onDragOver={(event) => { if (online && event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={(event) => { if (!online) return; event.preventDefault(); void upload([...event.dataTransfer.files]); }}>
      <section><div className="attachment-results-heading"><strong>{total} {total === 1 ? "result" : "results"}</strong><small>Drop files here to upload</small></div><div className="attachment-grid" aria-busy={loading}>
        {!loading && items.length === 0 && <div className="attachment-empty"><h2>No attachments found</h2><p>Try changing the filters or upload a file.</p></div>}
        {items.map((item) => <button type="button" className={`attachment-card ${selected?.path === item.path ? "selected" : ""} ${item.missing ? "missing" : ""}`} key={item.path} onClick={() => { setSelected(item); setRevisionWarning([]); }}>
          <span className="attachment-card-preview">{item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" loading="lazy" /> : <b>{item.missing ? "?" : item.displayName.split(".").pop()?.slice(0, 4).toUpperCase() || "FILE"}</b>}</span>
          <span><strong title={item.displayName}>{item.displayName}</strong><small>{item.missing ? "Missing file" : `${size(item.size)} · ${date(item.addedAt)}`}</small><i>{item.references.length ? `${item.references.length} linked ${item.references.length === 1 ? "entry" : "entries"}` : "Unlinked"}</i></span>
        </button>)}
      </div>{nextCursor && <button className="attachment-load-more" type="button" disabled={loading} onClick={() => void load(nextCursor)}>{loading ? "Loading…" : "Load more"}</button>}</section>
      {selected && <div className="attachment-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><aside className="attachment-detail" aria-label="Attachment details">
        <header><p className="eyebrow">FILE DETAILS</p><button type="button" aria-label="Close attachment details" onClick={() => setSelected(null)}>×</button></header>
        <div className="attachment-detail-preview">{selected.thumbnailUrl ? <img src={selected.fileUrl} alt={selected.displayName} /> : <b>{selected.missing ? "Missing" : selected.displayName.split(".").pop()?.toUpperCase() || "File"}</b>}</div>
        <h2>{selected.displayName}</h2><code>{selected.path}</code>
        {!selected.missing && <dl><div><dt>Type</dt><dd>{selected.mediaType}</dd></div><div><dt>Size</dt><dd>{size(selected.size)}</dd></div><div><dt>Added</dt><dd>{date(selected.addedAt)}</dd></div><div><dt>Modified</dt><dd>{date(selected.modifiedAt)}</dd></div></dl>}
        <section><h3>{selected.missing ? "Broken links" : "Linked entries"}</h3>{selected.references.length ? selected.references.map((reference) => <Link href={`/?date=${reference.date}`} key={reference.date}>{reference.date}<span>{reference.occurrences} {reference.occurrences === 1 ? "link" : "links"}</span></Link>) : <p>This file is not linked from a saved entry.</p>}</section>
        {revisionWarning.length > 0 && <div className="attachment-delete-warning"><strong>Used by older revisions</strong><p>Restoring {revisionWarning.join(", ")} may create a broken link.</p></div>}
        <footer>{!selected.missing && <><a className="text-button" href={selected.fileUrl} target="_blank" rel="noreferrer">Open</a><a className="text-button" href={`${selected.fileUrl}&download=1`}>Download</a><span /><button className="danger-button" type="button" disabled={!online || selected.references.length > 0} title={selected.references.length ? "Remove saved entry links before deleting" : undefined} onClick={() => void remove(revisionWarning.length > 0)}>{revisionWarning.length ? "Delete anyway" : "Delete"}</button></>}</footer>
      </aside></div>}
    </div>
    </section>
  </main>;
}
