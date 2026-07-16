import type { NotificationSchedule } from "./types";

const weekdayIndexes: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function localClock(now: Date, timezone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: weekdayIndexes[parts.weekday],
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function notificationDue(schedule: NotificationSchedule, clock: ReturnType<typeof localClock>) {
  if (!schedule.enabled || !schedule.weekdays.includes(clock.weekday)) return false;
  const [hour, minute] = schedule.time.split(":").map(Number);
  const elapsed = clock.minutes - (hour * 60 + minute);
  return elapsed >= 0 && elapsed <= 60;
}
