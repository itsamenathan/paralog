"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { remarkJournalReferences } from "@/lib/markdown-references";
import { markdownBody, setLocationFrontMatter } from "@/lib/front-matter";
import type { DayActivity, DayPhoto, DaySummaryActivity } from "@/lib/day-activity-types";

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
type NotificationRule = "always" | "empty";
type NotificationSchedule = { id: string; enabled: boolean; time: string; weekdays: number[]; rule: NotificationRule; title: string; body: string };
type ProviderId = "github" | "immich" | "archive";
type Settings = {
  saveFormat: string;
  template: string;
  showTagCloud: boolean;
  vimMode: boolean;
  autoSave: boolean;
  autoLocation: boolean;
  providerOrder: ProviderId[];
  notificationTimezone: string;
  notificationSchedules: NotificationSchedule[];
};
type ReferenceSummary = { name: string; count: number; dates: string[] };
type RevisionDiffLine = { type: "added" | "removed" | "context" | "skip"; text: string; count?: number };
type RevisionSummary = { id: number; createdAt: string; words: number; diff: { additions: number; deletions: number; lines: RevisionDiffLine[] } };
type SaveState = "saved" | "saving" | "unsaved" | "offline";
type CachedEntry = Entry & { pending: boolean; updatedAt: string };
type CommandIconName = "edit" | "markdown" | "read" | "focus";

const immichImageUrl = (id: string, size: "thumbnail" | "preview") =>
  `/api/immich/thumbnail/${encodeURIComponent(id)}?size=${size}`;

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
const PROVIDER_LABELS: Record<ProviderId, string> = { github: "GitHub", immich: "Immich", archive: "Your archive" };

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

function currentPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, {
    enableHighAccuracy: false,
    maximumAge: 10 * 60 * 1000,
    timeout: 15_000,
  }));
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

function applicationServerKey(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const decoded = atob((value + padding).replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

async function currentPushSubscription() {
  const registration = await navigator.serviceWorker?.getRegistration();
  return registration ? registration.pushManager.getSubscription() : null;
}

async function unsubscribeCurrentDevice() {
  const subscription = await currentPushSubscription();
  if (!subscription) return;
  try {
    await fetch("/api/notifications", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
  } finally {
    await subscription.unsubscribe();
  }
}

function ReferenceBrowser({ references, kind }: {
  references: ReferenceSummary[];
  kind: "tag" | "person";
}) {
  const largest = Math.max(...references.map((reference) => reference.count), 1);
  const marker = kind === "tag" ? "#" : "@";
  const collection = kind === "tag" ? "tags" : "people";
  return <section className="tag-browser" aria-label={`Journal ${collection}`}>
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
  photos: DayPhoto[];
  total: number;
  selected: string;
  placement: "desktop" | "mobile";
  onOpen: (photo: DayPhoto) => void;
}) {
  if (photos.length === 0) return null;
  const titleId = `photo-title-${placement}`;
  const count = total === 1 ? "1 photo" : total > photos.length ? `${photos.length} of ${total} photos` : `${total} photos`;
  return <section className={`photo-shelf photo-shelf-${placement}`} aria-labelledby={titleId}>
    <div className="photo-heading"><div><p className="eyebrow">FROM IMMICH</p><h3 id={titleId}>Photos from this day</h3></div><span>{count}</span></div>
    <div className="photo-grid">
      {photos.map((photo, index) => <button type="button" className="photo-card" key={photo.id} onClick={() => onOpen(photo)} aria-label={`Open photo ${index + 1} from ${displayDate(selected)} larger`}>
        <img
          src={immichImageUrl(photo.id, "thumbnail")}
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

function ActivitySummaryShelf({ activity, placement }: { activity: DaySummaryActivity; placement: "desktop" | "mobile" }) {
  if (activity.total === 0) return null;
  const titleId = `activity-${activity.provider}-${placement}`;
  return <section className={`activity-shelf activity-shelf-${placement}`} aria-labelledby={titleId}>
    <div className="activity-heading"><div><p className="eyebrow">FROM {activity.source.toUpperCase()}</p><h3 id={titleId}>{activity.title}</h3></div><span>{activity.totalLabel}</span></div>
    <div className="activity-list">
      {activity.items.map((item) => {
        const contents = <><span>{item.label}</span><b>{item.count} {item.count === 1 ? activity.itemUnit.singular : activity.itemUnit.plural}</b></>;
        return item.url
          ? <a key={item.id} href={item.url} target="_blank" rel="noreferrer">{contents}</a>
          : <div key={item.id}>{contents}</div>;
      })}
    </div>
  </section>;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function NotificationPreferences({ settings, onChange }: { settings: Settings; onChange: (settings: Settings) => void }) {
  const [publicKey, setPublicKey] = useState("");
  const [status, setStatus] = useState<"checking" | "unsupported" | "unsubscribed" | "subscribed" | "denied" | "error">("checking");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const inspect = useCallback(async () => {
    if (!window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setStatus("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }
    try {
      const response = await fetch("/api/notifications", { cache: "no-store" });
      if (!response.ok) throw new Error("Notification setup is unavailable.");
      const result = await response.json();
      setPublicKey(result.publicKey);
      const subscription = await currentPushSubscription();
      if (subscription) {
        await fetch("/api/notifications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscription: subscription.toJSON() }),
        });
      }
      setStatus(subscription ? "subscribed" : "unsubscribed");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Notification setup is unavailable.");
      setStatus("error");
    }
  }, []);

  useEffect(() => { void inspect(); }, [inspect]);

  const updateSchedule = (id: string, changes: Partial<NotificationSchedule>) => {
    onChange({ ...settings, notificationSchedules: settings.notificationSchedules.map((schedule) => schedule.id === id ? { ...schedule, ...changes } : schedule) });
  };

  const subscribe = async () => {
    setBusy(true);
    setMessage("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setStatus(permission === "denied" ? "denied" : "unsubscribed"); return; }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(publicKey),
      });
      const response = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });
      if (!response.ok) throw new Error((await response.json()).error || "Could not subscribe this device.");
      setStatus("subscribed");
      setMessage("This device will receive enabled reminders.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Could not subscribe this device.");
    } finally { setBusy(false); }
  };

  const unsubscribe = async () => {
    setBusy(true);
    setMessage("");
    try {
      await unsubscribeCurrentDevice();
      setStatus("unsubscribed");
      setMessage("Notifications are off on this device.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not unsubscribe this device.");
    } finally { setBusy(false); }
  };

  const sendTest = async () => {
    setBusy(true);
    setMessage("");
    try {
      const subscription = await currentPushSubscription();
      if (!subscription) throw new Error("Subscribe this device first.");
      const sample = settings.notificationSchedules.find((schedule) => schedule.enabled) || settings.notificationSchedules[0];
      const response = await fetch("/api/notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint, title: sample?.title, body: sample?.body }),
      });
      if (!response.ok) throw new Error((await response.json()).error || "Could not send the test notification.");
      setMessage("Test notification sent.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not send the test notification.");
    } finally { setBusy(false); }
  };

  const addReminder = () => onChange({
    ...settings,
    notificationSchedules: [...settings.notificationSchedules, {
      id: crypto.randomUUID(),
      enabled: true,
      time: "22:00",
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      rule: "always",
      title: "Time to journal",
      body: "Add a thought to today’s entry.",
    }],
  });

  const statusText = {
    checking: "Checking this device…",
    unsupported: "Notifications require HTTPS and a browser with Web Push. On iPhone or iPad, add Paralog to the Home Screen first.",
    unsubscribed: "Notifications are off on this device.",
    subscribed: "Notifications are enabled on this device.",
    denied: "Notification permission is blocked. Re-enable it in your browser or device settings.",
    error: "Notification status could not be checked.",
  }[status];

  return <section className="notification-settings" aria-labelledby="notification-settings-title">
    <div className="notification-heading">
      <div><p className="eyebrow">REMINDERS</p><h3 id="notification-settings-title">Journal notifications</h3></div>
      <span className={`notification-state ${status === "subscribed" ? "active" : ""}`}>{status === "subscribed" ? "On" : "Off"}</span>
    </div>
    <p className="notification-help">{statusText} Times follow the last device that opened Paralog: <b>{settings.notificationTimezone}</b>.</p>
    <div className="notification-device-actions">
      {status === "subscribed"
        ? <><button type="button" onClick={sendTest} disabled={busy}>Send test</button><button type="button" onClick={unsubscribe} disabled={busy}>Turn off on this device</button></>
        : <button type="button" className="notification-enable" onClick={subscribe} disabled={busy || !publicKey || status === "unsupported" || status === "denied"}>Enable on this device</button>}
    </div>
    {message && <p className="notification-message" role="status">{message}</p>}
    <div className="reminder-list">
      {settings.notificationSchedules.map((schedule, index) => <article className="reminder-card" key={schedule.id}>
        <div className="reminder-card-heading">
          <label className="toggle-setting"><input type="checkbox" checked={schedule.enabled} onChange={(event) => updateSchedule(schedule.id, { enabled: event.target.checked })} /><span><b>Reminder {index + 1}</b><small>{schedule.enabled ? "Enabled" : "Disabled"}</small></span></label>
          <button type="button" className="reminder-remove" onClick={() => onChange({ ...settings, notificationSchedules: settings.notificationSchedules.filter((item) => item.id !== schedule.id) })} aria-label={`Delete reminder ${index + 1}`}>Delete</button>
        </div>
        <div className="reminder-row">
          <label>Time<input type="time" value={schedule.time} onChange={(event) => updateSchedule(schedule.id, { time: event.target.value })} /></label>
          <label>Send when<select value={schedule.rule} onChange={(event) => updateSchedule(schedule.id, { rule: event.target.value as NotificationRule })}><option value="always">Always</option><option value="empty">Today’s entry is empty</option></select></label>
        </div>
        <fieldset><legend>Days</legend><div className="weekday-picker">{WEEKDAYS.map((day, dayIndex) => <label key={day}><input type="checkbox" checked={schedule.weekdays.includes(dayIndex)} onChange={(event) => updateSchedule(schedule.id, { weekdays: event.target.checked ? [...schedule.weekdays, dayIndex].sort() : schedule.weekdays.filter((value) => value !== dayIndex) })} /><span>{day}</span></label>)}</div></fieldset>
        <label>Title<input maxLength={80} value={schedule.title} onChange={(event) => updateSchedule(schedule.id, { title: event.target.value })} /></label>
        <label>Message<textarea className="reminder-message-input" maxLength={200} value={schedule.body} onChange={(event) => updateSchedule(schedule.id, { body: event.target.value })} /></label>
      </article>)}
    </div>
    <button type="button" className="add-reminder" onClick={addReminder} disabled={settings.notificationSchedules.length >= 10}>+ Add reminder</button>
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
  const [draggingProvider, setDraggingProvider] = useState<ProviderId | null>(null);
  const [tags, setTags] = useState<ReferenceSummary[]>([]);
  const [people, setPeople] = useState<ReferenceSummary[]>([]);
  const [activities, setActivities] = useState<DayActivity[]>([]);
  const [photos, setPhotos] = useState<DayPhoto[]>([]);
  const [photoTotal, setPhotoTotal] = useState(0);
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
  const [dark, setDark] = useState(false);
  const [themeReady, setThemeReady] = useState(false);
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
  const photoSwipeStartRef = useRef<number | null>(null);
  const draggingProviderRef = useRef<ProviderId | null>(null);
  const sourceEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const toolsMenuRef = useRef<HTMLDivElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
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

  const loadReferences = useCallback(async () => {
    try {
      const response = await fetch("/api/references", { cache: "no-store" });
      if (!response.ok) return;
      const result = await response.json();
      setTags(result.tags);
      setPeople(result.people);
    } catch {
      // Keep the last references available when offline.
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
    const controller = new AbortController();
    setActivities([]);
    setPhotos([]);
    setPhotoTotal(0);
    setOpenPhoto(null);
    if (!navigator.onLine) return () => controller.abort();
    const selectedDate = fromIso(selected);
    const nextDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate() + 1);
    const params = new URLSearchParams({
      date: selected,
      utcOffset: String(selectedDate.getTimezoneOffset()),
      nextUtcOffset: String(nextDate.getTimezoneOffset()),
    });
    fetch(`/api/activity?${params}`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((result) => {
        if (!Array.isArray(result?.activities)) return;
        setActivities(result.activities);
        const photoActivity = result.activities.find((activity: DayActivity) => activity.kind === "photos");
        if (!photoActivity || photoActivity.kind !== "photos") return;
        setPhotos(photoActivity.photos);
        setPhotoTotal(photoActivity.total);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [selected]);

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

  function moveProvider(provider: ProviderId, offset: -1 | 1) {
    setSettings((current) => {
      if (!current) return current;
      const index = current.providerOrder.indexOf(provider);
      const target = index + offset;
      if (index < 0 || target < 0 || target >= current.providerOrder.length) return current;
      const providerOrder = [...current.providerOrder];
      [providerOrder[index], providerOrder[target]] = [providerOrder[target], providerOrder[index]];
      return { ...current, providerOrder };
    });
  }

  function placeProvider(provider: ProviderId, target: ProviderId) {
    if (provider === target) return;
    setSettings((current) => {
      if (!current) return current;
      const from = current.providerOrder.indexOf(provider);
      const to = current.providerOrder.indexOf(target);
      if (from < 0 || to < 0) return current;
      const providerOrder = [...current.providerOrder];
      providerOrder.splice(from, 1);
      providerOrder.splice(to, 0, provider);
      return { ...current, providerOrder };
    });
  }

  function startProviderDrag(provider: ProviderId) {
    draggingProviderRef.current = provider;
    setDraggingProvider(provider);
  }

  function finishProviderDrag() {
    draggingProviderRef.current = null;
    setDraggingProvider(null);
  }

  function dailyContext(placement: "desktop" | "mobile") {
    const order = settings?.providerOrder || ["immich", "archive", "github"];
    return order.map((provider) => {
      if (provider === "immich") return <PhotoShelf key={provider} photos={photos} total={photoTotal} selected={selected} placement={placement} onOpen={setOpenPhoto} />;
      if (provider === "archive") return <MemoryShelf key={provider} memories={entry.memories} selected={selected} expanded={showAllMemories} placement={placement} onToggle={() => setShowAllMemories((current) => !current)} onChoose={choose} />;
      const activity = activities.find((item): item is DaySummaryActivity => item.kind === "summary" && item.provider === provider);
      return activity ? <ActivitySummaryShelf key={provider} activity={activity} placement={placement} /> : null;
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
    <article className="preview"><ReactMarkdown remarkPlugins={[remarkJournalReferences]}>{markdownBody(entry.content) || "*Nothing here yet.*"}</ReactMarkdown></article>
  );

  return (
    <main className={`app-shell ${focusMode ? "focus-mode" : ""}`}>
      <aside className="sidebar">
        <div className="brand"><p className="eyebrow">PRIVATE JOURNAL</p><h1>Paralog</h1></div>
        <button className="today-button" type="button" onClick={() => choose(today)}><span>Today</span><b aria-hidden="true">↗</b></button>
        <Calendar month={month} selected={selected} savedDates={savedDates} onMonthChange={setMonth} onSelect={choose} />
        {settings?.showTagCloud && tags.length > 0 && <ReferenceBrowser references={tags} kind="tag" />}
        {settings?.showTagCloud && people.length > 0 && <ReferenceBrowser references={people} kind="person" />}
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
              <button type="button" role="menuitem" disabled={!online} onClick={() => attachmentInputRef.current?.click()}><b>Attach file</b><small>{online ? "Add a photo or document" : "Available when back online"}</small></button>
              <button type="button" role="menuitem" disabled={outline.length === 0} onClick={() => { setShowOutline((value) => !value); setShowStats(false); setShowTools(false); }}><b>Outline</b><small>{outline.length ? `${outline.length} ${outline.length === 1 ? "heading" : "headings"}` : "No headings yet"}</small></button>
              <button type="button" role="menuitem" onClick={() => { setShowTools(false); openRevisions(); }}><b>Version history</b><small>Review and restore earlier saves</small></button>
            </div>}
            <input ref={attachmentInputRef} className="editor-file-input" type="file" disabled={!online} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) { setShowTools(false); void upload(file); } }} />
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
          {view === "preview" ? rendered : view === "source" ? sourceEditor : <LiveMarkdownEditor markdown={entry.content} onChange={changeContent} onUpload={uploadFile} template={entry.template} jumpToLine={outlineJump} onJumpHandled={handleJumpHandled} vimMode={Boolean(settings?.vimMode)} tags={tags} people={people} />}
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
            <Calendar month={month} selected={selected} savedDates={savedDates} onMonthChange={setMonth} onSelect={choose} />
            {settings?.showTagCloud && tags.length > 0 && <ReferenceBrowser references={tags} kind="tag" />}
            {settings?.showTagCloud && people.length > 0 && <ReferenceBrowser references={people} kind="person" />}
          </section>
        </div>
      )}

      {showSettings && settings && (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowSettings(false)}>
          <section className="settings" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(event) => event.stopPropagation()}>
            <div className="settings-title"><div><p className="eyebrow">PREFERENCES</p><h2 id="settings-title">Journal settings</h2></div><button type="button" onClick={() => setShowSettings(false)} aria-label="Close settings">×</button></div>
            <label>Save format<small>Tokens: YYYY, MM, MMMM, DD, dddd. Existing files stay where they are.</small><input value={settings.saveFormat} onChange={(event) => setSettings({ ...settings, saveFormat: event.target.value })} /></label>
            <label>New entry template<small>Use any Markdown you want as a starting point.</small><textarea value={settings.template} onChange={(event) => setSettings({ ...settings, template: event.target.value })} /></label>
            <fieldset className="provider-order"><legend>Daily context order</legend><small>Drag the handles to choose the order of cards below your editor and in the desktop context column.</small>
              <div>{settings.providerOrder.map((provider, index) => <div
                className={`provider-order-row ${draggingProvider === provider ? "dragging" : ""}`}
                data-provider={provider}
                draggable
                key={provider}
                onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", provider); startProviderDrag(provider); }}
                onDragEnter={() => { const dragging = draggingProviderRef.current; if (dragging) placeProvider(dragging, provider); }}
                onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
                onDrop={(event) => { event.preventDefault(); finishProviderDrag(); }}
                onDragEnd={finishProviderDrag}
              >
                <span><b>{index + 1}</b>{PROVIDER_LABELS[provider]}</span>
                <button
                  type="button"
                  className="provider-drag-handle"
                  draggable
                  aria-label={`Reorder ${PROVIDER_LABELS[provider]}`}
                  aria-pressed={draggingProvider === provider}
                  title={`Drag to reorder ${PROVIDER_LABELS[provider]}`}
                  onKeyDown={(event) => {
                    if (event.key === " " || event.key === "Enter") { event.preventDefault(); draggingProvider === provider ? finishProviderDrag() : startProviderDrag(provider); }
                    else if (draggingProvider === provider && (event.key === "ArrowUp" || event.key === "ArrowDown")) { event.preventDefault(); moveProvider(provider, event.key === "ArrowUp" ? -1 : 1); }
                    else if (draggingProvider === provider && event.key === "Escape") { event.preventDefault(); finishProviderDrag(); }
                  }}
                  onPointerDown={(event) => {
                    if (event.pointerType === "mouse") return;
                    event.preventDefault();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    startProviderDrag(provider);
                  }}
                  onPointerMove={(event) => {
                    if (!draggingProviderRef.current || event.pointerType === "mouse") return;
                    event.preventDefault();
                    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-provider]")?.dataset.provider as ProviderId | undefined;
                    if (target && target in PROVIDER_LABELS) placeProvider(draggingProviderRef.current, target);
                  }}
                  onPointerUp={finishProviderDrag}
                  onPointerCancel={finishProviderDrag}
                ><span aria-hidden="true">⠿</span></button>
              </div>)}</div>
              <p className="provider-order-status" aria-live="polite">{draggingProvider ? `${PROVIDER_LABELS[draggingProvider]} picked up. Drag it, or use the arrow keys, then press Enter to drop.` : ""}</p>
            </fieldset>
            <label className="toggle-setting"><input type="checkbox" checked={settings.showTagCloud} onChange={(event) => setSettings({ ...settings, showTagCloud: event.target.checked })} /><span><b>Show tags and people</b><small>Collect hashtags and @mentions from your entries in the desktop sidebar and mobile calendar.</small></span></label>
            <label className="toggle-setting"><input type="checkbox" checked={settings.autoSave} onChange={(event) => setSettings({ ...settings, autoSave: event.target.checked })} /><span><b>Automatically save entries</b><small>Save after you pause typing. You can always save immediately with Ctrl+S or Cmd+S.</small></span></label>
            <label className="toggle-setting"><input type="checkbox" checked={settings.autoLocation} onChange={(event) => setSettings({ ...settings, autoLocation: event.target.checked })} /><span><b>Add location to new entries</b><small>When you begin writing on an empty day, request your location and add the nearest city, state, and country to its metadata.</small></span></label>
            <label className="toggle-setting"><input type="checkbox" checked={settings.vimMode} onChange={(event) => setSettings({ ...settings, vimMode: event.target.checked })} /><span><b>Vim keybindings</b><small>Enable Normal, Insert, and Visual modes in the Live Preview editor on desktop. Mobile always uses standard editing.</small></span></label>
            <NotificationPreferences settings={settings} onChange={setSettings} />
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
          <img
            className={`photo-lightbox-image ${loadedPhotoId === openPhoto.id ? "loaded" : ""}`}
            src={immichImageUrl(openPhoto.id, "preview")}
            alt={`Photo from ${displayDate(selected)}`}
            decoding="async"
            draggable={false}
            onLoad={() => setLoadedPhotoId(openPhoto.id)}
          />
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
