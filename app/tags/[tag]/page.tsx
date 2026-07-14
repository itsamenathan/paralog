import Link from "next/link";
import Login from "@/components/login";
import { isAuthenticated, passwordConfigured } from "@/lib/auth";
import { entriesTagged } from "@/lib/journal";

const displayDate = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date(year, month - 1, day));
};

export default async function TagPage({ params }: { params: Promise<{ tag: string }> }) {
  if (!await isAuthenticated()) return <Login configured={passwordConfigured()} />;
  const tag = (await params).tag.normalize("NFC").replace(/^#/, "");
  const entries = entriesTagged(tag);
  return <main className="tag-page">
    <header className="tag-page-header">
      <div><p className="eyebrow">JOURNAL TAG</p><h1>#{tag}</h1><p>{entries.length} {entries.length === 1 ? "entry" : "entries"}</p></div>
      <Link href="/">Back to journal</Link>
    </header>
    {entries.length > 0 ? <div className="tag-entry-list">
      {entries.map((entry) => <Link className="tag-entry-card" href={`/?date=${entry.date}`} key={entry.date}>
        <span className="tag-entry-date">{displayDate(entry.date)}</span>
        <strong>{entry.excerpt || "A quiet page."}</strong>
        <small>{entry.words} {entry.words === 1 ? "word" : "words"} <b>Open entry →</b></small>
      </Link>)}
    </div> : <section className="tag-empty"><h2>No matching entries</h2><p>This tag may have been renamed or removed.</p></section>}
  </main>;
}
