import type { ChamberStatement } from "./chamber-reactions.ts";
import { booksSeatEvidence, compareRosters } from "./roster-evidence.ts";

export type ChamberLedgerRow = {
  ticker: string;
  close_time: string | Date;
  winner: "UP" | "DOWN";
  seats: Parameters<typeof booksSeatEvidence>[3];
};

/** A read-side join. It cannot rewrite a dispatch, a decision, or a grade. */
export function withBooksRoster(statement: ChamberStatement, rows: ChamberLedgerRow[]): ChamberStatement {
  if (statement.evidence.kind !== "chair-wait") return statement;
  const e = statement.evidence;
  const row = rows.find((r) => r.ticker === e.ticker && new Date(r.close_time).getTime() === e.close_time);
  const books = row ? booksSeatEvidence(row.ticker, new Date(row.close_time).getTime(), row.winner, row.seats) : null;
  return {
    ...statement,
    evidence: { ...e, books_roster: books?.roster ?? null, books_seats: books?.seats,
      books_check: books ? compareRosters(e.roster ?? null, books.roster)
        : { status: "MISSING", note: "A graded Books row for this exact window is not available." },
    },
  };
}
