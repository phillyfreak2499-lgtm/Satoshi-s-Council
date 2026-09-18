/**
 * FORCED_DIRECTION_V4 prospective shadow observer.
 *
 * Reads one finalized server frame in the T-7:30 checkpoint, freezes exactly one
 * UP/DOWN direction, and writes only desk_v4_forced. It has no return path into
 * Chair, learner, entry policy, promotion, or the paper book.
 */
import { getSql } from "@/lib/db";
import { extractFeatures } from "./chair-v2";
import {
  brier,
  fitV3,
  v3FeaturesFromStored,
  type V3FitRow,
} from "./chair-v3";
import {
  V4_LOCK_GRACE_SECS,
  V4_LOCK_SECS,
  V4_STUDY,
  V4_TRAIN_CAP,
  V4_VERSION,
  inV4Lock,
  predictForcedV4,
  v4Hit,
  v4QuotedNet,
  type V4Side,
} from "./forced-v4";
import { tickerAgrees } from "./window-identity";

export const V4_PROSPECTIVE_SINCE = Date.parse("2026-09-18T18:45:00.000Z");
export const V4_MEASUREMENT_VERSION = "forced-direction-v1-t450";
const OBSERVER_MS = 2_000;

type StoredTraining = {
  ticker: string;
  close_ms: number | string;
  winner: string;
  features: Record<string, unknown> | null;
  market: Record<string, unknown> | null;
};

type V4StoredRow = {
  ticker: string;
  close_ms: number | string;
  taken_ms: number | string;
  secs_left: number;
  market_p: number;
  fair_p: number | null;
  p_up: number;
  side: V4Side;
  model_n: number;
  correction_logit: number;
  chair_lean: "UP" | "DOWN" | "WAIT";
  entry_cents: number | null;
  winner: string | null;
};

type Observer = {
  timer: ReturnType<typeof setInterval> | null;
  inFlight: boolean;
  sampled: Set<string>;
  lastError: string | null;
  lastCapturedAt: number;
};

const g = globalThis as typeof globalThis & { __forcedV4Observer__?: Observer };

function observer(): Observer {
  return (g.__forcedV4Observer__ ??= {
    timer: null,
    inFlight: false,
    sampled: new Set(),
    lastError: null,
    lastCapturedAt: 0,
  });
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const centsProb = (v: unknown): number | null => {
  const n = num(v);
  return n != null && n >= 0 && n <= 100 ? n / 100 : null;
};

function trainingRow(r: StoredTraining): V3FitRow | null {
  if (r.winner !== "UP" && r.winner !== "DOWN") return null;
  const close = num(r.close_ms);
  const mid = num(r.market?.yes_mid);
  const fair = num(r.market?.fair_yes);
  if (close == null || tickerAgrees(r.ticker, close) !== true || mid == null || !(mid > 0 && mid < 100)) {
    return null;
  }
  const marketP = mid / 100;
  return {
    close_time: close,
    winner: r.winner,
    market_p: marketP,
    features: v3FeaturesFromStored(r.features, marketP, fair == null ? null : fair / 100),
  };
}

/** Strictly prior, quality-valid, officially graded training only. */
async function weightsBefore(takenMs: number, closeMs: number) {
  const db = await getSql();
  const raw = await db<StoredTraining>`
    select ticker, close_ms, winner, features, market from (
      select
        s.ticker,
        (extract(epoch from s.close_time) * 1000)::bigint as close_ms,
        l.winner,
        s.features,
        s.market
      from desk_samples s
      join desk_ledger_research l
        on l.ticker = s.ticker and l.close_time = s.close_time
      where l.winner in ('UP', 'DOWN')
        and l.source = 'kalshi-result'
        and s.taken_at < s.close_time
        and s.close_time < ${new Date(closeMs).toISOString()}::timestamptz
        and l.graded_at < ${new Date(takenMs).toISOString()}::timestamptz
      order by s.close_time desc
      limit ${V4_TRAIN_CAP}
    ) q
    order by close_ms asc
  `;
  const rows = raw.map(trainingRow).filter((r): r is V3FitRow => Boolean(r));
  return fitV3(rows, takenMs);
}

function validAsk(v: unknown): number | null {
  const n = num(v);
  return n != null && n > 0 && n < 100 ? n : null;
}

async function captureOnce(): Promise<void> {
  const st = observer();
  if (st.inFlight || Date.now() < V4_PROSPECTIVE_SINCE) return;
  st.inFlight = true;
  try {
    // One-way dynamic read. server-engine does not import this module.
    const { getServerFrame } = await import("./server-engine");
    const frame = await getServerFrame();
    const { snap, chair, votes } = structuredClone({
      snap: frame.snap,
      chair: frame.chair,
      votes: frame.votes,
    });

    if (!snap || snap.demo || snap.as_of < V4_PROSPECTIVE_SINCE) return;
    if (!snap.ticker || tickerAgrees(snap.ticker, snap.close_time) !== true) return;
    if (!inV4Lock(Number(snap.secs_left))) return;

    const key = `${snap.ticker}|${snap.close_time}`;
    if (st.sampled.has(key)) return;

    // No data-health gate: missing specialist evidence becomes zero through the
    // same frozen feature extractor. The market prior falls back to fair, then 50%.
    const mid = centsProb(snap.yes_mid);
    const fair = centsProb(snap.fair_yes);
    const marketP = mid ?? fair ?? 0.5;
    const all = extractFeatures(votes, snap) as Record<string, unknown>;
    const features = v3FeaturesFromStored(all, marketP, fair);
    const weights = await weightsBefore(Number(snap.as_of), Number(snap.close_time));
    const pred = predictForcedV4(weights, marketP, features);

    // Ask is observed only AFTER side is frozen. It cannot suppress or change it.
    const yesAsk = validAsk(snap.yes_ask);
    const noAsk = validAsk(snap.no_ask);
    const entry = pred.side === "UP" ? yesAsk : noAsk;
    const chairLean =
      chair?.lean === "UP" || chair?.lean === "DOWN" || chair?.lean === "WAIT"
        ? chair.lean
        : "WAIT";

    const db = await getSql();
    await db`
      insert into desk_v4_forced (
        ticker, close_time, taken_at, secs_left, study, version, measurement_version,
        market_p, fair_p, p_up, side, model_n, model_fitted_at, correction_logit,
        features, chair_lean, yes_ask, no_ask, entry_cents, feed_health, build_sha
      )
      select
        ${snap.ticker},
        ${new Date(snap.close_time).toISOString()}::timestamptz,
        ${new Date(snap.as_of).toISOString()}::timestamptz,
        ${Number(snap.secs_left)},
        ${V4_STUDY},
        ${V4_VERSION},
        ${V4_MEASUREMENT_VERSION},
        ${marketP},
        ${fair},
        ${pred.p_up},
        ${pred.side},
        ${pred.model_n},
        ${weights ? new Date(weights.fitted_at).toISOString() : null}::timestamptz,
        ${pred.correction_logit},
        ${JSON.stringify(features)}::jsonb,
        ${chairLean},
        ${yesAsk},
        ${noAsk},
        ${entry},
        ${JSON.stringify(snap.health ?? {})}::jsonb,
        ${process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? ""}
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

export function ensureForcedV4Observer(): void {
  const st = observer();
  if (st.timer) return;
  st.timer = setInterval(() => void captureOnce(), OBSERVER_MS);
  void captureOnce();
}

export function forcedV4Health() {
  const st = observer();
  return {
    started: Boolean(st.timer),
    last_captured_at: st.lastCapturedAt ? new Date(st.lastCapturedAt).toISOString() : null,
    last_error: st.lastError,
  };
}

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

export type ForcedV4Snapshot = {
  study: typeof V4_STUDY;
  since: string;
  measurement_version: string;
  lock: { seconds_before_close: number; grace_seconds: number };
  authority: { live_chair: false; paper_book: false; learner: false; promotion: false };
  captured: number;
  graded: number;
  hits: number;
  accuracy: number | null;
  market_accuracy: number | null;
  brier: number | null;
  market_brier: number | null;
  quoted_n: number;
  quoted_net_cents: number | null;
  when_chair_wait: { n: number; hits: number; accuracy: number | null };
  coverage: { expected_since_first: number; captured_since_first: number; missing: number };
  first_capture: string | null;
  health: ReturnType<typeof forcedV4Health>;
  recent: Array<{
    ticker: string;
    close_time: string;
    side: V4Side;
    p_up: number;
    entry_cents: number | null;
    winner: string | null;
  }>;
};

export async function forcedV4Snapshot(): Promise<ForcedV4Snapshot> {
  const db = await getSql();
  const rows = await db<V4StoredRow>`
    select
      v.ticker,
      (extract(epoch from v.close_time) * 1000)::bigint as close_ms,
      (extract(epoch from v.taken_at) * 1000)::bigint as taken_ms,
      v.secs_left, v.market_p, v.fair_p, v.p_up, v.side, v.model_n,
      v.correction_logit, v.chair_lean, v.entry_cents,
      l.winner
    from desk_v4_forced v
    left join desk_ledger_research l
      on l.ticker = v.ticker and l.close_time = v.close_time and l.source = 'kalshi-result'
    where v.study = ${V4_STUDY}
      and v.version = ${V4_VERSION}
      and v.measurement_version = ${V4_MEASUREMENT_VERSION}
      and v.taken_at >= ${new Date(V4_PROSPECTIVE_SINCE).toISOString()}
      and v.taken_at < v.close_time
    order by v.close_time asc
  `;

  const graded = rows.filter(
    (r): r is V4StoredRow & { winner: V4Side } => r.winner === "UP" || r.winner === "DOWN",
  );
  const hits = graded.reduce((n, r) => n + v4Hit(r.side, r.winner), 0);
  const marketHits = graded.reduce(
    (n, r) => n + v4Hit(r.market_p >= 0.5 ? "UP" : "DOWN", r.winner),
    0,
  );
  const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const nets = graded
    .map((r) => v4QuotedNet(r.side, r.entry_cents, r.winner))
    .filter((n): n is number => n != null);
  const chairWait = graded.filter((r) => r.chair_lean === "WAIT");
  const chairWaitHits = chairWait.reduce((n, r) => n + v4Hit(r.side, r.winner), 0);

  const first = rows[0] ?? null;
  let expected = 0;
  if (first) {
    const firstClose = Number(first.close_ms);
    const latestDueClose = Math.floor((Date.now() + V4_LOCK_SECS * 1000) / 900_000) * 900_000;
    expected = latestDueClose >= firstClose
      ? Math.floor((latestDueClose - firstClose) / 900_000) + 1
      : 0;
  }

  return {
    study: V4_STUDY,
    since: new Date(V4_PROSPECTIVE_SINCE).toISOString(),
    measurement_version: V4_MEASUREMENT_VERSION,
    lock: { seconds_before_close: V4_LOCK_SECS, grace_seconds: V4_LOCK_GRACE_SECS },
    authority: { live_chair: false, paper_book: false, learner: false, promotion: false },
    captured: rows.length,
    graded: graded.length,
    hits,
    accuracy: graded.length ? round(hits / graded.length) : null,
    market_accuracy: graded.length ? round(marketHits / graded.length) : null,
    brier: graded.length ? round(avg(graded.map((r) => brier(r.p_up, r.winner))) ?? 0, 6) : null,
    market_brier: graded.length ? round(avg(graded.map((r) => brier(r.market_p, r.winner))) ?? 0, 6) : null,
    quoted_n: nets.length,
    quoted_net_cents: nets.length ? round(nets.reduce((a, b) => a + b, 0), 2) : null,
    when_chair_wait: {
      n: chairWait.length,
      hits: chairWaitHits,
      accuracy: chairWait.length ? round(chairWaitHits / chairWait.length) : null,
    },
    coverage: {
      expected_since_first: expected,
      captured_since_first: rows.length,
      missing: Math.max(0, expected - rows.length),
    },
    first_capture: first ? new Date(Number(first.taken_ms)).toISOString() : null,
    health: forcedV4Health(),
    recent: rows.slice(-16).reverse().map((r) => ({
      ticker: r.ticker,
      close_time: new Date(Number(r.close_ms)).toISOString(),
      side: r.side,
      p_up: r.p_up,
      entry_cents: r.entry_cents,
      winner: r.winner,
    })),
  };
}
