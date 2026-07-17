"use client";

import { useEffect, useState } from "react";
import type { JournalSearchResult, SearchMatchKind } from "@/lib/journal-insight-types";
import { displayDate } from "./date-utils";

const matchLabels: Record<SearchMatchKind, string> = { date: "Date", tag: "Tag", person: "Person", text: "Text" };

export function SearchWidget({ onSelect }: { onSelect: (date: string) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<JournalSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const value = query.trim();
    if (!value) {
      setResults([]);
      setSearched(false);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setResults([]);
    setSearched(false);
    const timer = window.setTimeout(() => {
      setLoading(true);
      fetch(`/api/search?q=${encodeURIComponent(value)}`, { cache: "no-store", signal: controller.signal })
        .then((response) => response.ok ? response.json() : { results: [] })
        .then((result) => { if (active) setResults(Array.isArray(result.results) ? result.results : []); })
        .catch(() => undefined)
        .finally(() => { if (active) { setLoading(false); setSearched(true); } });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  return <section className="search-widget widget widget-search" aria-label="Search journal entries">
    <div className="widget-heading"><p className="eyebrow">SEARCH</p></div>
    <label className="journal-search-field">
      <span aria-hidden="true">⌕</span>
      <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Text, #tag, @person, date" aria-label="Search entry text, tags, people, and dates" />
      {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search">×</button>}
    </label>
    {loading && <p className="search-status" role="status">Searching…</p>}
    {!loading && searched && results.length === 0 && <p className="search-status">No matching entries.</p>}
    {results.length > 0 && <div className="search-results" aria-live="polite">
      {results.map((result) => <button type="button" key={result.date} onClick={() => onSelect(result.date)}>
        <span className="search-result-heading"><b>{displayDate(result.date)}</b><small>{result.words} {result.words === 1 ? "word" : "words"}</small></span>
        <span className="search-result-excerpt">{result.excerpt}</span>
        <span className="search-result-matches">{result.matches.map((match) => <i key={match}>{matchLabels[match]}</i>)}</span>
      </button>)}
    </div>}
  </section>;
}
