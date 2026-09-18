import type { BooksWindow } from "@/lib/desk/books";
import { stillFacts } from "@/lib/desk/home-still";
import type { BooksColumn } from "@/lib/desk/record";

/** Under a WAIT with no paper fill: the last graded window and the week's book. Homepage only. Renders nothing when nothing is graded. */
export function HomeStill({ last, week }: { last: BooksWindow | null | undefined; week: BooksColumn | null | undefined }) {
  const facts = stillFacts(last, week);
  if (!facts.length) return null;
  return <ul className="company-still" aria-label="The record so far">
    {facts.map((fact) => <li key={fact.id}><span className="company-still-label">{fact.label}</span>{` · ${fact.text} `}<a href={fact.href}>{fact.link} <span aria-hidden="true">→</span></a></li>)}
  </ul>;
}
