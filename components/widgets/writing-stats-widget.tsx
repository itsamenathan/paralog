"use client";

import { useEffect, useState } from "react";
import type { WritingStats } from "@/lib/journal-insight-types";

const number = new Intl.NumberFormat("en-US");

function comparison(stats: WritingStats) {
  if (stats.previousMonthWords === 0) return stats.totalWords > 0 ? "New this month" : "No change from last month";
  if (stats.wordChange === 0) return "Same as last month";
  const direction = stats.wordChange > 0 ? "↑" : "↓";
  return `${direction} ${Math.abs(stats.percentChange || 0)}% vs last month`;
}

export function WritingStatsWidget({ month }: { month: string }) {
  const [stats, setStats] = useState<WritingStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setStats(null);
    setLoading(true);
    fetch(`/api/stats?month=${month}`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((value) => { if (active && value) setStats(value); })
      .catch(() => undefined)
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [month]);

  if (!loading && (!stats || (stats.activeDays === 0 && stats.longestStreak === 0))) return null;
  const label = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
  return <section className="writing-stats-widget widget widget-stats" aria-label={`Writing statistics for ${label}`}>
    <div className="widget-heading"><p className="eyebrow">WRITING STATS</p><span>{label}</span></div>
    {loading && !stats ? <p className="widget-loading">Calculating…</p> : stats && <>
      <div className="stats-feature"><b>{stats.longestStreak}</b><span>day longest streak</span></div>
      <dl className="stats-summary">
        <div><dt>Total words</dt><dd>{number.format(stats.totalWords)}</dd></div>
        <div><dt>Active days</dt><dd>{stats.activeDays}</dd></div>
        <div><dt>Average entry</dt><dd>{number.format(stats.averageEntryLength)}</dd></div>
      </dl>
      <p className={`stats-comparison ${stats.wordChange > 0 ? "positive" : stats.wordChange < 0 ? "negative" : ""}`}>{comparison(stats)}</p>
    </>}
  </section>;
}
