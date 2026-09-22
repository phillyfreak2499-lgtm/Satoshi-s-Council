import type { BooksWindow } from "@/lib/desk/books";
import { preferFilledFact } from "@/lib/desk/home-still";

/** Under a WAIT with no paper fill: the last graded window, one line. Homepage only. Prefers the last recorded fill when the latest grade sat. Renders nothing when nothing is graded. */
export function HomeStill({ last, fill }: { last: BooksWindow | null | undefined; fill?: BooksWindow | null }) {
  const fact = preferFilledFact(last, fill);
  if (!fact) return null;
  return <p className="company-still"><span className="company-still-label">{fact.label}</span>{" · "}<a href={fact.href}>{fact.text}</a></p>;
}
