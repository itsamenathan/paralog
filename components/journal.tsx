"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

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
type Settings = { saveFormat: string; template: string };
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
  const [showSettings, setShowSettings] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
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
  selectedRef.current = selected;
  entryRef.current = entry;
  dirtyRef.current = dirty;
  saveStateRef.current = saveState;

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
  }, []);

  useEffect(() => {
    if (!themeReady) return;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("paralog-theme", dark ? "dark" : "light");
  }, [dark, themeReady]);

  useEffect(() => {
    if (!showCalendar && !showSettings) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setShowCalendar(false);
      setShowSettings(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [showCalendar, showSettings]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") refreshRemote(selected);
    };
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refreshRemote, selected]);

  useEffect(() => {
    if (!online) return;
    const events = new EventSource("/api/entries/events");
    events.onopen = () => refreshRemote(selectedRef.current);
    events.onmessage = (event) => {
      try {
        const change = JSON.parse(event.data) as { date?: string };
        if (change.date === selectedRef.current) refreshRemote(change.date);
      } catch {
        // Ignore malformed events and let EventSource reconnect normally.
      }
    };
    return () => events.close();
  }, [online, refreshRemote]);

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
    loadEntry(selected, controller.signal);
    return () => controller.abort();
  }, [loadEntry, selected]);

  useEffect(() => { loadMonth(month); }, [loadMonth, month]);

  useEffect(() => {
    if (!dirty || remoteUpdate) return;
    const timer = window.setTimeout(() => persistEntry(selected, entry.content, entry), 850);
    return () => window.clearTimeout(timer);
  }, [dirty, entry, persistEntry, remoteUpdate, selected]);

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

  async function upload(file: File) {
    if (!navigator.onLine) { setSaveState("offline"); return; }
    const data = new FormData();
    data.append("file", file);
    const response = await fetch("/api/uploads", { method: "POST", body: data });
    if (!response.ok) return;
    const uploaded = await response.json();
    const url = `/api/files?path=${encodeURIComponent(uploaded.path)}`;
    const markdown = uploaded.type.startsWith("image/")
      ? `![${uploaded.name}](${url})`
      : `[${uploaded.name}](${url})`;
    changeContent(`${entry.content}${entry.content && !entry.content.endsWith("\n") ? "\n" : ""}${markdown}\n`);
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
    <textarea className="source-editor" value={entry.content} onChange={(event) => changeContent(event.target.value)} placeholder="What’s on your mind?" autoFocus />
  );
  const rendered = (
    <article className="preview"><ReactMarkdown>{entry.content || "*Nothing here yet.*"}</ReactMarkdown></article>
  );

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><p className="eyebrow">PRIVATE JOURNAL</p><h1>Paralog</h1></div>
        <button className="today-button" type="button" onClick={() => choose(today)}><span>Today</span><b aria-hidden="true">↗</b></button>
        <Calendar month={month} selected={selected} savedDates={savedDates} onMonthChange={setMonth} onSelect={choose} />
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
            <button className="save-button" type="button" onClick={() => persistEntry(selected, entry.content, entry)} disabled={saveState === "saving"}>{saveState === "saving" ? "Saving…" : "Save now"}</button>
          </div>
        </header>

        {entry.memories.length > 0 && (
          <section className="memory-shelf" aria-labelledby="memory-title">
            <div className="memory-heading"><div><p className="eyebrow">FROM YOUR ARCHIVE</p><h3 id="memory-title">This day, other years</h3></div><span>{entry.memories.length} {entry.memories.length === 1 ? "memory" : "memories"}</span></div>
            <div className="memory-list">
              {entry.memories.map((memory) => {
                const yearsAgo = fromIso(selected).getFullYear() - fromIso(memory.date).getFullYear();
                return <button type="button" className="memory-card" key={memory.date} onClick={() => choose(memory.date)}>
                  <span className="memory-year">{fromIso(memory.date).getFullYear()} <small>{yearsAgo} {yearsAgo === 1 ? "year" : "years"} ago</small></span>
                  <span className="memory-excerpt">{memory.excerpt || "A quiet page from this day."}</span>
                  <span className="memory-meta">{memory.words} words <b>Open →</b></span>
                </button>;
              })}
            </div>
          </section>
        )}

        <div className="editor-tabs" role="tablist" aria-label="Editor mode">
          <button type="button" role="tab" aria-selected={view === "rich"} className={view === "rich" ? "active" : ""} onClick={() => setView("rich")}>Editor</button>
          <button type="button" role="tab" aria-selected={view === "source"} className={view === "source" ? "active" : ""} onClick={() => setView("source")}>Markdown</button>
          <button type="button" role="tab" aria-selected={view === "preview"} className={view === "preview" ? "active" : ""} onClick={() => setView("preview")}>Read</button>
          <span>{loading ? "Loading…" : "Markdown · autosave on"}</span>
        </div>

        {!entry.exists && !entry.content && entry.template && (
          <button className="template-button" type="button" onClick={() => changeContent(entry.template)}>Start with your template →</button>
        )}
        <div className={`editor-frame ${loading ? "loading" : ""}`}>
          {view === "preview" ? rendered : view === "source" ? sourceEditor : <LiveMarkdownEditor markdown={entry.content} onChange={changeContent} />}
        </div>
      </section>

      {showCalendar && (
        <div className="sheet-backdrop" role="presentation" onClick={() => setShowCalendar(false)}>
          <section className="calendar-sheet" role="dialog" aria-modal="true" aria-label="Choose a journal date" onClick={(event) => event.stopPropagation()}>
            <div className="sheet-header"><div><p className="eyebrow">BROWSE JOURNAL</p><h3>Choose a day</h3></div><button type="button" onClick={() => setShowCalendar(false)} aria-label="Close calendar">×</button></div>
            <Calendar month={month} selected={selected} savedDates={savedDates} onMonthChange={setMonth} onSelect={choose} />
          </section>
        </div>
      )}

      {showSettings && settings && (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowSettings(false)}>
          <section className="settings" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(event) => event.stopPropagation()}>
            <div className="settings-title"><div><p className="eyebrow">PREFERENCES</p><h2 id="settings-title">Journal settings</h2></div><button type="button" onClick={() => setShowSettings(false)} aria-label="Close settings">×</button></div>
            <label>Save format<small>Tokens: YYYY, MM, MMMM, DD, dddd. Existing files stay where they are.</small><input value={settings.saveFormat} onChange={(event) => setSettings({ ...settings, saveFormat: event.target.value })} /></label>
            <label>New entry template<small>Use any Markdown you want as a starting point.</small><textarea value={settings.template} onChange={(event) => setSettings({ ...settings, template: event.target.value })} /></label>
            <div className="settings-actions"><button className="text-button" type="button" onClick={signOut}>Sign out</button><button className="save-button" type="button" onClick={persistSettings} disabled={!online}>Save settings</button></div>
          </section>
        </div>
      )}
    </main>
  );
}
