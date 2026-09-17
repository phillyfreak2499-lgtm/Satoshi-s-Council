/** Sidecar observer and read-only reports. Writes only the new measurement table. */
import { getSql } from "@/lib/db";
import { extractFeatures } from "./chair-v2";
import { fitV3, predictV3, v3FeaturesFromStored, type V3FitRow } from "./chair-v3";
import { CALL_QUALITY_RULES, CALL_QUALITY_STUDY, captureQuality, checkpointCoverage, netSummary, qualityEligibility, qualityHorizon, qualityIssues, qualityReport, type QualityObservation } from "./call-quality";
import { tickerAgrees } from "./window-identity";

type Stored = Omit<QualityObservation, "close_ms" | "taken_ms" | "recorded_ms"> & {
  close_ms: number | string; taken_ms: number | string; recorded_ms: number | string;
};
const normalize = (r: Stored): QualityObservation => ({ ...r, close_ms: Number(r.close_ms), taken_ms: Number(r.taken_ms), recorded_ms: Number(r.recorded_ms) });
type Observer = { timer: ReturnType<typeof setInterval> | null; busy: boolean; seen: Map<string, number>; lastCapture: number | null; error: string | null };
const global = globalThis as typeof globalThis & { __callQuality__?: Observer };
const state = (): Observer => global.__callQuality__ ??= { timer: null, busy: false, seen: new Map(), lastCapture: null, error: null };

/** All fits use this experiment's SAME horizon and policy, graded before this frame. */
async function training(horizon: number, policy: string, before: number) {
  const sql = await getSql();
  const stored = await sql<Stored>`
    select q.ticker, (extract(epoch from q.close_time) * 1000)::bigint as close_ms,
      (extract(epoch from q.taken_at) * 1000)::bigint as taken_ms,
      (extract(epoch from q.recorded_at) * 1000)::bigint as recorded_ms,
      q.horizon, q.entry_policy, q.capture_valid, q.receipt, l.winner, l.source, l.research_quality
    from desk_call_quality q
    join desk_ledger_research l on l.ticker = q.ticker and l.close_time = q.close_time
    where q.study = ${CALL_QUALITY_STUDY} and q.horizon = ${horizon} and q.entry_policy = ${policy}
      and q.capture_valid = true and l.source = 'kalshi-result' and l.winner in ('UP', 'DOWN')
      and q.close_time < ${new Date(before).toISOString()} and l.graded_at < ${new Date(before).toISOString()}
    order by q.close_time desc limit ${CALL_QUALITY_RULES.train_cap}
  `;
  const rows: V3FitRow[] = stored.map(normalize).filter(r => qualityEligibility(r) === "graded" && r.receipt.market_p != null)
    .map(r => ({ close_time: r.close_ms, winner: r.winner as "UP" | "DOWN", market_p: r.receipt.market_p!, features: r.receipt.features })).reverse();
  return { weights: fitV3(rows, before), through: rows.at(-1)?.close_time ?? null };
}

async function capture() {
  const st = state();
  if (st.busy) return;
  st.busy = true;
  try {
    const { currentSnap, getServerFrame } = await import("./server-engine");
    const current = currentSnap();
    if (!current || qualityHorizon(current, Date.now()) == null) return;
    // Clone before the first DB await: later ticks cannot rewrite this evidence.
    const frame = await getServerFrame();
    const { snap, chair, votes, selective } = structuredClone({ snap: frame.snap, chair: frame.chair, votes: frame.votes, selective: frame.selective });
    if (!snap || !chair || !selective.audit) return;
    const horizon = qualityHorizon(snap, Date.now());
    if (horizon == null) return;
    const key = `${snap.ticker}|${snap.close_time}|${horizon}`;
    for (const [k, close] of st.seen) if (close < Date.now() - 900_000) st.seen.delete(k);
    if (st.seen.has(key)) return;
    const features = v3FeaturesFromStored(extractFeatures(votes, snap), snap.yes_mid / 100, snap.fair_yes / 100);
    const trained = qualityIssues(snap).length ? { weights: null, through: null } : await training(horizon, selective.policy, snap.as_of);
    const prediction = qualityIssues(snap).length ? null : predictV3(trained.weights, snap.yes_mid / 100, features);
    const receipt = captureQuality(snap, chair, votes, selective.audit, features, prediction, trained.through, trained.weights);
    // A slow DB/fit must not turn an old frame into a retrospectively saved call.
    if (qualityHorizon(snap, Date.now()) !== horizon) return;
    const sql = await getSql();
    const written = await sql<{ recorded_at: string }>`
      insert into desk_call_quality (study, ticker, close_time, horizon, taken_at, entry_policy, capture_valid, receipt, build_sha)
      select ${CALL_QUALITY_STUDY}, ${snap.ticker}, ${new Date(snap.close_time).toISOString()}::timestamptz,
        ${horizon}, ${new Date(snap.as_of).toISOString()}::timestamptz, ${selective.policy}, ${receipt.quality_issues.length === 0},
        ${JSON.stringify(receipt)}::jsonb, ${process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? ""}
      where clock_timestamp() < ${new Date(snap.as_of + 10_000).toISOString()}::timestamptz
      on conflict (study, ticker, close_time, horizon) do nothing returning recorded_at
    `;
    st.seen.set(key, snap.close_time);
    if (written.length) st.lastCapture = Date.now();
    st.error = null;
  } catch (error) { st.error = error instanceof Error ? error.message : String(error); }
  finally { st.busy = false; }
}

export function ensureCallQualityObserver() {
  const st = state();
  if (st.timer) return;
  st.timer = setInterval(() => void capture(), 2_000);
  void capture();
}

type Fill = { ticker: string; close_ms: string | number; signal_policy: string; entry_policy: string; risk_policy: string;
  entry_side: string; entry_cents: number; entry_fee_cents: number; winner: string };

async function buildSnapshot() {
  const sql = await getSql();
  const [stored, fills, coverage] = await Promise.all([
    sql<Stored>`
      select q.ticker, (extract(epoch from q.close_time) * 1000)::bigint as close_ms,
        (extract(epoch from q.taken_at) * 1000)::bigint as taken_ms,
        (extract(epoch from q.recorded_at) * 1000)::bigint as recorded_ms,
        q.horizon, q.entry_policy, q.capture_valid, q.receipt, l.winner, l.source, l.research_quality
      from desk_call_quality q
      left join desk_ledger l on l.ticker = q.ticker and l.close_time = q.close_time
      where q.study = ${CALL_QUALITY_STUDY} and q.close_time >= now() - interval '90 days'
      order by q.close_time asc`,
    sql<Fill>`
      select f.ticker, (extract(epoch from f.close_time) * 1000)::bigint as close_ms,
        f.signal_policy, f.entry_policy, f.risk_policy, f.entry_side, f.entry_cents, f.entry_fee_cents, l.winner
      from desk_policy_fills f
      join desk_ledger_research l on l.ticker = f.ticker and l.close_time = f.close_time
      where l.source = 'kalshi-result' and l.winner in ('UP', 'DOWN') and f.close_time >= now() - interval '90 days'
      order by f.close_time asc`,
    // Bare ledger here is intentional: quality exclusions must remain visible.
    sql<{ held: number; missing: number; unversioned: number }>`
      select (select count(*)::int from desk_ledger where research_quality <> 'valid' and close_time >= now() - interval '90 days') as held,
        (select count(*)::int from desk_policy_fills f left join desk_ledger l on l.ticker = f.ticker and l.close_time = f.close_time
          where f.close_time < now() and f.close_time >= now() - interval '90 days' and
            (l.winner is null or l.winner not in ('UP', 'DOWN') or l.source <> 'kalshi-result' or l.research_quality <> 'valid')) as missing,
        (select count(*)::int from desk_ledger_research l left join desk_policy_fills f on f.ticker = l.ticker and f.close_time = l.close_time
          where l.close_time >= now() - interval '90 days' and l.entry_cents is not null and f.fill_key is null) as unversioned`,
  ]);
  const validFills = fills.filter(f => tickerAgrees(f.ticker, Number(f.close_ms)) === true &&
    (f.entry_side === "UP" || f.entry_side === "DOWN") && Number.isFinite(f.entry_cents) && f.entry_cents > 0 && f.entry_cents < 100 &&
    Number.isFinite(f.entry_fee_cents) && f.entry_fee_cents >= 0);
  const key = (f: Fill) => `${f.signal_policy}|${f.entry_policy}|${f.risk_policy}`;
  const policies = [...new Set(validFills.map(key))].map(id => {
    const rows = validFills.filter(f => key(f) === id);
    return { id, signal: rows[0]!.signal_policy, entry: rows[0]!.entry_policy, risk: rows[0]!.risk_policy,
      first_close: new Date(Number(rows[0]!.close_ms)).toISOString(), last_close: new Date(Number(rows.at(-1)!.close_ms)).toISOString(),
      ...netSummary(rows.map(f => (f.entry_side === f.winner ? 100 : 0) - f.entry_cents - f.entry_fee_cents)) };
  });
  const st = state();
  return { at: new Date().toISOString(), study: CALL_QUALITY_STUDY, authority: "none" as const, lookback_days: 90,
    rules: CALL_QUALITY_RULES, groups: qualityReport(stored.map(normalize), Date.now()), policies,
    coverage: { ...coverage[0]!, invalid_fills: fills.length - validFills.length, checkpoints: checkpointCoverage(stored.map(normalize), Date.now()) },
    observer: { started: Boolean(st.timer), last_capture: st.lastCapture ? new Date(st.lastCapture).toISOString() : null, error: st.error != null },
  };
}
export type CallQualitySnapshot = Awaited<ReturnType<typeof buildSnapshot>>;
let cache: { at: number; value: CallQualitySnapshot } | null = null;
let pending: Promise<CallQualitySnapshot> | null = null;
export async function callQualitySnapshot(): Promise<CallQualitySnapshot> {
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  pending ??= buildSnapshot().then(value => { cache = { at: Date.now(), value }; return value; }).finally(() => { pending = null; });
  return pending;
}
