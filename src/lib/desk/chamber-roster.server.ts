import { withBooksRoster, type ChamberLedgerRow } from "./chamber-roster";
import type { ChamberStatement } from "./chamber-reactions";

/** Exact window pairs only. Read failures remain visible as missing evidence. */
export async function attachBooksRosters(statements: ChamberStatement[]): Promise<ChamberStatement[]> {
  const wanted = statements.filter((s) => s.evidence.kind === "chair-wait" && s.evidence.ticker && s.evidence.close_time)
    .map((s) => ({ ticker: s.evidence.ticker, close_time: new Date(s.evidence.close_time!).toISOString() }));
  if (!wanted.length) return statements;
  try {
    const { getSql } = await import("@/lib/db");
    const db = await getSql();
    const rows = await db.query<ChamberLedgerRow>(
      `select l.ticker, l.close_time, l.winner, l.seats from desk_ledger_research l
       where exists (select 1 from jsonb_to_recordset($1::jsonb) as w(ticker text, close_time timestamptz)
                     where w.ticker = l.ticker and w.close_time = l.close_time)`,
      [JSON.stringify(wanted)],
    );
    return statements.map((s) => withBooksRoster(s, rows));
  } catch {
    return statements.map((s) => s.evidence.kind !== "chair-wait" ? s : {
      ...s, evidence: { ...s.evidence, books_check: { status: "MISSING" as const, note: "Books roster could not be read. Comparison unavailable." } },
    });
  }
}
