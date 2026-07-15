import Link from "next/link";
import Login from "@/components/login";
import { isAuthenticated, passwordConfigured } from "@/lib/auth";
import { entriesMentioning } from "@/lib/journal";

const displayDate = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date(year, month - 1, day));
};

export default async function PersonPage({ params }: { params: Promise<{ person: string }> }) {
  if (!await isAuthenticated()) return <Login configured={passwordConfigured()} />;
  const encodedPerson = (await params).person;
  let decodedPerson = encodedPerson;
  try { decodedPerson = decodeURIComponent(encodedPerson); } catch { /* Treat malformed escapes as a literal name. */ }
  const person = decodedPerson.normalize("NFC").replace(/^@/, "");
  const entries = entriesMentioning(person);
  return <main className="tag-page">
    <header className="tag-page-header">
      <div><p className="eyebrow">JOURNAL PERSON</p><h1>@{person}</h1><p>{entries.length} {entries.length === 1 ? "entry" : "entries"}</p></div>
      <Link href="/">Back to journal</Link>
    </header>
    {entries.length > 0 ? <div className="tag-entry-list">
      {entries.map((entry) => <Link className="tag-entry-card" href={`/?date=${entry.date}`} key={entry.date}>
        <span className="tag-entry-date">{displayDate(entry.date)}</span>
        <strong>{entry.excerpt || "A quiet page."}</strong>
        <small>{entry.words} {entry.words === 1 ? "word" : "words"} <b>Open entry →</b></small>
      </Link>)}
    </div> : <section className="tag-empty"><h2>No matching entries</h2><p>This person may have been renamed or removed.</p></section>}
  </main>;
}
