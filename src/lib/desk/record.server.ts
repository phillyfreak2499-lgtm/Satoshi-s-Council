/**
 * The week on the record (server only). Read-only.
 *
 * Score comes from the books' existing last-7-days totals and the process
 * scorecard's week column; the picks come from the same research ledger the
 * books read. Nothing here writes, votes, books, or promotes.
 */
import { booksSummary } from "./books.server";
import { invalidateCondition } from "./floor-clarity";
import { buildWeekRecord, RECORD_DAYS, type RecordLedgerRow, type RecordSeatNote, type WeekRecord } from "./record";

async function sql() {
  const { getSql } = await import("@/lib/db");
  return getSql();
}

type Row = Omit<RecordLedgerRow, "close_time" | "winner" | "replay"> & { close_time: Date | string; winner: string; replay: boolean | null };

const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());
const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Skill statuses by owning seat, read off the shared frame; null when the brain is unreachable in time. */
async function seatStatuses(): Promise<Record<string, RecordSeatNote["statuses"]> | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { getServerFrame } = await import("./server-engine");
    const frame = await Promise.race([
      getServerFrame(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 2_500);
      }),
    ]);
    const skills = frame?.learner?.skills;
    if (!skills) return null;
    const out: Record<string, NonNullable<RecordSeatNote["statuses"]>> = {};
    for (const card of Object.values(skills)) {
      if (!card?.owner || !card.status) continue;
      const s = (out[card.owner] ??= {});
      s[card.status] = (s[card.status] ?? 0) + 1;
    }
    return out;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

let cache: { at: number; body: WeekRecord } | null = null;
let inflight: Promise<WeekRecord> | null = null;

async function build(): Promise<WeekRecord> {
  const db = await sql();
  const [books, raw, statuses] = await Promise.all([
    booksSummary(),
    db<Row>`
      select l.ticker, l.close_time, l.winner, l.chair_lean, l.entry_lean,
        l.entry_cents, l.settle_cents, l.ev_cents, l.entry_fee_cents,
        l.shadow_entry_cents, l.shadow_ev_cents, l.seats,
        exists (select 1 from desk_replay r where r.ticker = l.ticker and r.close_time = l.close_time) as replay
      from desk_ledger_research l
      where l.close_time > now() - (${RECORD_DAYS}::int * interval '1 day')
      order by l.close_time desc
    `,
    seatStatuses(),
  ]);
  const rows: RecordLedgerRow[] = raw
    .filter((r) => r.winner === "UP" || r.winner === "DOWN")
    .map((r) => ({
      ticker: r.ticker,
      close_time: iso(r.close_time),
      winner: r.winner as "UP" | "DOWN",
      chair_lean: r.chair_lean ?? null,
      entry_lean: r.entry_lean ?? null,
      entry_cents: num(r.entry_cents),
      settle_cents: num(r.settle_cents),
      ev_cents: num(r.ev_cents),
      entry_fee_cents: num(r.entry_fee_cents),
      shadow_entry_cents: num(r.shadow_entry_cents),
      shadow_ev_cents: num(r.shadow_ev_cents),
      seats: r.seats && typeof r.seats === "object" ? r.seats : null,
      replay: r.replay === true,
    }));
  const brief = buildWeekRecord({
    now: Date.now(),
    rows,
    week: books.week,
    keeper: books.keeper?.week ?? null,
    missing_windows: (books.missing_windows ?? []).length,
    statuses,
  });
  if (brief.wrong_fill) {
    try {
      const [d] = await db<{ chair_invalidate_if: string | null }>`
        select chair_invalidate_if from desk_decision_snapshots
        where ticker = ${brief.wrong_fill.ticker} and close_time = ${brief.wrong_fill.close_time}::timestamptz
          and snapshot_kind = 'FIRST_DIRECTIONAL'
        limit 1
      `;
      const cond = invalidateCondition(d?.chair_invalidate_if);
      brief.wrong_fill.invalidate = cond || null;
    } catch {
      /* the decision-snapshot table is optional evidence; the brief still reads */
    }
  }
  return brief;
}

/** Cached 30s, like the books it is built from. */
export async function weekRecord(): Promise<WeekRecord> {
  if (cache && Date.now() - cache.at < 30_000) return cache.body;
  inflight ??= build()
    .then((body) => {
      cache = { at: Date.now(), body };
      return body;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
