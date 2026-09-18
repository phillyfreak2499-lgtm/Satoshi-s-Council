import type { BooksWindow } from "@/lib/desk/books";
import { lastWindowFact } from "@/lib/desk/home-still";

/** Under a WAIT with no paper fill: the last graded window, one line. Homepage only. Renders nothing when nothing is graded. */
export function HomeStill({ last }: { last: BooksWindow | null | undefined }) {
  const fact = lastWindowFact(last);
  if (!fact) return null;
  return <p className="company-still"><span className="company-still-label">{fact.label}</span>{" · "}<a href={fact.href}>{fact.text}</a></p>;
}
