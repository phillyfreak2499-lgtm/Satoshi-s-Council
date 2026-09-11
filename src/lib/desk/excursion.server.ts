/**
 * MAE/MFE from the stored replays (server only). Read-only.
 *
 * Joins each booked call in desk_ledger to its replay series, finds the instant
 * the book filled, and walks the path from there. Only calls that were held to
 * settlement on one leg are measured: the retired scalp style exited at a mark,
 * so "what it was worth while open" is not a question with one answer for those.
 *
 * Nothing here is a signal. See the module doc in excursion.ts for why MFE is
 * hindsight and what it can and cannot support.
 */
import { getSql } from "@/lib/db";
import { chairDecisionOf } from "./booked-side";
import { excursionOf, excursionReport, type ExcursionReport, type ExcursionRow, type Mark } from "./excursion.ts";

const TTL_MS = 300_000;

export type ExcursionStudy = ExcursionReport & {
  /** Booked, settled calls that had a replay series to walk. */
  measured: number;
  /** Booked, settled calls with no usable path, and why that is stated. */
  no_path: number;
  at: string;
  authority: { votes: false; note: string };
};

let cache: { at: number; study: ExcursionStudy } | null = null;

type Row = {
  ticker: string;
  winner: string | null;
  chair_lean: string | null;
  entry_cents: number | null;
  settle_cents: number | null;
  ev_cents: number | null;
  cols: { t0?: number; t?: number[]; yes_bid?: number[]; yes_ask?: number[]; booked?: number[] } | null;
};

export async function excursionStudy(): Promise<ExcursionStudy> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.study;
  const db = await getSql();
  const raw = await db<Row>`
    select l.ticker, l.winner, l.chair_lean, l.entry_cents, l.settle_cents, l.ev_cents, r.cols
    from desk_ledger_research l
    -- BOTH halves: joined on the ticker alone, one replay series would multiply
    -- across every ledger window sharing that ticker and each copy would contribute
    -- a row to this study.
    join desk_replay r on r.ticker = l.ticker and r.close_time = l.close_time
    where l.winner in ('UP','DOWN')
      and l.entry_cents is not null
      and l.settle_cents in (0, 100)
      and coalesce(l.calls, 1) = 1
    order by l.close_time
  `;

  const rows: ExcursionRow[] = [];
  let noPath = 0;
  for (const r of raw) {
    const winner = r.winner === "UP" || r.winner === "DOWN" ? r.winner : null;
    const settle = Number(r.settle_cents);
    const side = chairDecisionOf(r.chair_lean, settle, winner);
    const entry = Number(r.entry_cents);
    const c = r.cols;
    const ts = c?.t;
    const t0 = Number(c?.t0);
    if ((side !== "UP" && side !== "DOWN") || !Array.isArray(ts) || !Number.isFinite(t0)) {
      noPath += 1;
      continue;
    }
    // The fill: the first instant the replay recorded the chair holding a call.
    // Without it there is no entry to measure from, and guessing one (the first
    // sample, say) would credit the call with moves before it existed.
    const ix = (c?.booked ?? []).findIndex((v) => Number(v) === 1);
    if (ix < 0) {
      noPath += 1;
      continue;
    }
    const marks: Mark[] = [];
    for (let i = 0; i < ts.length; i++) {
      const bid = Number(c?.yes_bid?.[i]);
      const ask = Number(c?.yes_ask?.[i]);
      if (!Number.isFinite(bid) || !Number.isFinite(ask)) continue;
      marks.push({ t: t0 + Number(ts[i]) * 1000, yes_bid: bid, yes_ask: ask });
    }
    const e = excursionOf(side, entry, t0 + Number(ts[ix]) * 1000, settle, marks);
    if (!e) {
      noPath += 1;
      continue;
    }
    rows.push({ ...e, won: Number(r.ev_cents) > 0, entry });
  }

  const study: ExcursionStudy = {
    ...excursionReport(rows),
    measured: rows.length,
    no_path: noPath,
    at: new Date().toISOString(),
    authority: {
      votes: false,
      note:
        "Descriptive. MFE is measured after the fact and is an upper bound no rule can reach; the verdict says " +
        "what this evidence can and cannot support. Nothing reads these numbers back into a decision, and no " +
        "exit rule exists — one would have to be written down first and then judged on later windows.",
    },
  };
  cache = { at: Date.now(), study };
  return study;
}
