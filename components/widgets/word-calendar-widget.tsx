"use client";

import { useMemo } from "react";
import { displayDate, iso, monthKey } from "./date-utils";

export function WordCalendarWidget({
  month,
  selected,
  dayWords,
  onMonthChange,
  onSelect,
}: {
  month: Date;
  selected: string;
  dayWords: Record<string, number>;
  onMonthChange: (date: Date) => void;
  onSelect: (date: string) => void;
}) {
  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return Array.from({ length: first.getDay() + count }, (_, index) =>
      index < first.getDay() ? null : new Date(month.getFullYear(), month.getMonth(), index - first.getDay() + 1),
    );
  }, [month]);
  const { levels, maximum } = useMemo(() => {
    const prefix = `${monthKey(month)}-`;
    const values = [...new Set(Object.entries(dayWords)
      .filter(([date, words]) => date.startsWith(prefix) && words > 0)
      .map(([, words]) => words))]
      .sort((left, right) => left - right);
    const scale = new Map<number, number>();
    values.forEach((words, index) => {
      scale.set(words, values.length === 1 ? 4 : 1 + Math.floor((index * 3) / (values.length - 1)));
    });
    return { levels: scale, maximum: values.at(-1) || 0 };
  }, [dayWords, month]);

  const label = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(month);
  return <section className="word-heatmap widget widget-calendar" aria-label={`${label} journal word count heatmap`}>
    <div className="month-nav">
      <button type="button" aria-label="Previous month" onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><span aria-hidden="true">←</span></button>
      <strong>{label}</strong>
      <button type="button" aria-label="Next month" onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><span aria-hidden="true">→</span></button>
    </div>
    <div className="heatmap-weekdays" aria-hidden="true">
      {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
    </div>
    <div className="heatmap-grid">
      {cells.map((date, index) => {
        if (!date) return <span className="heatmap-cell outside" key={`empty-${index}`} />;
        const value = iso(date);
        const words = dayWords[value] ?? 0;
        const level = words > 0 ? levels.get(words) || 1 : 0;
        return <button
          type="button"
          className={`heatmap-cell level-${level} ${value === selected ? "selected" : ""}`}
          key={value}
          aria-label={`${displayDate(value)}: ${words} ${words === 1 ? "word" : "words"}, intensity ${level} of 4 for this month`}
          aria-current={value === selected ? "date" : undefined}
          title={`${displayDate(value)} · ${words} ${words === 1 ? "word" : "words"}`}
          onClick={() => onSelect(value)}
        >{date.getDate()}</button>;
      })}
    </div>
    <div className="heatmap-legend" title="Color intensity is ranked against the other entries in this month">
      <span>Relative this month</span><span>0</span>{[0, 1, 2, 3, 4].map((level) => <i className={`level-${level}`} key={level} />)}<span>{maximum} words</span>
    </div>
  </section>;
}
