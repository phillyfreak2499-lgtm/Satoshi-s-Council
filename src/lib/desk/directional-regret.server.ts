import { join } from "node:path";
import { RegretJournal } from "./regret-journal.server";
import { getSql } from "@/lib/db";
import { regretObservation, regretNet, regretBand, REGRET_BANDS } from "./directional-regret";
import { notifyDirectionalRead } from "./push.server";
import type { ChairResult, Snapshot } from "./types";

type Observation = NonNullable<ReturnType<typeof regretObservation>> & { build: string };
const journal = new RegretJournal<Observation>(join(process.cwd(), "data", "directional-regret"));
let captureFailures = 0;
let lastCaptureError: string | null = null;
let appendSerial: Promise<void> = Promise.resolve();
let drainSerial: Promise<void> = Promise.resolve();
/** Downstream observation only. Journal append precedes publication and SQL.
 * WAIT ticks also retry the journal, so a DB outage cannot strand a prior read. */
export async function captureDirectionalRegret(
  snap: Snapshot,
  chair: ChairResult,
  reasons: string[],
  booked: boolean,
) {
  const row = regretObservation(snap, chair, reasons, booked);
  // Persist the next observation independently of slow SQL or push providers.
  const appended = appendSerial.then(async () => {
    if (row) await journal.append({ ...row, build: process.env.RENDER_GIT_COMMIT || "" });
  });
  appendSerial = appended.catch((error) => {
    captureFailures++;
    lastCaptureError = String(error);
    console.error("directional regret journal append failed", error);
  });
  drainSerial = drainSerial.then(async () => {
    try {
      await appended;
      await journal.drain(async (r) => {
        const db = await getSql();
        await db`insert into desk_directional_regret(ticker,close_time,observed_at,side,ask_cents,fee_cents,reasons,build_sha,chair_stage,evidence)
          values (${r.ticker},${new Date(r.close)},${new Date(r.observed)},${r.side},${r.ask},${r.fee},
            ${JSON.stringify(r.reasons)}::jsonb,${r.build},'final-chair',${JSON.stringify(r.evidence)}::jsonb)
          on conflict do nothing`;
        // Do not deliver expired research alerts recovered from an outage.
        if (Date.now() < r.close && Date.now() - r.observed < 900000) {
          try {
            await notifyDirectionalRead(r.side, r.reasons.join("; "), r.close, r.ticker);
          } catch (error) {
            console.error("directional read push failed", error);
          }
        }
      });
      lastCaptureError = null;
    } catch (error) {
      captureFailures++;
      lastCaptureError = error instanceof Error ? error.message : String(error);
      console.error("directional regret capture failed", lastCaptureError);
    }
  });
  await appendSerial;
}
export async function directionalRegretReport() {
  const db = await getSql();
  // First observed unbooked direction per WINDOW, not every repeated tick as a new trade.
  // Exact ledger identity supplies official settlement and later-booking information,
  // including receipts recovered after a collector restart.
  const rows = await db<{
    ticker: string;
    close_time: string;
    side: string;
    ask_cents: number | null;
    fee_cents: number | null;
    reasons: string[];
    observed_at: string;
    winner: string | null;
    booked_later: boolean;
    observations: number;
  }>`with first_reads as (
    select distinct on (ticker,close_time) *, count(*) over(partition by ticker,close_time)::int as observations
    from desk_directional_regret order by ticker,close_time,observed_at,side
  ) select r.*, case when l.source = 'kalshi-result' then l.winner end as winner, coalesce(l.entry_cents is not null,false) as booked_later
    from first_reads r left join desk_ledger_research l on l.ticker=r.ticker and l.close_time=r.close_time
    order by r.close_time desc`;
  const bands = REGRET_BANDS.map((band) => ({
    band,
    windows: 0,
    observations: 0,
    settled: 0,
    pending: 0,
    missing_ask: 0,
    booked_later: 0,
    never_booked_net_cents: 0,
    net_cents: 0,
    wins: 0,
    cost_cents: 0,
    floor_only_windows: 0,
    floor_only_net_cents: 0,
  }));
  for (const r of rows) {
    const b = bands.find((b) => b.band === regretBand(r.ask_cents))!;
    b.windows++;
    b.observations += r.observations;
    if (r.booked_later) b.booked_later++;
    if (r.ask_cents == null || r.fee_cents == null) {
      b.missing_ask++;
      continue;
    }
    if (r.winner !== "UP" && r.winner !== "DOWN") {
      b.pending++;
      continue;
    }
    const net = regretNet(r.side, r.ask_cents, r.fee_cents, r.winner);
    b.settled++;
    b.net_cents += net;
    if (!r.booked_later) b.never_booked_net_cents += net;
    b.cost_cents += r.ask_cents + r.fee_cents;
    b.wins += Number(r.side === r.winner);
    if (r.reasons.length === 1 && r.reasons[0].includes("below the 80¢ paper floor")) {
      b.floor_only_windows++;
      b.floor_only_net_cents += net;
    }
  }
  for (const b of bands) {
    b.net_cents = Math.round(b.net_cents * 10) / 10;
    b.floor_only_net_cents = Math.round(b.floor_only_net_cents * 10) / 10;
  }
  const observations = await db<{ ask_cents: number | null; net_cents: number | null }>`select r.*,
    case when l.source='kalshi-result' and l.winner in ('UP','DOWN') and r.ask_cents is not null
      then (case when l.winner=r.side then 100 else 0 end)-r.ask_cents-r.fee_cents end as net_cents,
    case when l.source='kalshi-result' then l.winner end as winner,
    coalesce(l.entry_cents is not null,false) as booked_later
    from desk_directional_regret r left join desk_ledger_research l
      on l.ticker=r.ticker and l.close_time=r.close_time order by r.observed_at desc,r.ticker,r.side`;
  const observation_bands = REGRET_BANDS.map((band) => {
    const reads = observations.filter((r) => regretBand(r.ask_cents) === band);
    return {
      band,
      observations: reads.length,
      settled: reads.filter((r) => r.net_cents != null).length,
      net_cents: Math.round(reads.reduce((sum, r) => sum + (r.net_cents ?? 0), 0) * 10) / 10,
    };
  });
  return {
    observation_bands,
    observations,
    fee_engine: "KALSHI_TAKER_7PCT_CEIL_CENT_V1",
    prospective: true,
    historical_complete: false,
    definition:
      "First unbooked final-Chair direction per window, at its observed ask. All captured frames retained. Hypothetical one-contract taker result; not a fill, executable strategy or production P&L.",
    limits:
      "No historical backfill claimed. Missing quotes, excluded windows and unverified outcomes excluded from P&L. Repeated frames are not independent trades. Later bookings flagged; floor-only blockers separated. Capture failures are surfaced, not treated as WAIT.",
    pending_journal: journal.pending,
    capture_failures_since_boot: captureFailures,
    last_capture_error: lastCaptureError,
    start_at: rows.length
      ? rows.reduce((a, r) => (r.observed_at < a ? r.observed_at : a), rows[0]!.observed_at)
      : null,
    bands,
    windows: rows,
  };
}
