"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { remarkHashtags } from "@/lib/remark-hashtags";

const LiveMarkdownEditor = dynamic(() => import("./live-markdown-editor"), {
  ssr: false,
  loading: () => <div className="editor-loading">Opening your page…</div>,
});

type Memory = { date: string; excerpt: string; words: number };
type Entry = {
  content: string;
  exists: boolean;
  previousYears: string[];
  memories: Memory[];
  template: string;
};
type Settings = { saveFormat: string; template: string; showTagCloud: boolean; vimMode: boolean; autoSave: boolean };
type TagSummary = { name: string; count: number; dates: string[] };
type ImmichPhoto = { id: string; width: number | null; height: number | null; capturedAt: string | null };
type RevisionDiffLine = { type: "added" | "removed" | "context" | "skip"; text: string; count?: number };
type RevisionSummary = { id: number; createdAt: string; words: number; diff: { additions: number; deletions: number; lines: RevisionDiffLine[] } };
type SaveState = "saved" | "saving" | "unsaved" | "offline";
type CachedEntry = Entry & { pending: boolean; updatedAt: string };

const EMPTY_ENTRY: Entry = {
  content: "",
  exists: false,
  previousYears: [],
  memories: [],
  template: "",
};
const ENTRY_CACHE = "paralog:entry:";
const CALENDAR_CACHE = "paralog:calendar:";

const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const fromIso = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
};
const parseIso = (value: string | null) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = fromIso(value);
  return iso(date) === value ? date : null;
};
const monthKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
const displayDate = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(fromIso(value));

function keepSourceCursorVisible(textarea: HTMLTextAreaElement) {
  const viewport = window.visualViewport;
  if (!viewport || window.innerWidth > 720 || document.activeElement !== textarea) return;
  window.requestAnimationFrame(() => {
    const style = getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(style.lineHeight) || 31;
    const paddingTop = Number.parseFloat(style.paddingTop) || 0;
    const line = textarea.value.slice(0, textarea.selectionStart).split("\n").length - 1;
    const caretTop = paddingTop + line * lineHeight;
    const rect = textarea.getBoundingClientRect();
    const visibleHeight = Math.max(80, Math.min(textarea.clientHeight, viewport.offsetTop + viewport.height - Math.max(rect.top, viewport.offsetTop) - 28));
    const upperEdge = textarea.scrollTop + lineHeight;
    const lowerEdge = textarea.scrollTop + visibleHeight - lineHeight * 2;
    if (caretTop > lowerEdge) textarea.scrollTop = caretTop - visibleHeight + lineHeight * 2;
    else if (caretTop < upperEdge) textarea.scrollTop = Math.max(0, caretTop - lineHeight);
  });
}

function entryOutline(content: string) {
  let fenced = false;
  return content.split("\n").flatMap((line, index) => {
    if (/^\s*(`{3,}|~{3,})/.test(line)) { fenced = !fenced; return []; }
    if (fenced) return [];
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    return heading ? [{ line: index + 1, level: heading[1].length, text: heading[2] }] : [];
  });
}

function readCachedEntry(date: string): CachedEntry | null {
  try {
    const value = localStorage.getItem(`${ENTRY_CACHE}${date}`);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function cacheEntry(date: string, entry: Entry, pending: boolean) {
  localStorage.setItem(
    `${ENTRY_CACHE}${date}`,
    JSON.stringify({ ...entry, pending, updatedAt: new Date().toISOString() }),
  );
}

function pendingDates(month: string) {
  const dates: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(ENTRY_CACHE)) continue;
    const date = key.slice(ENTRY_CACHE.length);
    const cached = readCachedEntry(date);
    if (date.startsWith(`${month}-`) && cached?.content.trim()) dates.push(date);
  }
  return dates;
}

function Calendar({
  month,
  selected,
  savedDates,
  onMonthChange,
  onSelect,
}: {
  month: Date;
  selected: string;
  savedDates: string[];
  onMonthChange: (date: Date) => void;
  onSelect: (date: string) => void;
}) {
  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return Array.from({ length: first.getDay() + count }, (_, index) =>
      index < first.getDay()
        ? null
        : new Date(month.getFullYear(), month.getMonth(), index - first.getDay() + 1),
    );
  }, [month]);

  return (
    <section className="calendar" aria-label="Journal calendar">
      <div className="month-nav">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
        >
          <span aria-hidden="true">←</span>
        </button>
        <strong>
          {new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(month)}
        </strong>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
        >
          <span aria-hidden="true">→</span>
        </button>
      </div>
      <div className="weekdays" aria-hidden="true">
        {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
          <span key={`${day}-${index}`}>{day}</span>
        ))}
      </div>
      <div className="days">
        {days.map((day, index) =>
          day ? (
            <button
              type="button"
              key={day.toISOString()}
              aria-label={displayDate(iso(day))}
              aria-current={iso(day) === selected ? "date" : undefined}
              onClick={() => onSelect(iso(day))}
              className={`${iso(day) === selected ? "selected" : ""} ${savedDates.includes(iso(day)) ? "written" : ""}`}
            >
              {day.getDate()}
            </button>
          ) : (
            <span key={`empty-${index}`} />
          ),
        )}
      </div>
      <p className="calendar-note"><i /> Entry written</p>
    </section>
  );
}

function TagBrowser({ tags }: {
  tags: TagSummary[];
}) {
  const largest = Math.max(...tags.map((tag) => tag.count), 1);
  return <section className="tag-browser" aria-label="Journal tags">
    <div className="tag-heading"><p className="eyebrow">TAGS</p></div>
    <div className="tag-cloud">
      {tags.map((tag) => <a
        href={`/tags/${encodeURIComponent(tag.name.normalize("NFC").toLocaleLowerCase())}`}
        key={tag.name}
        style={{ "--tag-weight": String(tag.count / largest) } as React.CSSProperties}
        aria-label={`#${tag.name}, ${tag.count} ${tag.count === 1 ? "entry" : "entries"}`}
      >#{tag.name}</a>)}
    </div>
  </section>;
}

function MemoryShelf({ memories, selected, expanded, placement, onToggle, onChoose }: {
  memories: Memory[];
  selected: string;
  expanded: boolean;
  placement: "desktop" | "mobile";
  onToggle: () => void;
  onChoose: (date: string) => void;
}) {
  if (memories.length === 0) return null;
  const titleId = `memory-title-${placement}`;
  const listId = `memory-list-${placement}`;
  return <section className={`memory-shelf memory-shelf-${placement}`} aria-labelledby={titleId}>
    <div className="memory-heading"><div><p className="eyebrow">FROM YOUR ARCHIVE</p><h3 id={titleId}>This day, other years</h3></div><span>{memories.length} {memories.length === 1 ? "memory" : "memories"}</span></div>
    <div className="memory-list" id={listId}>
      {(expanded ? memories : memories.slice(0, 3)).map((memory) => {
        const yearsAgo = fromIso(selected).getFullYear() - fromIso(memory.date).getFullYear();
        return <button type="button" className="memory-card" key={memory.date} onClick={() => onChoose(memory.date)}>
          <span className="memory-year">{fromIso(memory.date).getFullYear()} <small>{yearsAgo} {yearsAgo === 1 ? "year" : "years"} ago</small></span>
          <span className="memory-excerpt">{memory.excerpt || "A quiet page from this day."}</span>
          <span className="memory-meta">{memory.words} words <b aria-hidden="true">→</b></span>
        </button>;
      })}
    </div>
    {memories.length > 3 && <button type="button" className="memory-toggle" aria-expanded={expanded} aria-controls={listId} onClick={onToggle}>
      {expanded ? "Show fewer" : `Show all ${memories.length} years`}
    </button>}
  </section>;
}

function PhotoShelf({ photos, total, selected, placement, onOpen }: {
  photos: ImmichPhoto[];
  total: number;
  selected: string;
  placement: "desktop" | "mobile";
  onOpen: (photo: ImmichPhoto) => void;
}) {
  if (photos.length === 0) return null;
  const titleId = `photo-title-${placement}`;
  const count = total === 1 ? "1 photo" : total > photos.length ? `${photos.length} of ${total} photos` : `${total} photos`;
  return <section className={`photo-shelf photo-shelf-${placement}`} aria-labelledby={titleId}>
    <div className="photo-heading"><div><p className="eyebrow">FROM IMMICH</p><h3 id={titleId}>Photos from this day</h3></div><span>{count}</span></div>
    <div className="photo-grid">
      {photos.map((photo, index) => <button type="button" className="photo-card" key={photo.id} onClick={() => onOpen(photo)} aria-label={`Open photo ${index + 1} from ${displayDate(selected)} larger`}>
        <img
          src={`/api/immich/thumbnail/${encodeURIComponent(photo.id)}`}
          alt=""
          width={photo.width || 640}
          height={photo.height || 480}
          loading="lazy"
          decoding="async"
        />
      </button>)}
    </div>
  </section>;
}

export default function Journal() {
  const today = useMemo(() => iso(new Date()), []);
  const [selected, setSelected] = useState(today);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [entry, setEntry] = useState<Entry>(EMPTY_ENTRY);
  const [savedDates, setSavedDates] = useState<string[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [dirty, setDirty] = useState(false);
  const [view, setView] = useState<"rich" | "source" | "preview">("rich");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tags, setTags] = useState<TagSummary[]>([]);
  const [photos, setPhotos] = useState<ImmichPhoto[]>([]);
  const [photoTotal, setPhotoTotal] = useState(0);
  const [openPhoto, setOpenPhoto] = useState<ImmichPhoto | null>(null);
  const [showOutline, setShowOutline] = useState(false);
  const [showRevisions, setShowRevisions] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [outlineJump, setOutlineJump] = useState<number | null>(null);
  const [revisions, setRevisions] = useState<RevisionSummary[]>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showAllMemories, setShowAllMemories] = useState(false);
  const [dark, setDark] = useState(false);
  const [themeReady, setThemeReady] = useState(false);
  const [online, setOnline] = useState(true);
  const [loading, setLoading] = useState(true);
  const [remoteUpdate, setRemoteUpdate] = useState<Entry | null>(null);
  const selectedRef = useRef(selected);
  const entryRef = useRef(entry);
  const dirtyRef = useRef(dirty);
  const saveStateRef = useRef(saveState);
  const serverContentRef = useRef<string | null>(null);
  const photoSwipeStartRef = useRef<number | null>(null);
  const sourceEditorRef = useRef<HTMLTextAreaElement | null>(null);
  selectedRef.current = selected;
  entryRef.current = entry;
  dirtyRef.current = dirty;
  saveStateRef.current = saveState;
  const outline = useMemo(() => entryOutline(entry.content), [entry.content]);
  const writingStats = useMemo(() => {
    const trimmed = entry.content.trim();
    const words = trimmed ? trimmed.split(/\s+/).length : 0;
    return { words, characters: entry.content.length, paragraphs: trimmed ? trimmed.split(/\n\s*\n/).length : 0, minutes: words ? Math.max(1, Math.ceil(words / 220)) : 0 };
  }, [entry.content]);
  const handleJumpHandled = useCallback(() => setOutlineJump(null), []);

  const moveOpenPhoto = useCallback((offset: number) => {
    setOpenPhoto((current) => {
      if (!current || photos.length < 2) return current;
      const index = photos.findIndex((photo) => photo.id === current.id);
      return photos[(Math.max(index, 0) + offset + photos.length) % photos.length];
    });
  }, [photos]);

  const applyRemoteEntry = useCallback((date: string, remote: Entry) => {
    if (date !== selectedRef.current || remote.content === serverContentRef.current) return;
    serverContentRef.current = remote.content;
    if (dirtyRef.current || ["saving", "unsaved", "offline"].includes(saveStateRef.current)) {
      setRemoteUpdate(remote);
      return;
    }
    cacheEntry(date, remote, false);
    setEntry(remote);
    setSaveState("saved");
  }, []);

  const refreshRemote = useCallback(async (date: string) => {
    if (!navigator.onLine) return;
    try {
      const response = await fetch(`/api/entries?date=${date}`, { cache: "no-store" });
      if (!response.ok) return;
      applyRemoteEntry(date, await response.json());
    } catch {
      // Regular offline handling owns the connection state.
    }
  }, [applyRemoteEntry]);

  const loadTags = useCallback(async () => {
    try {
      const response = await fetch("/api/tags", { cache: "no-store" });
      if (response.ok) setTags((await response.json()).tags);
    } catch {
      // Keep the last cloud available when offline.
    }
  }, []);

  const loadMonth = useCallback(async (date: Date) => {
    const key = monthKey(date);
    const cached = localStorage.getItem(`${CALENDAR_CACHE}${key}`);
    if (cached) {
      try { setSavedDates([...new Set([...JSON.parse(cached), ...pendingDates(key)])]); } catch { /* Ignore stale cache. */ }
    } else setSavedDates(pendingDates(key));

    try {
      const response = await fetch(`/api/calendar?month=${key}`);
      if (!response.ok) return;
      const dates: string[] = (await response.json()).dates;
      const merged = [...new Set([...dates, ...pendingDates(key)])];
      localStorage.setItem(`${CALENDAR_CACHE}${key}`, JSON.stringify(merged));
      setSavedDates(merged);
    } catch {
      // The cached calendar remains usable offline.
    }
  }, []);

  const persistEntry = useCallback(async (date: string, content: string, current: Entry) => {
    const draft = { ...current, content, exists: Boolean(content.trim()) || current.exists };
    cacheEntry(date, draft, true);
    if (date === selected) setSaveState(navigator.onLine ? "saving" : "offline");
    setSavedDates((dates) => content.trim() ? [...new Set([...dates, date])] : dates);

    if (!navigator.onLine) return false;
    try {
      const response = await fetch(`/api/entries?date=${date}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!response.ok) throw new Error("Save failed");
      cacheEntry(date, draft, false);
      if (date === selected) {
        serverContentRef.current = content;
        setEntry((value) => ({ ...value, exists: true }));
        setSaveState("saved");
        setDirty(false);
        setRemoteUpdate(null);
      }
      return true;
    } catch {
      if (date === selected) setSaveState("offline");
      return false;
    }
  }, [selected]);

  const loadEntry = useCallback(async (date: string, signal?: AbortSignal) => {
    setLoading(true);
    const cached = readCachedEntry(date);
    if (cached) {
      setEntry(cached);
      setSaveState(cached.pending ? (navigator.onLine ? "unsaved" : "offline") : "saved");
    } else {
      setEntry(EMPTY_ENTRY);
      setSaveState("saved");
    }
    setDirty(false);

    try {
      const response = await fetch(`/api/entries?date=${date}`, { signal });
      if (!response.ok) return;
      const remote: Entry = await response.json();
      serverContentRef.current = remote.content;
      const pending = readCachedEntry(date);
      const next = pending?.pending
        ? { ...remote, content: pending.content, exists: pending.exists || remote.exists }
        : remote;
      cacheEntry(date, next, Boolean(pending?.pending));
      setEntry(next);
      setSaveState(pending?.pending ? "unsaved" : "saved");
    } catch {
      if (!cached) setSaveState("offline");
    } finally {
      setLoading(false);
    }
  }, []);

  const syncPending = useCallback(async () => {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((key): key is string => Boolean(key?.startsWith(ENTRY_CACHE)));
    for (const key of keys) {
      const date = key.slice(ENTRY_CACHE.length);
      const cached = readCachedEntry(date);
      if (!cached?.pending) continue;
      await persistEntry(date, cached.content, cached);
    }
    await loadMonth(month);
  }, [loadMonth, month, persistEntry]);

  useEffect(() => {
    const savedTheme = localStorage.getItem("paralog-theme");
    setDark(savedTheme === "dark" || (!savedTheme && matchMedia("(prefers-color-scheme: dark)").matches));
    setThemeReady(true);
    setOnline(navigator.onLine);
    fetch("/api/settings").then((response) => response.ok ? response.json() : null).then(setSettings).catch(() => undefined);
    loadTags();
  }, [loadTags]);

  useEffect(() => {
    if (!themeReady) return;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("paralog-theme", dark ? "dark" : "light");
  }, [dark, themeReady]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    let frame = 0;
    let baselineHeight = Math.max(window.innerHeight, root.clientHeight);
    const updateKeyboardInset = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const currentLayoutHeight = Math.max(window.innerHeight, root.clientHeight);
        baselineHeight = Math.max(baselineHeight, currentLayoutHeight);
        const measuredInset = Math.max(0, Math.round(baselineHeight - viewport.height - viewport.offsetTop));
        const overlayInset = Math.max(0, Math.round(currentLayoutHeight - viewport.height - viewport.offsetTop));
        const keyboardInset = measuredInset > 80 ? measuredInset : 0;
        root.style.setProperty("--mobile-keyboard-height", `${keyboardInset}px`);
        root.style.setProperty("--mobile-keyboard-offset", `${overlayInset > 80 ? overlayInset : 0}px`);
        root.toggleAttribute("data-mobile-keyboard", keyboardInset > 0);
        window.dispatchEvent(new CustomEvent("paralog:keyboard-viewport", { detail: { keyboardInset } }));
        if (keyboardInset > 0 && document.activeElement instanceof HTMLTextAreaElement && document.activeElement.classList.contains("source-editor")) {
          document.activeElement.scrollIntoView({ block: "nearest" });
          keepSourceCursorVisible(document.activeElement);
        }
      });
    };
    updateKeyboardInset();
    viewport.addEventListener("resize", updateKeyboardInset);
    viewport.addEventListener("scroll", updateKeyboardInset);
    const handleOrientation = () => {
      baselineHeight = Math.max(window.innerHeight, root.clientHeight);
      updateKeyboardInset();
    };
    window.addEventListener("orientationchange", handleOrientation);
    return () => {
      window.cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", updateKeyboardInset);
      viewport.removeEventListener("scroll", updateKeyboardInset);
      window.removeEventListener("orientationchange", handleOrientation);
      root.style.removeProperty("--mobile-keyboard-height");
      root.style.removeProperty("--mobile-keyboard-offset");
      root.removeAttribute("data-mobile-keyboard");
    };
  }, []);

  useEffect(() => {
    if (!showCalendar && !showSettings && !showRevisions && !openPhoto) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowCalendar(false);
        setShowSettings(false);
        setShowRevisions(false);
        setOpenPhoto(null);
      } else if (openPhoto && event.key === "ArrowLeft") {
        event.preventDefault();
        moveOpenPhoto(-1);
      } else if (openPhoto && event.key === "ArrowRight") {
        event.preventDefault();
        moveOpenPhoto(1);
      }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [moveOpenPhoto, openPhoto, showCalendar, showRevisions, showSettings]);

  useEffect(() => {
    if (!focusMode) return;
    const leaveFocus = (event: KeyboardEvent) => { if (event.key === "Escape") setFocusMode(false); };
    window.addEventListener("keydown", leaveFocus);
    return () => window.removeEventListener("keydown", leaveFocus);
  }, [focusMode]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") { refreshRemote(selected); loadTags(); }
    };
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadTags, refreshRemote, selected]);

  useEffect(() => {
    if (!online) return;
    const events = new EventSource("/api/entries/events");
    events.onopen = () => refreshRemote(selectedRef.current);
    events.onmessage = (event) => {
      try {
        const change = JSON.parse(event.data) as { date?: string };
        loadTags();
        if (change.date === selectedRef.current) refreshRemote(change.date);
      } catch {
        // Ignore malformed events and let EventSource reconnect normally.
      }
    };
    return () => events.close();
  }, [loadTags, online, refreshRemote]);

  useEffect(() => {
    const handleOnline = () => { setOnline(true); syncPending(); };
    const handleOffline = () => { setOnline(false); setSaveState((state) => state === "saved" ? state : "offline"); };
    if (navigator.onLine) syncPending();
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => { window.removeEventListener("online", handleOnline); window.removeEventListener("offline", handleOffline); };
  }, [syncPending]);

  useEffect(() => {
    const dateFromUrl = () => new URLSearchParams(window.location.search).get("date");
    const initial = dateFromUrl();
    if (parseIso(initial)) {
      setSelected(initial!);
      setMonth(new Date(fromIso(initial!).getFullYear(), fromIso(initial!).getMonth(), 1));
    } else window.history.replaceState({ date: today }, "", `?date=${today}`);

    const onPopState = () => {
      const date = dateFromUrl();
      const parsed = parseIso(date);
      const next = parsed ? date! : today;
      if (!parsed) window.history.replaceState({ date: today }, "", `?date=${today}`);
      setSelected(next);
      setMonth(new Date(fromIso(next).getFullYear(), fromIso(next).getMonth(), 1));
      setView("rich");
      setShowCalendar(false);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [today]);

  useEffect(() => {
    const controller = new AbortController();
    serverContentRef.current = null;
    setRemoteUpdate(null);
    setShowAllMemories(false);
    loadEntry(selected, controller.signal);
    return () => controller.abort();
  }, [loadEntry, selected]);

  useEffect(() => {
    const controller = new AbortController();
    setPhotos([]);
    setPhotoTotal(0);
    setOpenPhoto(null);
    if (!navigator.onLine) return () => controller.abort();
    fetch(`/api/immich?date=${selected}`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((result) => {
        if (!result?.configured || !Array.isArray(result.photos)) return;
        setPhotos(result.photos);
        setPhotoTotal(typeof result.total === "number" ? result.total : result.photos.length);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [selected]);

  useEffect(() => { loadMonth(month); }, [loadMonth, month]);

  useEffect(() => {
    if (!settings?.autoSave || !dirty || remoteUpdate) return;
    const timer = window.setTimeout(() => persistEntry(selected, entry.content, entry), 850);
    return () => window.clearTimeout(timer);
  }, [dirty, entry, persistEntry, remoteUpdate, selected, settings?.autoSave]);

  useEffect(() => {
    const saveWithKeyboard = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "s" || (!event.ctrlKey && !event.metaKey) || event.altKey) return;
      event.preventDefault();
      if (loading || saveStateRef.current === "saving") return;
      void persistEntry(selectedRef.current, entryRef.current.content, entryRef.current);
    };
    window.addEventListener("keydown", saveWithKeyboard);
    return () => window.removeEventListener("keydown", saveWithKeyboard);
  }, [loading, persistEntry]);

  const resizeSourceEditor = useCallback((target?: HTMLTextAreaElement | null) => {
    const editor = target ?? sourceEditorRef.current;
    if (!editor) return;
    if (CSS.supports("field-sizing", "content")) {
      editor.style.height = "";
      return;
    }
    editor.style.height = "auto";
    editor.style.height = `${editor.scrollHeight}px`;
  }, []);

  useEffect(() => {
    if (view !== "source") return;
    const frame = window.requestAnimationFrame(() => resizeSourceEditor());
    return () => window.cancelAnimationFrame(frame);
  }, [entry.content, resizeSourceEditor, view]);

  useEffect(() => {
    if (view !== "source") return;
    const editor = sourceEditorRef.current;
    if (!editor) return;
    let width = editor.getBoundingClientRect().width;
    const observer = new ResizeObserver(([entry]) => {
      const nextWidth = entry.contentRect.width;
      if (Math.abs(nextWidth - width) < 0.5) return;
      width = nextWidth;
      resizeSourceEditor(editor);
    });
    observer.observe(editor);
    return () => observer.disconnect();
  }, [resizeSourceEditor, view]);

  function changeContent(content: string) {
    setEntry((current) => ({ ...current, content }));
    setDirty(true);
    setSaveState("unsaved");
  }

  function choose(date: string, updateHistory = true) {
    if (dirty) persistEntry(selected, entry.content, entry);
    if (date === selected) {
      const current = fromIso(date);
      setMonth(new Date(current.getFullYear(), current.getMonth(), 1));
      setShowCalendar(false);
      return;
    }
    setSelected(date);
    setMonth(new Date(fromIso(date).getFullYear(), fromIso(date).getMonth(), 1));
    setView("rich");
    setShowCalendar(false);
    if (updateHistory) window.history.pushState({ date }, "", `?date=${date}`);
  }

  function moveDay(offset: number) {
    const date = fromIso(selected);
    date.setDate(date.getDate() + offset);
    choose(iso(date));
  }

  async function uploadFile(file: File) {
    if (!navigator.onLine) { setSaveState("offline"); return null; }
    const data = new FormData();
    data.append("file", file);
    const response = await fetch("/api/uploads", { method: "POST", body: data });
    if (!response.ok) return null;
    const uploaded = await response.json();
    const url = `/api/files?path=${encodeURIComponent(uploaded.path)}`;
    const label = String(uploaded.name).replace(/([\\\[\]])/g, "\\$1");
    return uploaded.type.startsWith("image/")
      ? `![${label}](${url})`
      : `[${label}](${url})`;
  }

  async function upload(file: File) {
    const markdown = await uploadFile(file);
    if (!markdown) return;
    changeContent(`${entry.content}${entry.content && !entry.content.endsWith("\n") ? "\n" : ""}${markdown}\n`);
  }

  async function openRevisions() {
    setShowRevisions(true);
    setRevisionsLoading(true);
    try {
      const response = await fetch(`/api/revisions?date=${selected}`, { cache: "no-store" });
      if (response.ok) setRevisions((await response.json()).revisions);
    } finally {
      setRevisionsLoading(false);
    }
  }

  async function restoreRevision(id: number) {
    const response = await fetch(`/api/revisions/${id}?date=${selected}`, { cache: "no-store" });
    if (!response.ok) return;
    const revision = await response.json();
    changeContent(revision.content);
    setShowRevisions(false);
  }

  async function persistSettings() {
    if (!settings || !navigator.onLine) return;
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    if (response.ok) { setSettings(await response.json()); setShowSettings(false); }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_PRIVATE" });
    location.reload();
  }

  function acceptRemoteUpdate() {
    if (!remoteUpdate) return;
    cacheEntry(selected, remoteUpdate, false);
    serverContentRef.current = remoteUpdate.content;
    setEntry(remoteUpdate);
    setDirty(false);
    setSaveState("saved");
    setRemoteUpdate(null);
  }

  function keepLocalUpdate() {
    setRemoteUpdate(null);
    persistEntry(selected, entry.content, entry);
  }

  const statusCopy: Record<SaveState, string> = {
    saved: "Saved",
    saving: "Saving…",
    unsaved: "Unsaved",
    offline: "Saved offline",
  };
  const sourceEditor = (
    <textarea
      ref={sourceEditorRef}
      className="source-editor"
      value={entry.content}
      onChange={(event) => { changeContent(event.target.value); resizeSourceEditor(event.currentTarget); keepSourceCursorVisible(event.currentTarget); }}
      onFocus={(event) => keepSourceCursorVisible(event.currentTarget)}
      onSelect={(event) => keepSourceCursorVisible(event.currentTarget)}
      placeholder="What’s on your mind?"
      autoFocus
    />
  );
  const rendered = (
    <article className="preview"><ReactMarkdown remarkPlugins={[remarkHashtags]}>{entry.content || "*Nothing here yet.*"}</ReactMarkdown></article>
  );

  return (
    <main className={`app-shell ${focusMode ? "focus-mode" : ""}`}>
      <aside className="sidebar">
        <div className="brand"><p className="eyebrow">PRIVATE JOURNAL</p><h1>Paralog</h1></div>
        <button className="today-button" type="button" onClick={() => choose(today)}><span>Today</span><b aria-hidden="true">↗</b></button>
        <Calendar month={month} selected={selected} savedDates={savedDates} onMonthChange={setMonth} onSelect={choose} />
        {settings?.showTagCloud && tags.length > 0 && <TagBrowser tags={tags} />}
        <div className="side-actions">
          <button type="button" onClick={() => setDark(!dark)}><span className="action-icon" aria-hidden="true">{dark ? "☀" : "◐"}</span><span className="action-label">{dark ? "Light mode" : "Dark mode"}</span></button>
          <button type="button" onClick={() => setShowSettings(true)}><span className="action-icon" aria-hidden="true">⚙</span><span className="action-label">Settings</span></button>
          <button type="button" onClick={signOut}><span className="action-icon" aria-hidden="true">↪</span><span className="action-label">Sign out</span></button>
        </div>
      </aside>

      <nav className="mobile-bar" aria-label="Journal navigation">
        <button className="mobile-brand" type="button" onClick={() => choose(today)}>Paralog</button>
        <div>
          <button type="button" onClick={() => choose(today)} aria-label="Go to today">Today</button>
          <button type="button" onClick={() => setShowCalendar(true)} aria-label="Open calendar"><span aria-hidden="true">▦</span></button>
          <button type="button" onClick={() => setDark(!dark)} aria-label={dark ? "Use light mode" : "Use dark mode"}><span aria-hidden="true">{dark ? "☀" : "◐"}</span></button>
          <button type="button" onClick={() => setShowSettings(true)} aria-label="Open settings"><span aria-hidden="true">⚙</span></button>
        </div>
      </nav>

      <section className="journal-page">
        {!online && <div className="offline-banner"><span>Offline</span> Keep writing — changes will sync when you reconnect.</div>}
        {remoteUpdate && <section className="sync-conflict" role="alert">
          <div><strong>This entry changed somewhere else.</strong><span>Choose which version to keep before continuing.</span></div>
          <div><button type="button" className="text-button" onClick={keepLocalUpdate}>Keep mine</button><button type="button" className="save-button" onClick={acceptRemoteUpdate}>Load newer version</button></div>
        </section>}
        <header className="entry-header">
          <div className="date-navigation">
            <button type="button" onClick={() => moveDay(-1)} aria-label="Previous day"><span aria-hidden="true">←</span></button>
            <div><p className="eyebrow">JOURNAL ENTRY</p><h2>{displayDate(selected)}</h2></div>
            <button type="button" onClick={() => moveDay(1)} aria-label="Next day"><span aria-hidden="true">→</span></button>
          </div>
          <div className="header-actions">
            <span className={`save-status ${saveState}`} aria-live="polite"><i />{statusCopy[saveState]}</span>
            <label className={`upload-button ${!online ? "disabled" : ""}`}>＋ Attach<input type="file" disabled={!online} onChange={(event) => event.target.files?.[0] && upload(event.target.files[0])} /></label>
            <button className="save-button" type="button" title="Save entry (Ctrl+S or Cmd+S)" onClick={() => persistEntry(selected, entry.content, entry)} disabled={saveState === "saving"}>{saveState === "saving" ? "Saving…" : "Save now"}</button>
          </div>
        </header>

        <div className="entry-workspace">
        <div className="entry-editor-column">
        <div className="editor-tabs" role="tablist" aria-label="Editor mode">
          <button type="button" role="tab" aria-selected={view === "rich"} className={view === "rich" ? "active" : ""} onClick={() => setView("rich")}>Editor</button>
          <button type="button" role="tab" aria-selected={view === "source"} className={view === "source" ? "active" : ""} onClick={() => setView("source")}>Markdown</button>
          <button type="button" role="tab" aria-selected={view === "preview"} className={view === "preview" ? "active" : ""} onClick={() => setView("preview")}>Read</button>
          <span>{loading ? "Loading…" : `Markdown · autosave ${settings?.autoSave === false ? "off" : "on"}`}</span>
        </div>
        <div className="editor-utility-bar" aria-label="Entry tools">
          <button type="button" onClick={() => { setShowOutline((value) => !value); setShowStats(false); }} disabled={outline.length === 0}>Outline{outline.length ? ` · ${outline.length}` : ""}</button>
          <button type="button" onClick={openRevisions}>Versions</button>
          <button type="button" onClick={() => { setShowStats((value) => !value); setShowOutline(false); }}>{writingStats.words} {writingStats.words === 1 ? "word" : "words"}</button>
          <button type="button" onClick={() => setFocusMode((value) => !value)}>{focusMode ? "Exit focus" : "Focus"}</button>
        </div>
        {showOutline && <nav className="editor-popover outline-panel" aria-label="Entry outline">
          {outline.map((heading) => <button type="button" key={`${heading.line}-${heading.text}`} style={{ "--outline-level": heading.level } as React.CSSProperties} onClick={() => { setView("rich"); setOutlineJump(heading.line); setShowOutline(false); }}>{heading.text}</button>)}
        </nav>}
        {showStats && <section className="editor-popover stats-panel" aria-label="Writing statistics">
          <span><b>{writingStats.words}</b> words</span><span><b>{writingStats.characters}</b> characters</span><span><b>{writingStats.paragraphs}</b> paragraphs</span><span><b>{writingStats.minutes}</b> min read</span>
        </section>}

        {!entry.exists && !entry.content && entry.template && (
          <button className="template-button" type="button" onClick={() => changeContent(entry.template)}>Start with your template →</button>
        )}
        <div className={`editor-frame ${loading ? "loading" : ""}`}>
          {view === "preview" ? rendered : view === "source" ? sourceEditor : <LiveMarkdownEditor markdown={entry.content} onChange={changeContent} onUpload={uploadFile} template={entry.template} jumpToLine={outlineJump} onJumpHandled={handleJumpHandled} vimMode={Boolean(settings?.vimMode)} />}
        </div>
        </div>
        <aside className="entry-context-column" aria-label="Photos and archive memories">
        <PhotoShelf photos={photos} total={photoTotal} selected={selected} placement="desktop" onOpen={setOpenPhoto} />
        <MemoryShelf memories={entry.memories} selected={selected} expanded={showAllMemories} placement="desktop" onToggle={() => setShowAllMemories((current) => !current)} onChoose={choose} />
        </aside>
        </div>
        <PhotoShelf photos={photos} total={photoTotal} selected={selected} placement="mobile" onOpen={setOpenPhoto} />
        <MemoryShelf memories={entry.memories} selected={selected} expanded={showAllMemories} placement="mobile" onToggle={() => setShowAllMemories((current) => !current)} onChoose={choose} />
      </section>

      {showCalendar && (
        <div className="sheet-backdrop" role="presentation" onClick={() => setShowCalendar(false)}>
          <section className="calendar-sheet" role="dialog" aria-modal="true" aria-label="Choose a journal date" onClick={(event) => event.stopPropagation()}>
            <div className="sheet-header"><div><p className="eyebrow">BROWSE JOURNAL</p><h3>Choose a day</h3></div><button type="button" onClick={() => setShowCalendar(false)} aria-label="Close calendar">×</button></div>
            <Calendar month={month} selected={selected} savedDates={savedDates} onMonthChange={setMonth} onSelect={choose} />
            {settings?.showTagCloud && tags.length > 0 && <TagBrowser tags={tags} />}
          </section>
        </div>
      )}

      {showSettings && settings && (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowSettings(false)}>
          <section className="settings" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(event) => event.stopPropagation()}>
            <div className="settings-title"><div><p className="eyebrow">PREFERENCES</p><h2 id="settings-title">Journal settings</h2></div><button type="button" onClick={() => setShowSettings(false)} aria-label="Close settings">×</button></div>
            <label>Save format<small>Tokens: YYYY, MM, MMMM, DD, dddd. Existing files stay where they are.</small><input value={settings.saveFormat} onChange={(event) => setSettings({ ...settings, saveFormat: event.target.value })} /></label>
            <label>New entry template<small>Use any Markdown you want as a starting point.</small><textarea value={settings.template} onChange={(event) => setSettings({ ...settings, template: event.target.value })} /></label>
            <label className="toggle-setting"><input type="checkbox" checked={settings.showTagCloud} onChange={(event) => setSettings({ ...settings, showTagCloud: event.target.checked })} /><span><b>Show tag cloud</b><small>Collect hashtags from your entries in the desktop sidebar and mobile calendar.</small></span></label>
            <label className="toggle-setting"><input type="checkbox" checked={settings.autoSave} onChange={(event) => setSettings({ ...settings, autoSave: event.target.checked })} /><span><b>Automatically save entries</b><small>Save after you pause typing. You can always save immediately with Ctrl+S or Cmd+S.</small></span></label>
            <label className="toggle-setting"><input type="checkbox" checked={settings.vimMode} onChange={(event) => setSettings({ ...settings, vimMode: event.target.checked })} /><span><b>Vim keybindings</b><small>Enable Normal, Insert, and Visual modes in the Live Preview editor on desktop. Mobile always uses standard editing.</small></span></label>
            <div className="settings-actions"><button className="text-button" type="button" onClick={signOut}>Sign out</button><button className="save-button" type="button" onClick={persistSettings} disabled={!online}>Save settings</button></div>
          </section>
        </div>
      )}

      {showRevisions && <div className="modal-backdrop" role="presentation" onClick={() => setShowRevisions(false)}>
        <section className="revisions-panel" role="dialog" aria-modal="true" aria-labelledby="revisions-title" onClick={(event) => event.stopPropagation()}>
          <div className="settings-title"><div><p className="eyebrow">ENTRY HISTORY</p><h2 id="revisions-title">Previous versions</h2></div><button type="button" onClick={() => setShowRevisions(false)} aria-label="Close versions">×</button></div>
          {revisionsLoading ? <p className="panel-empty">Loading versions…</p> : revisions.length === 0 ? <p className="panel-empty">No previous versions yet. Paralog creates one when saved content changes.</p> : <div className="revision-list">
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
              <button type="button" onClick={() => restoreRevision(revision.id)}>Restore this version</button>
            </article>)}
          </div>}
        </section>
      </div>}

      {openPhoto && <div className="photo-lightbox-backdrop" role="presentation" onClick={() => setOpenPhoto(null)}>
        <section
          className="photo-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`Large photo from ${displayDate(selected)}`}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => {
            if (event.pointerType === "mouse" && event.button !== 0) return;
            photoSwipeStartRef.current = event.clientX;
          }}
          onPointerUp={(event) => {
            const start = photoSwipeStartRef.current;
            photoSwipeStartRef.current = null;
            if (start === null || photos.length < 2) return;
            const distance = event.clientX - start;
            if (Math.abs(distance) >= 48) moveOpenPhoto(distance < 0 ? 1 : -1);
          }}
          onPointerCancel={() => { photoSwipeStartRef.current = null; }}
        >
          <button type="button" className="photo-lightbox-close" onClick={() => setOpenPhoto(null)} aria-label="Close photo">×</button>
          <img src={`/api/immich/thumbnail/${encodeURIComponent(openPhoto.id)}`} alt={`Photo from ${displayDate(selected)}`} draggable={false} />
          {photos.length > 1 && <>
            <button type="button" className="photo-lightbox-nav previous" onClick={() => moveOpenPhoto(-1)} aria-label="Previous photo">←</button>
            <span className="photo-lightbox-position" aria-live="polite">{photos.findIndex((photo) => photo.id === openPhoto.id) + 1} / {photos.length}</span>
            <button type="button" className="photo-lightbox-nav next" onClick={() => moveOpenPhoto(1)} aria-label="Next photo">→</button>
          </>}
        </section>
      </div>}
    </main>
  );
}
