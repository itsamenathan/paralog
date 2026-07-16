"use client";

import type { DaySummaryActivity } from "@/lib/day-activity-types";
import type { WidgetPlacement } from "./types";

export function ActivityWidget({ activity, placement }: { activity: DaySummaryActivity; placement: WidgetPlacement }) {
  if (activity.total === 0) return null;
  const titleId = `activity-${activity.provider}-${placement}`;
  return <section className={`activity-shelf activity-shelf-${placement} widget widget-${activity.provider}`} aria-labelledby={titleId}>
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
