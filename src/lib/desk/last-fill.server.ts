/**
 * Newest graded window that booked a paper side.
 *
 * Read-only. Skips sits. Uses the books cache when the last 40 grades
 * already contain a fill; otherwise one ledger lookup. Null when the
 * book has never filled. Paper only. No authority.
 */
import type { BooksWindow } from "./books";
import { bookedSideOf } from "./booked-side";

function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

export async function lastFilledWindow(): Promise<BooksWindow | null> {
  const { booksSummary } = await import("./books.server");
  const books = await booksSummary();
  const hit = books.windows.find((w) => w.call != null) ?? null;
  if (hit) return hit;
  try {
    const { getSql } = await import("@/lib/db");
    const db = await getSql();
    const [r] = await db<{
      ticker: string;
      close_time: Date | string;
      winner: string;
      official_value: number | null;
      settle_avg: number | null;
      brti_prints: number | null;
      entry_cents: number;
      settle_cents: number | null;
      ev_cents: number | null;
    }>`
      select ticker, close_time, winner, official_value, settle_avg, brti_prints,
        entry_cents, settle_cents, ev_cents
      from desk_ledger_research
      where entry_cents is not null
      order by close_time desc
      limit 1
    `;
    if (!r) return null;
    const winner: "UP" | "DOWN" = r.winner === "UP" ? "UP" : "DOWN";
    return {
      ticker: r.ticker,
      close_time: iso(r.close_time),
      winner,
      official: r.official_value,
      settle_avg: r.settle_avg,
      prints: r.brti_prints,
      call: {
        lean: bookedSideOf(r.settle_cents, winner),
        entry: r.entry_cents,
        settle: r.settle_cents,
        ev: r.ev_cents,
      },
      seats: { n: 0, right: 0 },
      raw: { n: 0, right: 0 },
      arena: null,
      replay: false,
    };
  } catch {
    return null;
  }
}
