"use client";

import { useCallback, useEffect, useState } from "react";
import type { JournalSettings, NotificationRule, NotificationSchedule } from "./types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function applicationServerKey(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const decoded = atob((value + padding).replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

export async function currentPushSubscription() {
  const registration = await navigator.serviceWorker?.getRegistration();
  return registration ? registration.pushManager.getSubscription() : null;
}

export async function unsubscribeCurrentDevice() {
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

export function NotificationPreferences({ settings, onChange }: { settings: JournalSettings; onChange: (settings: JournalSettings) => void }) {
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
