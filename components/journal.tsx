"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkJournalReferences } from "@/lib/markdown-references";
import { journalWordCount, markdownBody, setLocationFrontMatter } from "@/lib/front-matter";
import { entryMap, mergeCalendarEntries, type CalendarEntry } from "@/lib/calendar-entries";
import type { DayPhoto, DaySummaryActivity } from "@/lib/day-activity-types";
import { DEFAULT_WIDGET_LAYOUT } from "@/lib/widget-layout";
import { DEFAULT_WIDGET_SETTINGS } from "@/lib/widget-settings";
import { ActivityWidget } from "./widgets/activity-widget";
import { ArchiveWidget } from "./widgets/archive-widget";
import { displayDate, fromIso, iso, monthKey } from "./widgets/date-utils";
import { ImmichWidget, immichImageUrl } from "./widgets/immich-widget";
import { ReferencesWidget } from "./widgets/references-widget";
import type { Memory, WidgetPlacement } from "./widgets/types";
import { WordCalendarWidget } from "./widgets/word-calendar-widget";
import { WritingStatsWidget } from "./widgets/writing-stats-widget";
import { SearchWidget } from "./widgets/search-widget";
import { RandomMemoryWidget } from "./widgets/random-memory-widget";
import { PhotoLightbox } from "./journal/photo-lightbox";
import { RevisionsDialog } from "./journal/revisions-dialog";
import { SettingsDialog } from "./journal/settings-dialog";
import { unsubscribeCurrentDevice } from "./journal/notification-preferences";
import { useDayContext } from "./journal/use-day-context";
import { useJournalReferences } from "./journal/use-journal-references";
import { useRandomMemory } from "./journal/use-random-memory";
import { useTheme } from "./journal/use-theme";
import type { JournalSettings } from "./journal/types";
import { AttachmentPicker } from "./attachments/attachment-picker";
import type { AttachmentSummary } from "@/lib/attachment-types";

const LiveMarkdownEditor = dynamic(() => import("./live-markdown-editor"), {
  ssr: false,
  loading: () => <div className="editor-loading">Opening your page…</div>,
});

type Entry = {
  content: string;
  exists: boolean;
  previousYears: string[];
  memories: Memory[];
  template: string;
};
type RevisionDiffLine = { type: "added" | "removed" | "context" | "skip"; text: string; count?: number };
type RevisionSummary = { id: number; createdAt: string; words: number; diff: { additions: number; deletions: number; lines: RevisionDiffLine[] } };
type SaveState = "saved" | "saving" | "unsaved" | "offline";
type CachedEntry = Entry & { pending: boolean; updatedAt: string };
type CommandIconName = "edit" | "markdown" | "read" | "focus";

function CommandIcon({ name }: { name: CommandIconName }) {
  return <svg className="command-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === "edit" && <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" /></>}
    {name === "markdown" && <><path d="m8 9-3 3 3 3" /><path d="m16 9 3 3-3 3" /><path d="m14 5-4 14" /></>}
    {name === "read" && <><path d="M3 5.5A3.5 3.5 0 0 1 6.5 4H11v16H6.5A3.5 3.5 0 0 0 3 21.5Z" /><path d="M21 5.5A3.5 3.5 0 0 0 17.5 4H13v16h4.5a3.5 3.5 0 0 1 3.5 1.5Z" /></>}
    {name === "focus" && <><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M16 3h3a2 2 0 0 1 2 2v3" /><path d="M8 21H5a2 2 0 0 1-2-2v-3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" /></>}
  </svg>;
}

const EMPTY_ENTRY: Entry = {
  content: "",
  exists: false,
  previousYears: [],
  memories: [],
  template: "",
};
const ENTRY_CACHE = "paralog:entry:";
const CALENDAR_CACHE = "paralog:calendar:";
const parseIso = (value: string | null) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = fromIso(value);
  return iso(date) === value ? date : null;
};
const storedMarkdown = (content: string) => content.endsWith("\n") ? content : `${content}\n`;

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

function pendingEntries(period: string, onlyPending = false) {
  const entries: CalendarEntry[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(ENTRY_CACHE)) continue;
    const date = key.slice(ENTRY_CACHE.length);
    const cached = readCachedEntry(date);
    if (date.startsWith(`${period}-`) && cached && (!onlyPending || cached.pending) && (cached.exists || cached.content.trim())) entries.push({ date, words: journalWordCount(cached.content) });
  }
  return entries;
}

function currentPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, {
    enableHighAccuracy: false,
    maximumAge: 10 * 60 * 1000,
    timeout: 15_000,
  }));
}

export default function Journal() {
  const today = useMemo(() => iso(new Date()), []);
  const [selected, setSelected] = useState(today);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [entry, setEntry] = useState<Entry>(EMPTY_ENTRY);
  const [dayWords, setDayWords] = useState<Record<string, number>>({});
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [dirty, setDirty] = useState(false);
  const [view, setView] = useState<"rich" | "source" | "preview">("rich");
  const [settings, setSettings] = useState<JournalSettings | null>(null);
  const { tags, people, refreshReferences: loadReferences } = useJournalReferences();
  const { activities, photos, photoTotal } = useDayContext(selected);
  const randomMemory = useRandomMemory(selected);
  const [openPhoto, setOpenPhoto] = useState<DayPhoto | null>(null);
  const [loadedPhotoId, setLoadedPhotoId] = useState<string | null>(null);
  const [showOutline, setShowOutline] = useState(false);
  const [showRevisions, setShowRevisions] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [outlineJump, setOutlineJump] = useState<number | null>(null);
  const [revisions, setRevisions] = useState<RevisionSummary[]>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showAllMemories, setShowAllMemories] = useState(false);
  const [attachmentPicker, setAttachmentPicker] = useState<"all" | "image" | null>(null);
  const { dark, setDark } = useTheme();
  const [online, setOnline] = useState(true);
  const [loading, setLoading] = useState(true);
  const [remoteUpdate, setRemoteUpdate] = useState<Entry | null>(null);
  const [locationState, setLocationState] = useState<"idle" | "locating" | "looking-up" | "added" | "error">("idle");
  const [locationMessage, setLocationMessage] = useState("");
  const selectedRef = useRef(selected);
  const entryRef = useRef(entry);
  const dirtyRef = useRef(dirty);
  const saveStateRef = useRef(saveState);
  const serverContentRef = useRef<string | null>(null);
  const sourceEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const toolsMenuRef = useRef<HTMLDivElement | null>(null);
  const autoLocationAttemptedRef = useRef(new Set<string>());
  selectedRef.current = selected;
  entryRef.current = entry;
  dirtyRef.current = dirty;
  saveStateRef.current = saveState;
  const outline = useMemo(() => entryOutline(entry.content), [entry.content]);
  const writingStats = useMemo(() => {
    const body = markdownBody(entry.content);
    const trimmed = body.trim();
    const words = trimmed ? trimmed.split(/\s+/).length : 0;
    return { words, characters: body.length, paragraphs: trimmed ? trimmed.split(/\n\s*\n/).length : 0, minutes: words ? Math.max(1, Math.ceil(words / 220)) : 0 };
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
    if (date !== selectedRef.current || (serverContentRef.current !== null && storedMarkdown(remote.content) === storedMarkdown(serverContentRef.current))) return;
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

  const loadCalendar = useCallback(async (date: Date) => {
    const key = monthKey(date);
    const cached = localStorage.getItem(`${CALENDAR_CACHE}${key}`);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as CalendarEntry[] | string[];
        const normalized = parsed.map((entry) => typeof entry === "string" ? { date: entry, words: 0 } : entry);
        setDayWords(entryMap(mergeCalendarEntries(normalized, pendingEntries(key))));
      } catch { /* Ignore stale cache. */ }
    } else setDayWords(entryMap(pendingEntries(key)));

    try {
      const response = await fetch(`/api/calendar?month=${key}`);
      if (!response.ok) return;
      const result = await response.json();
      const entries: CalendarEntry[] = Array.isArray(result.entries)
        ? result.entries
        : (result.dates || []).map((entryDate: string) => ({ date: entryDate, words: 0 }));
      const merged = mergeCalendarEntries(pendingEntries(key), entries, pendingEntries(key, true));
      localStorage.setItem(`${CALENDAR_CACHE}${key}`, JSON.stringify(merged));
      setDayWords(entryMap(merged));
    } catch {
      // The cached calendar remains usable offline.
    }
  }, []);

  const persistEntry = useCallback(async (date: string, content: string, current: Entry) => {
    const draft = { ...current, content, exists: Boolean(content.trim()) || current.exists };
    cacheEntry(date, draft, true);
    if (date === selected) setSaveState(navigator.onLine ? "saving" : "offline");
    setDayWords((days) => ({ ...days, [date]: journalWordCount(content) }));

    if (!navigator.onLine) return false;
    serverContentRef.current = content;
    try {
      const response = await fetch(`/api/entries?date=${date}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!response.ok) throw new Error("Save failed");
      cacheEntry(date, draft, false);
      if (date === selected) {
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

  const flushDirtyEntry = useCallback(() => {
    if (!dirtyRef.current) return;
    const current = entryRef.current;
    void persistEntry(selectedRef.current, current.content, current);
  }, [persistEntry]);

  const openAttachments = useCallback(() => {
    flushDirtyEntry();
    window.location.assign("/attachments");
  }, [flushDirtyEntry]);

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
    await loadCalendar(month);
  }, [loadCalendar, month, persistEntry]);

  useEffect(() => {
    setOnline(navigator.onLine);
    fetch("/api/settings").then((response) => response.ok ? response.json() : null).then(setSettings).catch(() => undefined);
    loadReferences();
  }, [loadReferences]);

  useEffect(() => {
    if (!settings) return;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!timezone || timezone === settings.notificationTimezone || !navigator.onLine) return;
    fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notificationTimezone: timezone }),
    }).then((response) => response.ok ? response.json() : null).then((value) => {
      if (value) setSettings((current) => current ? { ...current, notificationTimezone: value.notificationTimezone } : value);
    }).catch(() => undefined);
  }, [settings]);

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
    if (!showTools) return;
    const closeTools = (event: PointerEvent) => {
      if (!toolsMenuRef.current?.contains(event.target as Node)) setShowTools(false);
    };
    const closeToolsWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowTools(false);
    };
    window.addEventListener("pointerdown", closeTools);
    window.addEventListener("keydown", closeToolsWithKeyboard);
    return () => {
      window.removeEventListener("pointerdown", closeTools);
      window.removeEventListener("keydown", closeToolsWithKeyboard);
    };
  }, [showTools]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") { refreshRemote(selected); loadReferences(); }
    };
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadReferences, refreshRemote, selected]);

  useEffect(() => {
    if (!online) return;
    const events = new EventSource("/api/entries/events");
    events.onopen = () => refreshRemote(selectedRef.current);
    events.onmessage = (event) => {
      try {
        const change = JSON.parse(event.data) as { date?: string };
        loadReferences();
        if (change.date === selectedRef.current) refreshRemote(change.date);
      } catch {
        // Ignore malformed events and let EventSource reconnect normally.
      }
    };
    return () => events.close();
  }, [loadReferences, online, refreshRemote]);

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
    setLocationState("idle");
    setLocationMessage("");
    setShowAllMemories(false);
    loadEntry(selected, controller.signal);
    return () => controller.abort();
  }, [loadEntry, selected]);

  useEffect(() => {
    if (locationState !== "added") return;
    const timer = window.setTimeout(() => {
      setLocationState("idle");
      setLocationMessage("");
    }, 4_000);
    return () => window.clearTimeout(timer);
  }, [locationState]);

  useEffect(() => { setOpenPhoto(null); }, [selected]);

  useEffect(() => {
    setLoadedPhotoId(null);
    if (!openPhoto || photos.length < 2) return;
    const timer = window.setTimeout(() => {
      const current = photos.findIndex((photo) => photo.id === openPhoto.id);
      if (current < 0) return;
      const adjacent = new Set([
        photos[(current - 1 + photos.length) % photos.length]?.id,
        photos[(current + 1) % photos.length]?.id,
      ]);
      adjacent.delete(openPhoto.id);
      for (const id of adjacent) {
        const image = new Image();
        image.src = immichImageUrl(id, "preview");
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [openPhoto, photos]);

  useEffect(() => { loadCalendar(month); }, [loadCalendar, month]);

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
    const shouldAddLocation = Boolean(
      settings?.autoLocation
      && !entryRef.current.exists
      && !entryRef.current.content.trim()
      && content.trim()
      && !autoLocationAttemptedRef.current.has(selectedRef.current),
    );
    setEntry((current) => ({ ...current, content }));
    setDirty(true);
    setSaveState("unsaved");
    if (shouldAddLocation) {
      autoLocationAttemptedRef.current.add(selectedRef.current);
      void addLocation(true);
    }
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

  async function uploadFile(file: File): Promise<AttachmentSummary | null> {
    if (!navigator.onLine) { setSaveState("offline"); return null; }
    const data = new FormData();
    data.append("file", file);
    const response = await fetch("/api/uploads", { method: "POST", body: data });
    if (!response.ok) return null;
    return response.json();
  }

  function appendAttachments(markdown: string[]) {
    if (!markdown.length) return;
    const prefix = entry.content && !entry.content.endsWith("\n") ? "\n" : "";
    changeContent(`${entry.content}${prefix}${markdown.join("\n")}\n`);
  }

  async function addLocation(automatic = false) {
    autoLocationAttemptedRef.current.add(selectedRef.current);
    if (!window.isSecureContext || !("geolocation" in navigator)) {
      setLocationState("error");
      setLocationMessage(`${automatic ? "Couldn’t add location automatically. " : ""}Location requires HTTPS and a browser with location access.`);
      return;
    }
    if (!navigator.onLine) {
      setLocationState("error");
      setLocationMessage(`${automatic ? "Couldn’t add location automatically. " : ""}Connect to the internet to look up your location.`);
      return;
    }
    setLocationState("locating");
    setLocationMessage(automatic ? "Adding location to this new entry…" : "Requesting your device location…");
    try {
      const position = await currentPosition();
      setLocationState("looking-up");
      setLocationMessage("Finding the nearest city…");
      const query = new URLSearchParams({ latitude: String(position.coords.latitude), longitude: String(position.coords.longitude) });
      const response = await fetch(`/api/location?${query}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Location lookup failed.");
      changeContent(setLocationFrontMatter(entryRef.current.content, result.label));
      setLocationState("added");
      setLocationMessage(result.label);
    } catch (error) {
      const geolocationError = error as GeolocationPositionError;
      const message = geolocationError.code === 1
        ? "Location permission was denied. Allow it in your browser’s site settings and try again."
        : error instanceof Error ? error.message : "Location lookup failed.";
      setLocationState("error");
      setLocationMessage(`${automatic ? "Couldn’t add location automatically. " : ""}${message}`);
    }
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

  function navigationWidgets() {
    const layout = settings?.widgetLayout || DEFAULT_WIDGET_LAYOUT;
    return layout.navigation.map((id) => {
      if (layout.hidden.includes(id)) return null;
      if (id === "calendar") return <WordCalendarWidget key={id} month={month} selected={selected} dayWords={dayWords} onMonthChange={setMonth} onSelect={choose} />;
      if (id === "stats") return <WritingStatsWidget key={id} month={monthKey(month)} />;
      if (id === "search") return <SearchWidget key={id} onSelect={choose} />;
      if (id === "tags") return <ReferencesWidget key={id} references={tags} kind="tag" />;
      return <ReferencesWidget key={id} references={people} kind="person" />;
    });
  }

  function dailyContext(placement: WidgetPlacement) {
    const layout = settings?.widgetLayout || DEFAULT_WIDGET_LAYOUT;
    return layout.context.map((provider) => {
      if (layout.hidden.includes(provider)) return null;
      if (provider === "immich") return <ImmichWidget
        key={provider}
        photos={photos}
        total={photoTotal}
        selected={selected}
        placement={placement}
        settings={settings?.widgetSettings.immich || DEFAULT_WIDGET_SETTINGS.immich}
        onOpen={setOpenPhoto}
      />;
      if (provider === "archive") return <ArchiveWidget key={provider} memories={entry.memories} selected={selected} expanded={showAllMemories} placement={placement} onToggle={() => setShowAllMemories((current) => !current)} onChoose={choose} />;
      if (provider === "random") return <RandomMemoryWidget key={provider} memory={randomMemory.memory} selected={selected} scope={randomMemory.scope} loading={randomMemory.loading} placement={placement} onScopeChange={randomMemory.setScope} onRefresh={randomMemory.refresh} onChoose={choose} />;
      const activity = activities.find((item): item is DaySummaryActivity => item.kind === "summary" && item.provider === provider);
      return activity ? <ActivityWidget key={provider} activity={activity} placement={placement} /> : null;
    });
  }

  async function signOut() {
    try { await unsubscribeCurrentDevice(); } catch { /* Signing out still clears the authenticated session. */ }
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
      spellCheck
      value={entry.content}
      onChange={(event) => { changeContent(event.target.value); resizeSourceEditor(event.currentTarget); keepSourceCursorVisible(event.currentTarget); }}
      onFocus={(event) => keepSourceCursorVisible(event.currentTarget)}
      onSelect={(event) => keepSourceCursorVisible(event.currentTarget)}
      placeholder="What’s on your mind?"
      autoFocus
    />
  );
  const rendered = (
    <article className="preview"><ReactMarkdown remarkPlugins={[remarkGfm, remarkJournalReferences]}>{markdownBody(entry.content) || "*Nothing here yet.*"}</ReactMarkdown></article>
  );

  return (
    <main className={`app-shell ${focusMode ? "focus-mode" : ""}`}>
      <aside className="sidebar">
        <div className="brand"><p className="eyebrow">PRIVATE JOURNAL</p><h1>Paralog</h1></div>
        <button className="today-button" type="button" onClick={() => choose(today)}><span>Today</span><b aria-hidden="true">↗</b></button>
        {navigationWidgets()}
        <div className="side-actions">
          <button type="button" onClick={openAttachments}><span className="action-icon" aria-hidden="true">▧</span><span className="action-label">Attachments</span></button>
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
          <button type="button" onClick={openAttachments} aria-label="Open attachments"><span aria-hidden="true">▧</span></button>
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
            <button className={`save-control ${saveState}`} type="button" title="Save entry (Ctrl+S or Cmd+S)" aria-live="polite" onClick={() => persistEntry(selected, entry.content, entry)} disabled={saveState === "saving"}><i aria-hidden="true" /><span>{statusCopy[saveState]}</span></button>
          </div>
        </header>

        {locationMessage && <div className={`location-feedback ${locationState}`} role="status">
          {locationState === "added" && <strong><span aria-hidden="true">✓</span> Location added</strong>}
          <span>{locationMessage}</span>
          {locationState === "added" && <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>}
        </div>}

        <div className="entry-workspace">
        <div className="entry-editor-column">
        <div className="editor-command-bar" aria-label="Editor controls">
          <div className="view-switcher" role="group" aria-label="Entry view">
            <button type="button" aria-label="Editor view" title="Editor" aria-pressed={view === "rich"} onClick={() => setView("rich")}><CommandIcon name="edit" /></button>
            <button type="button" aria-label="Markdown source" title="Markdown" aria-pressed={view === "source"} onClick={() => setView("source")}><CommandIcon name="markdown" /></button>
            <button type="button" aria-label="Reading view" title="Read" aria-pressed={view === "preview"} onClick={() => setView("preview")}><CommandIcon name="read" /></button>
          </div>
          <span className="command-spacer" />
          <button className={`command-stat ${showStats ? "active" : ""}`} type="button" aria-expanded={showStats} onClick={() => { setShowStats((value) => !value); setShowOutline(false); setShowTools(false); }}>{writingStats.words} {writingStats.words === 1 ? "word" : "words"}</button>
          <button className={`command-icon-button ${focusMode ? "active" : ""}`} type="button" aria-label={focusMode ? "Exit focus mode" : "Enter focus mode"} title={focusMode ? "Exit focus mode" : "Focus mode"} aria-pressed={focusMode} onClick={() => { setFocusMode((value) => !value); setShowTools(false); }}><CommandIcon name="focus" /></button>
          <div className="tools-menu-wrap" ref={toolsMenuRef}>
            <button className={`tools-trigger ${showTools ? "active" : ""}`} type="button" aria-haspopup="menu" aria-expanded={showTools} onClick={() => setShowTools((value) => !value)}>Tools <span aria-hidden="true">⌄</span></button>
            {showTools && <div className="tools-menu" role="menu">
              <button type="button" role="menuitem" disabled={!online || locationState === "locating" || locationState === "looking-up"} onClick={() => { setShowTools(false); void addLocation(); }}><b>{locationState === "locating" ? "Locating…" : locationState === "looking-up" ? "Finding city…" : "Add location"}</b><small>Add city, state, and country to metadata</small></button>
              <button type="button" role="menuitem" onClick={() => { setShowTools(false); setAttachmentPicker("all"); }}><b>Add attachment</b><small>Upload a file or choose from your library</small></button>
              <button type="button" role="menuitem" disabled={outline.length === 0} onClick={() => { setShowOutline((value) => !value); setShowStats(false); setShowTools(false); }}><b>Outline</b><small>{outline.length ? `${outline.length} ${outline.length === 1 ? "heading" : "headings"}` : "No headings yet"}</small></button>
              <button type="button" role="menuitem" onClick={() => { setShowTools(false); openRevisions(); }}><b>Version history</b><small>Review and restore earlier saves</small></button>
            </div>}
          </div>
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
          {view === "preview" ? rendered : view === "source" ? sourceEditor : <LiveMarkdownEditor markdown={entry.content} onChange={changeContent} onUpload={uploadFile} entryDate={selected} online={online} template={entry.template} jumpToLine={outlineJump} onJumpHandled={handleJumpHandled} vimMode={Boolean(settings?.vimMode)} tags={tags} people={people} onBeforeAttachmentNavigation={flushDirtyEntry} />}
        </div>
        </div>
        <aside className="entry-context-column" aria-label="Daily activity and archive memories">
        {dailyContext("desktop")}
        </aside>
        </div>
        {dailyContext("mobile")}
      </section>

      {showCalendar && (
        <div className="sheet-backdrop" role="presentation" onClick={() => setShowCalendar(false)}>
          <section className="calendar-sheet" role="dialog" aria-modal="true" aria-label="Choose a journal date" onClick={(event) => event.stopPropagation()}>
            <div className="sheet-header"><div><p className="eyebrow">BROWSE JOURNAL</p><h3>Choose a day</h3></div><button type="button" onClick={() => setShowCalendar(false)} aria-label="Close calendar">×</button></div>
            {navigationWidgets()}
          </section>
        </div>
      )}

      {showSettings && settings && <SettingsDialog
        settings={settings}
        online={online}
        onChange={setSettings}
        onClose={() => setShowSettings(false)}
        onSave={persistSettings}
        onSignOut={signOut}
      />}

      {showRevisions && <RevisionsDialog
        revisions={revisions}
        loading={revisionsLoading}
        onClose={() => setShowRevisions(false)}
        onRestore={restoreRevision}
      />}

      <AttachmentPicker open={attachmentPicker !== null} mode={attachmentPicker || "all"} entryDate={selected} online={online} onClose={() => setAttachmentPicker(null)} onInsert={appendAttachments} onBeforeNavigate={flushDirtyEntry} />

      {openPhoto && <PhotoLightbox
        photo={openPhoto}
        photos={photos}
        selected={selected}
        loadedPhotoId={loadedPhotoId}
        onLoaded={setLoadedPhotoId}
        onClose={() => setOpenPhoto(null)}
        onMove={moveOpenPhoto}
      />}
    </main>
  );
}
