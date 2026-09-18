/**
 * Prospective V4/V5 Lab observer.
 *
 * One-way architecture: this module reads the finalized server frame and writes
 * only its own research tables. It is booted beside the brain from /healthz and
 * is never imported by the Chair, learner, entry policy or paper book.
 *
 * V4 = exactly one UP/DOWN shadow call per observed window, no WAIT.
 * V5 = zero-to-many one-contract paper actions inside a window, priced only at
 * executable bid/ask with fees. Neither has authority over the live desk.
 */
import { getSql } from "@/lib/db";
import { extractFeatures } from "./chair-v2";
import {
  fitV3,
  predictV3,
  v3FeaturesFromStored,
  type V3FitRow,
  type V3Weights,
} from "./chair-v3";
import {
  V4_FRAME_SECONDS,
  V4_TIMING_VERSION,
  V5_POLICY_VERSION,
  emptyForcedTiming,
  forcedSide,
  profitDecision,
  stepForcedTiming,
  type Direction,
  type ForcedTimingState,
  type ProfitPosition,
} from "./lab-v4-v5";
import { tickerAgrees } from "./window-identity";

export const V4V5_PROSPECTIVE_SINCE = Date.parse("2026-09-18T12:00:00.000Z");
export const V4_MEASUREMENT_VERSION = "forced-direction-v1-v3core";
export const V5_MEASUREMENT_VERSION = "profit-hunter-v1-v3core";
const OBSERVER_MS = 2_000;
const TRAIN_CAP = 1_800;

type StoredTraining = {
  ticker: string;
  close_ms: number | string;
  winner: string;
  features: Record<string, unknown> | null;
  market: Record<string, unknown> | null;
};

type Observer = {
  timer: ReturnType<typeof setInterval> | null;
  busy: boolean;
  key: string;
  timing: ForcedTimingState;
  weights: V3Weights | null;
  locked: boolean;
  position: ProfitPosition;
  seq: number;
  lastFrameBucket: number | null;
  lastCapturedAt: number;
  lastError: string | null;
};

const g = globalThis as typeof globalThis & { __labV4V5Observer__?: Observer };
function observer(): Observer {
  return (g.__labV4V5Observer__ ??= {
    timer: null,
    busy: false,
    key: "",
    timing: emptyForcedTiming(),
    weights: null,
    locked: false,
    position: null,
    seq: 0,
    lastFrameBucket: null,
    lastCapturedAt: 0,
    lastError: null,
  });
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
  if (
    close == null ||
    tickerAgrees(r.ticker, close) !== true ||
    mid == null ||
    !(mid > 0 && mid < 100)
  ) return null;
  const marketP = mid / 100;
  return {
    close_time: close,
    winner: r.winner,
    market_p: marketP,
    features: v3FeaturesFromStored(r.features, marketP, fair == null ? null : fair / 100),
  };
}

/** Strictly prior graded windows only; one fit is held for the current window. */
async function weightsBefore(cutoffMs: number): Promise<V3Weights | null> {
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
      where l.winner in ('UP','DOWN')
        and l.source = 'kalshi-result'
        and s.taken_at < s.close_time
        and l.graded_at < ${new Date(cutoffMs).toISOString()}
        and s.close_time < ${new Date(cutoffMs).toISOString()}
      order by s.close_time desc
      limit ${TRAIN_CAP}
    ) q
    order by close_ms asc
  `;
  const rows = raw.map(trainingRow).filter((r): r is V3FitRow => Boolean(r));
  return fitV3(rows, cutoffMs);
}

function frameProbability(snap: {
  yes_mid: number;
  fair_yes: number;
}): { p: number; source: "market" | "fair" | "neutral" } {
  if (Number.isFinite(snap.yes_mid) && snap.yes_mid > 0 && snap.yes_mid < 100)
    return { p: snap.yes_mid / 100, source: "market" };
  if (Number.isFinite(snap.fair_yes) && snap.fair_yes > 0 && snap.fair_yes < 100)
    return { p: snap.fair_yes / 100, source: "fair" };
  return { p: 0.5, source: "neutral" };
}

async function restoreWindow(
  ticker: string,
  closeMs: number,
): Promise<{ locked: boolean; position: ProfitPosition; seq: number }> {
  const db = await getSql();
  const [calls, trades] = await Promise.all([
    db<{ side: string }>`
      select side from desk_v4_calls
      where ticker = ${ticker} and close_time = ${new Date(closeMs).toISOString()}
      limit 1
    `,
    db<{ seq: number; to_side: string | null }>`
      select seq, to_side from desk_v5_trades
      where ticker = ${ticker} and close_time = ${new Date(closeMs).toISOString()}
      order by seq asc
    `,
  ]);
  const last = trades[trades.length - 1];
  return {
    locked: calls.length > 0,
    position: last?.to_side === "UP" || last?.to_side === "DOWN" ? last.to_side : null,
    seq: last ? Number(last.seq) || 0 : 0,
  };
}

async function writeFrame(args: {
  ticker: string;
  closeMs: number;
  takenAt: number;
  secsLeft: number;
  side: Direction;
  pUp: number;
  marketP: number;
  modelN: number;
  features: Record<string, unknown>;
  bucket: number;
}): Promise<void> {
  const db = await getSql();
  await db`
    insert into desk_v4_frames
      (ticker, close_time, frame_bucket, taken_at, secs_left, side, p_up, market_p,
       model_n, features, measurement_version, build_sha)
    select
      ${args.ticker}, ${new Date(args.closeMs).toISOString()}::timestamptz, ${args.bucket},
      ${new Date(args.takenAt).toISOString()}::timestamptz, ${args.secsLeft}, ${args.side},
      ${args.pUp}, ${args.marketP}, ${args.modelN}, ${JSON.stringify(args.features)}::jsonb,
      ${V4_MEASUREMENT_VERSION}, ${process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? ""}
    where clock_timestamp() < ${new Date(args.closeMs).toISOString()}::timestamptz
    on conflict (ticker, close_time, frame_bucket) do nothing
  `;
}

async function lockV4(args: {
  ticker: string;
  closeMs: number;
  takenAt: number;
  secsLeft: number;
  side: Direction;
  pUp: number;
  marketP: number;
  modelN: number;
  reason: "STABLE_PEAK" | "DEADLINE";
  features: Record<string, unknown>;
}): Promise<boolean> {
  const db = await getSql();
  const rows = await db<{ ticker: string }>`
    insert into desk_v4_calls
      (ticker, close_time, locked_at, secs_left, side, p_up, market_p, model_n,
       lock_reason, features, measurement_version, build_sha)
    select
      ${args.ticker}, ${new Date(args.closeMs).toISOString()}::timestamptz,
      ${new Date(args.takenAt).toISOString()}::timestamptz, ${args.secsLeft}, ${args.side},
      ${args.pUp}, ${args.marketP}, ${args.modelN}, ${args.reason},
      ${JSON.stringify(args.features)}::jsonb, ${V4_MEASUREMENT_VERSION},
      ${process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? ""}
    where clock_timestamp() < ${new Date(args.closeMs).toISOString()}::timestamptz
    on conflict (ticker, close_time) do nothing
    returning ticker
  `;
  return rows.length > 0;
}

async function ensureV5Window(ticker: string, closeMs: number, firstSeenAt: number): Promise<void> {
  const db = await getSql();
  await db`
    insert into desk_v5_windows
      (ticker, close_time, first_seen_at, measurement_version, build_sha)
    select
      ${ticker}, ${new Date(closeMs).toISOString()}::timestamptz,
      ${new Date(firstSeenAt).toISOString()}::timestamptz, ${V5_MEASUREMENT_VERSION},
      ${process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? ""}
    where clock_timestamp() < ${new Date(closeMs).toISOString()}::timestamptz
    on conflict (ticker, close_time) do nothing
  `;
}

async function writeV5Trade(args: {
  ticker: string;
  closeMs: number;
  at: number;
  seq: number;
  action: "ENTER" | "EXIT" | "FLIP";
  fromSide: Direction | null;
  toSide: Direction | null;
  sell: number | null;
  buy: number | null;
  fees: number;
  cashflow: number;
  pUp: number;
  marketP: number;
  gain: number;
  reason: string;
}): Promise<boolean> {
  const db = await getSql();
  const rows = await db<{ seq: number }>`
    insert into desk_v5_trades
      (ticker, close_time, seq, traded_at, action, from_side, to_side, sell_cents,
       buy_cents, fees_cents, cashflow_cents, p_up, market_p, expected_gain_cents,
       reason, measurement_version, build_sha)
    select
      ${args.ticker}, ${new Date(args.closeMs).toISOString()}::timestamptz, ${args.seq},
      ${new Date(args.at).toISOString()}::timestamptz, ${args.action}, ${args.fromSide},
      ${args.toSide}, ${args.sell}, ${args.buy}, ${args.fees}, ${args.cashflow},
      ${args.pUp}, ${args.marketP}, ${args.gain}, ${args.reason},
      ${V5_MEASUREMENT_VERSION}, ${process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? ""}
    where clock_timestamp() < ${new Date(args.closeMs).toISOString()}::timestamptz
    on conflict (ticker, close_time, seq) do nothing
    returning seq
  `;
  return rows.length > 0;
}

async function captureOnce(): Promise<void> {
  const st = observer();
  if (st.busy || Date.now() < V4V5_PROSPECTIVE_SINCE) return;
  st.busy = true;
  try {
    const { getServerFrame } = await import("./server-engine");
    const frame = await getServerFrame();
    const { snap, votes } = structuredClone({ snap: frame.snap, votes: frame.votes });
    if (!snap || snap.demo || !snap.ticker) return;
    if (!Number.isFinite(snap.close_time) || !Number.isFinite(snap.as_of)) return;
    if (snap.as_of >= snap.close_time || tickerAgrees(snap.ticker, snap.close_time) === false) return;

    const key = `${snap.ticker}|${snap.close_time}`;
    if (key !== st.key) {
      const restored = await restoreWindow(snap.ticker, snap.close_time);
      st.key = key;
      st.timing = emptyForcedTiming();
      st.weights = await weightsBefore(snap.as_of);
      st.locked = restored.locked;
      st.position = restored.position;
      st.seq = restored.seq;
      st.lastFrameBucket = null;
    }

    await ensureV5Window(snap.ticker, snap.close_time, snap.as_of);

    const prior = frameProbability(snap);
    const raw = extractFeatures(votes, snap) as Record<string, unknown>;
    const features = v3FeaturesFromStored(raw, prior.p, snap.fair_yes / 100);
    const pred = predictV3(st.weights, prior.p, features);
    const pUp = pred.p_up;
    const side = forcedSide(pUp, st.timing.side);
    const storedFeatures: Record<string, unknown> = {
      ...features,
      _market_source: prior.source,
      _timing_policy: V4_TIMING_VERSION,
      _profit_policy: V5_POLICY_VERSION,
    };

    const bucket = Math.floor(snap.as_of / (V4_FRAME_SECONDS * 1000));
    if (st.lastFrameBucket !== bucket) {
      st.lastFrameBucket = bucket;
      await writeFrame({
        ticker: snap.ticker,
        closeMs: snap.close_time,
        takenAt: snap.as_of,
        secsLeft: snap.secs_left,
        side,
        pUp,
        marketP: prior.p,
        modelN: pred.model_n,
        features: storedFeatures,
        bucket,
      });
    }

    const timing = stepForcedTiming(st.timing, pUp, snap.as_of, snap.secs_left);
    st.timing = timing.state;
    if (!st.locked && timing.lock && timing.reason) {
      const inserted = await lockV4({
        ticker: snap.ticker,
        closeMs: snap.close_time,
        takenAt: snap.as_of,
        secsLeft: snap.secs_left,
        side: timing.side,
        pUp,
        marketP: prior.p,
        modelN: pred.model_n,
        reason: timing.reason,
        features: storedFeatures,
      });
      // A false return is normally ON CONFLICT after a restart; either way the
      // immutable first call is the only one this process should try to replace.
      st.locked = inserted || st.locked;
      if (!inserted) {
        const restored = await restoreWindow(snap.ticker, snap.close_time);
        st.locked = restored.locked;
      }
    }

    // V5 needs an executable current book. This is data validity, not an alpha
    // threshold: no paper strategy gets credit for selling into a stale/nonexistent bid.
    const bookUsable =
      snap.health.kalshi !== "DOWN" &&
      Number.isFinite(snap.quote_age_s) &&
      snap.quote_age_s <= 10 &&
      snap.yes_bid > 0 && snap.yes_bid < 100 &&
      snap.yes_ask > 0 && snap.yes_ask < 100 &&
      snap.no_bid > 0 && snap.no_bid < 100 &&
      snap.no_ask > 0 && snap.no_ask < 100;

    if (bookUsable) {
      const action = profitDecision(st.position, pUp, {
        yes_bid: snap.yes_bid,
        yes_ask: snap.yes_ask,
        no_bid: snap.no_bid,
        no_ask: snap.no_ask,
      });
      if (action.action === "ENTER" || action.action === "EXIT" || action.action === "FLIP") {
        const nextSeq = st.seq + 1;
        const inserted = await writeV5Trade({
          ticker: snap.ticker,
          closeMs: snap.close_time,
          at: snap.as_of,
          seq: nextSeq,
          action: action.action,
          fromSide: action.from_side,
          toSide: action.to_side,
          sell: action.sell_cents,
          buy: action.buy_cents,
          fees: action.fees_cents,
          cashflow: action.cashflow_cents,
          pUp,
          marketP: prior.p,
          gain: action.expected_gain_cents,
          reason: action.reason,
        });
        if (inserted) {
          st.seq = nextSeq;
          st.position = action.to_side;
        }
      }
    }

    st.lastCapturedAt = Date.now();
    st.lastError = null;
  } catch (err) {
    st.lastError = err instanceof Error ? err.message : String(err);
  } finally {
    st.busy = false;
  }
}

export function ensureLabV4V5Observer(): void {
  const st = observer();
  if (st.timer) return;
  st.timer = setInterval(() => void captureOnce(), OBSERVER_MS);
  void captureOnce();
}

export function labV4V5Health() {
  const st = observer();
  return {
    started: Boolean(st.timer),
    window_key: st.key || null,
    v4_locked: st.locked,
    v5_position: st.position,
    v5_sequence: st.seq,
    last_captured_at: st.lastCapturedAt ? new Date(st.lastCapturedAt).toISOString() : null,
    last_error: st.lastError,
  };
}

const round = (n: number, d = 6) => Math.round(n * 10 ** d) / 10 ** d;

type V4Row = {
  ticker: string;
  close_ms: number | string;
  locked_ms: number | string;
  secs_left: number;
  side: string;
  p_up: number;
  market_p: number;
  model_n: number;
  lock_reason: string;
  winner: string | null;
};

type V5WindowRow = {
  ticker: string;
  close_ms: number | string;
  winner: string | null;
  trade_n: number;
  cashflow_cents: number;
  position: string | null;
};

export async function labV4V5Snapshot() {
  const db = await getSql();
  const since = new Date(V4V5_PROSPECTIVE_SINCE).toISOString();
  const [v4Rows, frameStats, denominator, v5Rows, recentTrades] = await Promise.all([
    db<V4Row>`
      select
        c.ticker,
        (extract(epoch from c.close_time) * 1000)::bigint as close_ms,
        (extract(epoch from c.locked_at) * 1000)::bigint as locked_ms,
        c.secs_left, c.side, c.p_up, c.market_p, c.model_n, c.lock_reason,
        l.winner
      from desk_v4_calls c
      left join desk_ledger_research l
        on l.ticker = c.ticker and l.close_time = c.close_time and l.source = 'kalshi-result'
      where c.locked_at >= ${since}::timestamptz
        and c.measurement_version = ${V4_MEASUREMENT_VERSION}
      order by c.close_time asc
    `,
    db<{ n: number; latest: string | null }>`
      select count(*)::int as n, max(taken_at)::text as latest
      from desk_v4_frames
      where taken_at >= ${since}::timestamptz
        and measurement_version = ${V4_MEASUREMENT_VERSION}
    `,
    db<{ n: number }>`
      select count(*)::int as n
      from desk_ledger_research
      where close_time >= ${since}::timestamptz
        and winner in ('UP','DOWN') and source = 'kalshi-result'
    `,
    db<V5WindowRow>`
      select
        w.ticker,
        (extract(epoch from w.close_time) * 1000)::bigint as close_ms,
        l.winner,
        coalesce(t.trade_n, 0)::int as trade_n,
        coalesce(t.cashflow_cents, 0)::double precision as cashflow_cents,
        t.position
      from desk_v5_windows w
      left join desk_ledger_research l
        on l.ticker = w.ticker and l.close_time = w.close_time and l.source = 'kalshi-result'
      left join lateral (
        select
          count(*)::int as trade_n,
          coalesce(sum(x.cashflow_cents), 0)::double precision as cashflow_cents,
          (array_agg(x.to_side order by x.seq desc))[1] as position
        from desk_v5_trades x
        where x.ticker = w.ticker and x.close_time = w.close_time
          and x.measurement_version = ${V5_MEASUREMENT_VERSION}
      ) t on true
      where w.first_seen_at >= ${since}::timestamptz
        and w.measurement_version = ${V5_MEASUREMENT_VERSION}
      order by w.close_time asc
    `,
    db<{
      ticker: string; close_time: string; seq: number; traded_at: string; action: string;
      from_side: string | null; to_side: string | null; sell_cents: number | null;
      buy_cents: number | null; fees_cents: number; cashflow_cents: number;
      p_up: number; expected_gain_cents: number; reason: string;
    }>`
      select ticker, close_time, seq, traded_at, action, from_side, to_side,
             sell_cents, buy_cents, fees_cents, cashflow_cents, p_up,
             expected_gain_cents, reason
      from desk_v5_trades
      where traded_at >= ${since}::timestamptz
        and measurement_version = ${V5_MEASUREMENT_VERSION}
      order by traded_at desc, seq desc
      limit 24
    `,
  ]);

  const gradedV4 = v4Rows.filter((r): r is V4Row & { winner: "UP" | "DOWN" } =>
    r.winner === "UP" || r.winner === "DOWN");
  const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const v4Acc = gradedV4.length
    ? gradedV4.filter((r) => r.side === r.winner).length / gradedV4.length
    : null;
  const v4Brier = avg(gradedV4.map((r) => (r.p_up - (r.winner === "UP" ? 1 : 0)) ** 2));
  const marketBrier = avg(gradedV4.map((r) => (r.market_p - (r.winner === "UP" ? 1 : 0)) ** 2));

  const gradedV5 = v5Rows.filter((r): r is V5WindowRow & { winner: "UP" | "DOWN" } =>
    r.winner === "UP" || r.winner === "DOWN");
  const v5Scored = gradedV5.map((r) => {
    const position = r.position === "UP" || r.position === "DOWN" ? r.position : null;
    const payout = position && position === r.winner ? 100 : 0;
    return { ...r, position, net_cents: round(Number(r.cashflow_cents) + payout, 3) };
  });
  const v5Net = v5Scored.reduce((s, r) => s + r.net_cents, 0);
  const traded = v5Scored.filter((r) => r.trade_n > 0);
  const profitable = traded.filter((r) => r.net_cents > 0).length;

  return {
    at: new Date().toISOString(),
    since,
    authority: { live_chair: false, paper_book: false, learner: false, orders: false },
    v4: {
      id: V4_TIMING_VERSION,
      measurement_version: V4_MEASUREMENT_VERSION,
      rule: "UP/DOWN every observed window; no WAIT, confidence bar, price floor, quorum or edge gate",
      timing: "lock after a stable local certainty peak stops improving; otherwise force at 20s",
      calls: v4Rows.length,
      graded: gradedV4.length,
      official_windows_since_start: Number(denominator[0]?.n ?? 0),
      participation_of_graded_windows: Number(denominator[0]?.n ?? 0)
        ? round(gradedV4.length / Number(denominator[0]!.n), 4) : null,
      accuracy: v4Acc == null ? null : round(v4Acc, 4),
      brier: v4Brier == null ? null : round(v4Brier),
      market_brier_same_windows: marketBrier == null ? null : round(marketBrier),
      brier_delta_vs_market: v4Brier == null || marketBrier == null ? null : round(marketBrier - v4Brier),
      frames: Number(frameStats[0]?.n ?? 0),
      latest_frame: frameStats[0]?.latest ?? null,
      average_lock_secs_left: (() => {
        const v = avg(v4Rows.map((r) => Number(r.secs_left)).filter(Number.isFinite));
        return v == null ? null : round(v, 1);
      })(),
      lock_reasons: Object.fromEntries(["STABLE_PEAK", "DEADLINE"].map((x) => [x, v4Rows.filter((r) => r.lock_reason === x).length])),
      recent: v4Rows.slice(-16).reverse().map((r) => ({
        ticker: r.ticker,
        close_time: new Date(Number(r.close_ms)).toISOString(),
        locked_at: new Date(Number(r.locked_ms)).toISOString(),
        secs_left: r.secs_left,
        side: r.side,
        p_up: r.p_up,
        market_p: r.market_p,
        model_n: r.model_n,
        lock_reason: r.lock_reason,
        winner: r.winner,
      })),
    },
    v5: {
      id: V5_POLICY_VERSION,
      measurement_version: V5_MEASUREMENT_VERSION,
      rule: "one-contract paper position; ENTER/EXIT/FLIP only when expected terminal value improves after executable spread + fees",
      observed_windows: v5Rows.length,
      graded_windows: gradedV5.length,
      traded_windows: traded.length,
      zero_trade_windows: v5Scored.filter((r) => r.trade_n === 0).length,
      trades: v5Scored.reduce((s, r) => s + Number(r.trade_n), 0),
      net_cents: round(v5Net, 2),
      net_per_traded_window: traded.length ? round(v5Net / traded.length, 3) : null,
      profitable_traded_windows: profitable,
      losing_traded_windows: traded.filter((r) => r.net_cents < 0).length,
      flat_traded_windows: traded.filter((r) => r.net_cents === 0).length,
      recent_windows: v5Scored.slice(-16).reverse().map((r) => ({
        ticker: r.ticker,
        close_time: new Date(Number(r.close_ms)).toISOString(),
        winner: r.winner,
        trade_n: r.trade_n,
        final_position: r.position,
        net_cents: r.net_cents,
      })),
      recent_trades: recentTrades,
    },
    health: labV4V5Health(),
  };
}
