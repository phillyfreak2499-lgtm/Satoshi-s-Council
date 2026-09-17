/**
 * Prospective Chair v3 shadow observer.
 *
 * This module reads the already-finalized public research frame and writes ONE
 * frozen v3 prediction per window to its own table before settlement. It never
 * returns a value to the live Chair, paper book, learner, or entry policy.
 */
import { getSql } from "@/lib/db";
import { extractFeatures, V2_SAMPLE_MINS } from "./chair-v2";
import {
  V3_VERSION,
  brier,
  fitV3,
  logLoss,
  predictV3,
  v3FeaturesFromStored,
  type V3FitRow,
} from "./chair-v3";
import { tickerAgrees } from "./window-identity";

/** Frozen design boundary. Anything before this remains exploratory history. */
export const V3_PROSPECTIVE_SINCE = Date.parse("2026-09-16T21:00:00.000Z");
export const V3_MEASUREMENT_VERSION = "valid-official-v2";
const OBSERVER_MS = 2_000;
const TRAIN_CAP = 1_800;
const SAMPLE_MIN_MINS = 2.2;

type StoredTraining = {
  ticker: string;
  close_ms: number | string;
  winner: string;
  features: Record<string, unknown> | null;
  market: Record<string, unknown> | null;
};

type ProspectiveRow = {
  ticker: string;
  close_ms: number | string;
  taken_ms: number | string;
  secs_left: number;
  version: number;
  market_p: number;
  v3_p: number;
  adjustment_pp: number;
  model_n: number;
  winner: string | null;
};

type Observer = {
  timer: ReturnType<typeof setInterval> | null;
  inFlight: boolean;
  sampled: Set<string>;
  lastError: string | null;
  lastCapturedAt: number;
};

const g = globalThis as typeof globalThis & { __chairV3Prospective__?: Observer };
function observer(): Observer {
  return (g.__chairV3Prospective__ ??= { timer: null, inFlight: false, sampled: new Set(), lastError: null, lastCapturedAt: 0 });
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function trainingRow(r: StoredTraining): V3FitRow | null {
  if (r.winner !== "UP" && r.winner !== "DOWN") return null;
  const close = num(r.close_ms);
  const mid = num(r.market?.yes_mid);
  const fair = num(r.market?.fair_yes);
  if (close == null || tickerAgrees(r.ticker, close) !== true || mid == null || !(mid > 0 && mid < 100)) return null;
  const marketP = mid / 100;
  return {
    close_time: close,
    winner: r.winner,
    market_p: marketP,
    features: v3FeaturesFromStored(r.features, marketP, fair == null ? null : fair / 100),
  };
}

/** Fit from already-graded closes STRICTLY earlier than the window being predicted. */
async function weightsBefore(closeMs: number) {
  const db = await getSql();
  const raw = await db<StoredTraining>`
    select ticker, close_ms, winner, features, market from (
      select
        s.ticker, (extract(epoch from s.close_time) * 1000)::bigint as close_ms,
        l.winner, s.features, s.market
      from desk_samples s
      join desk_ledger_research l on l.ticker = s.ticker and l.close_time = s.close_time
      where l.winner in ('UP', 'DOWN') and l.source = 'kalshi-result'
        and s.taken_at < s.close_time and l.graded_at < ${new Date(closeMs).toISOString()}
        and s.close_time < ${new Date(closeMs).toISOString()}
      order by s.close_time desc
      limit ${TRAIN_CAP}
    ) q order by close_ms asc
  `;
  const rows = raw.map(trainingRow).filter((r): r is V3FitRow => Boolean(r));
  return fitV3(rows, Date.now());
}

async function captureOnce(): Promise<void> {
  const st = observer();
  if (st.inFlight || Date.now() < V3_PROSPECTIVE_SINCE) return;
  st.inFlight = true;
  try {
    // Dynamic on purpose: server-engine never imports this observer, so v3 has no
    // return path into the decision loop.
    const { getServerFrame } = await import("./server-engine");
    const frame = await getServerFrame();
    const { snap, votes } = structuredClone({ snap: frame.snap, votes: frame.votes });
    if (!snap || snap.demo || snap.as_of < V3_PROSPECTIVE_SINCE) return;
    if (!snap.ticker || tickerAgrees(snap.ticker, snap.close_time) === false) return;
    if (snap.mins_left > V2_SAMPLE_MINS || snap.mins_left <= SAMPLE_MIN_MINS) return;
    if (!(snap.yes_mid > 0 && snap.yes_mid < 100) || !(snap.yes_ask > 0)) return;
    if (snap.chalk || (snap.health.spot === "DOWN" && snap.health.kalshi === "DOWN")) return;

    const key = `${snap.ticker}|${snap.close_time}`;
    if (st.sampled.has(key)) return;

    const marketP = snap.yes_mid / 100;
    const all = extractFeatures(votes, snap) as Record<string, unknown>;
    const features = v3FeaturesFromStored(all, marketP, snap.fair_yes / 100);
    const weights = await weightsBefore(snap.as_of);
    const pred = predictV3(weights, marketP, features);
    const db = await getSql();
    await db`
      insert into desk_v3_samples
        (ticker, close_time, taken_at, secs_left, version,
         market_p, v3_p, raw_v3_p, adjustment_pp, correction_logit,
         model_n, model_fitted_at, features, build_sha, measurement_version)
      select
         ${snap.ticker}, ${new Date(snap.close_time).toISOString()}::timestamptz, ${new Date(snap.as_of).toISOString()}::timestamptz, ${snap.secs_left}, ${V3_VERSION},
         ${pred.p_market}, ${pred.p_up}, ${pred.raw_p_up}, ${pred.adjustment_pp}, ${pred.correction_logit},
         ${pred.model_n}, ${weights ? new Date(weights.fitted_at).toISOString() : null}::timestamptz, ${JSON.stringify(features)}::jsonb,
         ${process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? ""}, ${V3_MEASUREMENT_VERSION}
      where clock_timestamp() < ${new Date(snap.close_time).toISOString()}::timestamptz
      on conflict (ticker, close_time) do nothing
    `;
    st.sampled.add(key);
    st.lastCapturedAt = Date.now();
    st.lastError = null;
  } catch (err) {
    st.lastError = err instanceof Error ? err.message : String(err);
  } finally {
    st.inFlight = false;
  }
}

/** Idempotent observer boot. Healthz starts it beside, never inside, the brain. */
export function ensureChairV3ProspectiveObserver(): void {
  const st = observer();
  if (st.timer) return;
  st.timer = setInterval(() => void captureOnce(), OBSERVER_MS);
  void captureOnce();
}

export function chairV3ProspectiveHealth() {
  const st = observer();
  return {
    started: Boolean(st.timer),
    last_captured_at: st.lastCapturedAt ? new Date(st.lastCapturedAt).toISOString() : null,
    last_error: st.lastError,
  };
}

function round(n: number, d = 6) { return Math.round(n * 10 ** d) / 10 ** d; }

/** Read-only prospective scorecard; outcomes are joined only AFTER the stored prediction exists. */
export async function chairV3ProspectiveSnapshot() {
  const db = await getSql();
  const rows = await db<ProspectiveRow>`
    select
      v.ticker,
      (extract(epoch from v.close_time) * 1000)::bigint as close_ms,
      (extract(epoch from v.taken_at) * 1000)::bigint as taken_ms,
      v.secs_left, v.version, v.market_p, v.v3_p, v.adjustment_pp, v.model_n,
      l.winner
    from desk_v3_samples v
    left join desk_ledger_research l
      on l.ticker = v.ticker and l.close_time = v.close_time and l.source = 'kalshi-result'
    where v.taken_at >= ${new Date(V3_PROSPECTIVE_SINCE).toISOString()}
      and v.measurement_version = ${V3_MEASUREMENT_VERSION}
      and v.taken_at < v.close_time
    order by v.close_time asc
  `;
  const graded = rows.filter((r): r is ProspectiveRow & { winner: "UP" | "DOWN" } => r.winner === "UP" || r.winner === "DOWN");
  const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const mb = avg(graded.map((r) => brier(r.market_p, r.winner)));
  const vb = avg(graded.map((r) => brier(r.v3_p, r.winner)));
  const ml = avg(graded.map((r) => logLoss(r.market_p, r.winner)));
  const vl = avg(graded.map((r) => logLoss(r.v3_p, r.winner)));
  const preClose = rows.filter((r) => Number(r.taken_ms) < Number(r.close_ms)).length;
  return {
    since: new Date(V3_PROSPECTIVE_SINCE).toISOString(),
    measurement_version: V3_MEASUREMENT_VERSION,
    first_capture: rows.length ? new Date(Number(rows[0]!.taken_ms)).toISOString() : null,
    evidence: "prospective-frozen-before-settlement",
    authority: { live_chair: false, paper_book: false, promotion: false },
    captured: rows.length,
    graded: graded.length,
    pre_close: preClose,
    market_brier: mb == null ? null : round(mb),
    v3_brier: vb == null ? null : round(vb),
    brier_delta: mb == null || vb == null ? null : round(mb - vb),
    market_log_loss: ml == null ? null : round(ml),
    v3_log_loss: vl == null ? null : round(vl),
    avg_abs_adjustment_pp: rows.length ? round(rows.reduce((s, r) => s + Math.abs(r.adjustment_pp), 0) / rows.length, 3) : null,
    health: chairV3ProspectiveHealth(),
    recent: rows.slice(-16).reverse().map((r) => ({
      ticker: r.ticker,
      close_time: new Date(Number(r.close_ms)).toISOString(),
      taken_at: new Date(Number(r.taken_ms)).toISOString(),
      secs_left: r.secs_left,
      market_p: r.market_p,
      v3_p: r.v3_p,
      adjustment_pp: r.adjustment_pp,
      model_n: r.model_n,
      winner: r.winner,
    })),
  };
}
