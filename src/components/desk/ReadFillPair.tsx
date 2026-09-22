import { readFillPair, READ_FILL_TIP, type ReadFillPairFact } from "@/lib/desk/read-fill";
import type { BookState } from "@/lib/desk/book-floor";
import type { Lean } from "@/lib/desk/types";
import { Tip } from "./Tip";
import "./read-fill.css";

export function ReadFillPair({
  lean,
  book,
}: {
  lean: Lean | string | null | undefined;
  book: BookState | null | undefined;
}) {
  const pair: ReadFillPairFact = readFillPair(lean, book);
  return (
    <div className="read-fill-pair" aria-label="Chair read and paper book">
      <div className="read-fill-col">
        <span className="read-fill-kicker">Chair read</span>
        <strong className="read-fill-value" data-lean={pair.read.toLowerCase()}>
          {pair.read}
        </strong>
      </div>
      <div className="read-fill-rule" aria-hidden="true" />
      <div className="read-fill-col">
        <span className="read-fill-kicker">Paper book</span>
        <strong className="read-fill-value">{pair.fill}</strong>
        <span className="read-fill-detail">{pair.fillDetail}</span>
      </div>
      <p className="read-fill-tip">
        <Tip k="read.fill">{READ_FILL_TIP}</Tip>
      </p>
    </div>
  );
}
