/**
 * Hour Research v1 — the shadow observer (server only). Authority: NONE.
 *
 * At each deterministic checkpoint inside a KXBTCD hour (45/30/20/15/10/5
 * minutes remaining) this reads the hour's WHOLE strike ladder, freezes a
 * decision-time feature snapshot, asks the pure model for a read, and records
 * it. It books nothing, changes nothing, and cannot promote itself.
 *
 * Isolation, enforced by scripts/hour-research-rails.test.mjs:
 *  - It never imports the 15-minute Chair, seats, learner, bots, paper book,
 *    floor policy, promotion gates or the seat-telemetry experiment.
 *  - It reads the shared frame for RAW MARKET DATA ONLY (spot, index, basis,
 *    candles, returns, range) through a dynamic import — the same narrow path
 *    the hourly page already uses. It never reads `frame.chair` or
 *    `frame.votes`: a 15-minute VERDICT is never an hourly feature.
 *  - It writes only desk_hour_predictions and desk_hour_shadow. It never
 *    writes desk_ledger, desk_hour_ledger, or any telemetry table.
 *  - Fail-open and fire-and-forget: it has its own timer, swallows its own
 *    errors, and the 15-minute floor never awaits it.
 */
import {
  HOUR_RESEARCH_AUTHORITY,
  HOUR_RESEARCH_VERSION,
  checkpointFor,
  distanceBaselineP,
  hourRead,
  ladderRungs,
  brier,
  type HourCheckpoint,
  type HourFeatures,
  type HourRead,
  type HourRung,
} from "./hour-research.ts";
import { parseHourTicker, quoteCents, type HourMarketRow } from "./hour.ts";
import { eventLadder } from "./hour-closer.server";
import { hourEventTicker, isSettled, officialValue } from "./hour-closer";

const HOUR_MS = 60 * 60 * 1000;
/** The observer wakes often enough that no 75s checkpoint band is missed. */
const TICK_MS = 20_000;
const FIRST_DELAY_MS = 25_000;
/** How far back the grader looks for hours that have settled. */
const GRADE_LOOKBACK_MS = 6 * HOUR_MS;
const GRADE_EVERY_MS = 10 * 60_000;
/** Rungs stored per checkpoint, centred on expected settlement: the usable band. */
const STORE_RUNGS = 41;

type Observer = {
  timer: ReturnType<typeof setInterval> | null;
  first: ReturnType<typeof setTimeout> | null;
  busy: boolean;
  grading: boolean;
  lastGrade: number;
  /** close_ms|checkpoint already recorded this process, to avoid refetching. */
  seen: Set<string>;
  checkpoints: number;
  shadowRows: number;
  graded: number;
  lastRun: number | null;
  error: string | null;
};

const g = globalThis as typeof globalThis & { __hourResearch__?: Observer };
const state = (): Observer =>
  (g.__hourResearch__ ??= {
    timer: null,
    first: null,
    busy: false,
    grading: false,
    lastGrade: 0,
    seen: new Set(),
    checkpoints: 0,
    shadowRows: 0,
    graded: 0,
    lastRun: null,
    error: null,
  });

function buildSha(): string {
  const sha = String(process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? "").trim().toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(sha) ? sha : "";
}

async function sql() {
  const { getSql } = await import("@/lib/db");
  return getSql();
}

// ---------------------------------------------------------------------------
// RAW market snapshot → frozen hourly features
// ---------------------------------------------------------------------------

type RawCandle = { close: number; closed: boolean };
type RawSnap = {
  spot?: number;
  spot_age_s?: number;
  index_px?: number;
  basis_bps?: number;
  candles_1m?: RawCandle[];
  candles_1h?: RawCandle[];
  ret5?: number;
  ret15?: number;
  ret30?: number;
  ret1h?: number;
  range_pos?: number;
};

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const numOrNull = (v: unknown): number | null => (finite(v) ? v : null);

/** Realized volatility of log returns over closed 1m candles, expressed per hour. */
export function sigmaHourFromCandles(candles: readonly RawCandle[] | undefined, want = 60): number | null {
  const closes = (candles ?? []).filter((c) => c.closed && finite(c.close) && c.close > 0).map((c) => c.close);
  const tail = closes.slice(-(want + 1));
  if (tail.length < 12) return null;
  const rets: number[] = [];
  for (let i = 1; i < tail.length; i++) rets.push(Math.log(tail[i]! / tail[i - 1]!));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varr = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1);
  const perMinute = Math.sqrt(varr);
  if (!(perMinute > 0)) return null;
  return perMinute * Math.sqrt(60);
}

/** Log return over the last `bars` closed candles. */
function retOverBars(candles: readonly RawCandle[] | undefined, bars: number): number | null {
  const closes = (candles ?? []).filter((c) => c.closed && finite(c.close) && c.close > 0).map((c) => c.close);
  if (closes.length < bars + 1) return null;
  const a = closes[closes.length - 1 - bars]!;
  const b = closes[closes.length - 1]!;
  return a > 0 ? Math.log(b / a) : null;
}

/**
 * Freeze the hourly feature snapshot from RAW market data only. Nothing here
 * reads a Chair lean, a seat vote, a learner weight or a 15-minute grade.
 */
export function featuresFromRaw(snap: RawSnap | null): HourFeatures {
  const spot = numOrNull(snap?.spot);
  const index = numOrNull(snap?.index_px);
  const basisBps = numOrNull(snap?.basis_bps);
  // basis_bps is the index-vs-spot difference in basis points of spot.
  const basis = basisBps != null && spot != null ? (basisBps / 10_000) * spot : index != null && spot != null ? index - spot : null;
  return {
    index: index != null && index > 0 ? index : null,
    // The shared frame carries no separate index clock; spot's age is the
    // freshest honest bound on it, and null when even that is unknown.
    index_age_s: index != null && index > 0 ? numOrNull(snap?.spot_age_s) : null,
    spot,
    spot_age_s: numOrNull(snap?.spot_age_s),
    basis,
    basis_spread: null,
    sigma_hour: sigmaHourFromCandles(snap?.candles_1m),
    vol_source: "realized-1m-log",
    ret5: numOrNull(snap?.ret5),
    ret15: numOrNull(snap?.ret15),
    ret30: numOrNull(snap?.ret30),
    ret60: numOrNull(snap?.ret1h),
    ret4h: retOverBars(snap?.candles_1h, 4),
    ret24h: retOverBars(snap?.candles_1h, 24),
    range_pos: numOrNull(snap?.range_pos),
  };
}

/**
 * RAW market fields from the shared frame. Deliberately narrow: this picks
 * named market fields off `snap` and never touches `frame.chair`/`frame.votes`.
 */
async function rawSnapshot(): Promise<RawSnap | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { getServerFrame } = await import("./server-engine");
    const frame = await Promise.race([
      getServerFrame(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 2_500);
      }),
    ]);
    const s = frame?.snap as RawSnap | undefined;
    if (!s) return null;
    return {
      spot: s.spot,
      spot_age_s: s.spot_age_s,
      index_px: s.index_px,
      basis_bps: s.basis_bps,
      candles_1m: s.candles_1m,
      candles_1h: s.candles_1h,
      ret5: s.ret5,
      ret15: s.ret15,
      ret30: s.ret30,
      ret1h: s.ret1h,
      range_pos: s.range_pos,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Recording one checkpoint
// ---------------------------------------------------------------------------

/** The band of rungs stored for calibration: those nearest expected settlement. */
export function storedBand(rungs: readonly HourRung[], expected: number | null, limit = STORE_RUNGS): HourRung[] {
  if (expected == null || rungs.length <= limit) return [...rungs];
  const sorted = [...rungs].sort((a, b) => Math.abs(a.strike - expected) - Math.abs(b.strike - expected));
  return sorted.slice(0, limit).sort((a, b) => a.strike - b.strike);
}

async function recordCheckpoint(
  eventTicker: string,
  closeMs: number,
  checkpoint: HourCheckpoint,
  read: HourRead,
  rungs: readonly HourRung[],
  features: HourFeatures,
  secsLeft: number,
  asOfMs: number,
): Promise<void> {
  const db = await sql();
  const sha = buildSha();
  const closeIso = new Date(closeMs).toISOString();
  const asOfIso = new Date(asOfMs).toISOString();
  const byTicker = new Map(rungs.map((r) => [r.ticker, r]));
  const band = new Set(storedBand(rungs, read.expected_settlement).map((r) => r.ticker));
  const selected = read.candidate?.ticker ?? null;

  for (const r of read.rungs) {
    if (!band.has(r.ticker) && r.ticker !== selected) continue;
    const rung = byTicker.get(r.ticker);
    await db`
      insert into desk_hour_predictions (
        event_ticker, close_time, checkpoint, ticker, strike, as_of, secs_left,
        p_model, uncertainty, z, dollars_to_strike, p_market, p_baseline_dist,
        yes_ask, no_ask, spread_yes, spread_no, edge_yes, edge_no, best_side, best_edge,
        is_selected, model_version, build_sha
      ) values (
        ${eventTicker}, ${closeIso}::timestamptz, ${checkpoint}, ${r.ticker}, ${r.strike}, ${asOfIso}::timestamptz, ${secsLeft},
        ${r.p_yes}, ${r.uncertainty}, ${r.z}, ${r.dollars_to_strike}, ${r.market_p_yes},
        ${rung ? distanceBaselineP(features.spot, r.strike, secsLeft) : null},
        ${r.yes_ask}, ${r.no_ask}, ${r.spread_yes}, ${r.spread_no}, ${r.edge_yes}, ${r.edge_no},
        ${r.best_side}, ${r.best_edge}, ${r.ticker === selected}, ${HOUR_RESEARCH_VERSION}, ${sha}
      )
      on conflict (close_time, checkpoint, ticker) do nothing
    `;
  }

  // The shadow book: one row per hour. The FIRST checkpoint that yields a
  // candidate locks the hour; a WAIT row is kept until (and only until) one
  // does. A row that already carries a call is never rewritten.
  const c = read.candidate;
  const featureJson = JSON.stringify({ ...features, quality: read.quality, expected_source: read.expected_source });
  if (c) {
    await db`
      insert into desk_hour_shadow (
        close_time, event_ticker, checkpoint, decision, wait_reason,
        ticker, strike, side, ask, fee, p_model, p_market, edge_cents, uncertainty,
        as_of, secs_left, expected_settlement, expected_source, sigma_horizon,
        index_value, spot, basis, sigma_hour, ladder_rungs, ladder_complete, ladder_inversions,
        features, explanation, model_version, authority, build_sha
      ) values (
        ${closeIso}::timestamptz, ${eventTicker}, ${checkpoint}, ${c.side}, null,
        ${c.ticker}, ${c.strike}, ${c.side}, ${c.ask}, ${c.fee}, ${c.p_model}, ${c.market_p_yes}, ${c.edge_cents}, ${c.uncertainty},
        ${asOfIso}::timestamptz, ${secsLeft}, ${read.expected_settlement}, ${read.expected_source}, ${read.sigma_horizon},
        ${features.index}, ${features.spot}, ${features.basis}, ${features.sigma_hour},
        ${read.quality.rungs}, ${read.quality.ladder_complete}, ${read.quality.inversions},
        ${featureJson}::jsonb, ${read.explanation}, ${HOUR_RESEARCH_VERSION}, ${HOUR_RESEARCH_AUTHORITY}, ${sha}
      )
      on conflict (close_time) do update set
        checkpoint = excluded.checkpoint, decision = excluded.decision, wait_reason = null,
        ticker = excluded.ticker, strike = excluded.strike, side = excluded.side, ask = excluded.ask,
        fee = excluded.fee, p_model = excluded.p_model, p_market = excluded.p_market,
        edge_cents = excluded.edge_cents, uncertainty = excluded.uncertainty,
        as_of = excluded.as_of, secs_left = excluded.secs_left,
        expected_settlement = excluded.expected_settlement, expected_source = excluded.expected_source,
        sigma_horizon = excluded.sigma_horizon, index_value = excluded.index_value, spot = excluded.spot,
        basis = excluded.basis, sigma_hour = excluded.sigma_hour, ladder_rungs = excluded.ladder_rungs,
        ladder_complete = excluded.ladder_complete, ladder_inversions = excluded.ladder_inversions,
        features = excluded.features, explanation = excluded.explanation, build_sha = excluded.build_sha
      where desk_hour_shadow.decision = 'WAIT' and desk_hour_shadow.graded_at is null
    `;
    state().shadowRows += 1;
  } else {
    await db`
      insert into desk_hour_shadow (
        close_time, event_ticker, checkpoint, decision, wait_reason,
        as_of, secs_left, expected_settlement, expected_source, sigma_horizon,
        index_value, spot, basis, sigma_hour, ladder_rungs, ladder_complete, ladder_inversions,
        features, explanation, model_version, authority, build_sha
      ) values (
        ${closeIso}::timestamptz, ${eventTicker}, ${checkpoint}, 'WAIT', ${read.wait_reason},
        ${asOfIso}::timestamptz, ${secsLeft}, ${read.expected_settlement}, ${read.expected_source}, ${read.sigma_horizon},
        ${features.index}, ${features.spot}, ${features.basis}, ${features.sigma_hour},
        ${read.quality.rungs}, ${read.quality.ladder_complete}, ${read.quality.inversions},
        ${featureJson}::jsonb, ${read.explanation}, ${HOUR_RESEARCH_VERSION}, ${HOUR_RESEARCH_AUTHORITY}, ${sha}
      )
      on conflict (close_time) do update set
        checkpoint = excluded.checkpoint, wait_reason = excluded.wait_reason,
        as_of = excluded.as_of, secs_left = excluded.secs_left, explanation = excluded.explanation
      where desk_hour_shadow.decision = 'WAIT' and desk_hour_shadow.graded_at is null
    `;
  }
}

/** One observer pass: record a checkpoint for the hour now in progress, if due. */
export async function hourResearchOnce(now = Date.now()): Promise<HourRead | null> {
  const st = state();
  if (st.busy) return null;
  st.busy = true;
  try {
    st.lastRun = now;
    const closeMs = Math.ceil(now / HOUR_MS) * HOUR_MS;
    const secsLeft = (closeMs - now) / 1000;
    const checkpoint = checkpointFor(secsLeft);
    if (checkpoint == null) return null;
    const key = `${closeMs}|${checkpoint}`;
    if (st.seen.has(key)) return null;

    const eventTicker = hourEventTicker(closeMs);
    const [ladder, snap] = await Promise.all([eventLadder(eventTicker), rawSnapshot()]);
    const rungs = ladderRungs(ladder.markets as readonly HourMarketRow[], closeMs, parseHourTicker, quoteCents);
    const features = featuresFromRaw(snap);
    const read = hourRead({
      clock: { event_ticker: eventTicker, close_ms: closeMs, as_of_ms: now, secs_left: secsLeft },
      rungs,
      features,
      ladderComplete: ladder.complete,
    });

    await recordCheckpoint(eventTicker, closeMs, checkpoint, read, rungs, features, secsLeft, now);
    st.seen.add(key);
    st.checkpoints += 1;
    if (st.seen.size > 64) {
      for (const k of [...st.seen].slice(0, st.seen.size - 64)) st.seen.delete(k);
    }
    st.error = null;
    return read;
  } catch (err) {
    st.error = err instanceof Error ? err.message : String(err);
    return null;
  } finally {
    st.busy = false;
  }
}

// ---------------------------------------------------------------------------
// Grading — append outcomes, never rewrite a frozen input
// ---------------------------------------------------------------------------

/** Settlement identity for one rung: YES when the official value is at or above its strike. */
export function outcomeForStrike(official: number, strike: number): 0 | 1 {
  return official >= strike ? 1 : 0;
}

/**
 * Grade every ungraded hour that has settled. The official value comes from the
 * provider's settled ladder (`expiration_value`), the same identity the hourly
 * closer uses — never from spot, and never before the hour has closed.
 */
export async function gradeHourResearch(now = Date.now()): Promise<number> {
  const st = state();
  if (st.grading) return 0;
  st.grading = true;
  try {
    const db = await sql();
    const pending = await db<{ close_time: Date | string; event_ticker: string }>`
      select distinct close_time, event_ticker from desk_hour_shadow
      where graded_at is null and close_time <= now() and close_time > now() - (${Math.round(GRADE_LOOKBACK_MS / 1000)}::int * interval '1 second')
      order by close_time desc limit 12
    `;
    let done = 0;
    for (const row of pending) {
      const closeMs = row.close_time instanceof Date ? row.close_time.getTime() : Date.parse(String(row.close_time));
      if (!Number.isFinite(closeMs) || closeMs > now) continue;
      const ladder = await eventLadder(row.event_ticker || hourEventTicker(closeMs));
      if (!ladder.complete) continue;
      const settledRows = (ladder.markets as HourMarketRow[]).filter((m) => isSettled(m));
      if (!settledRows.length) continue;
      const official = settledRows.map((m) => officialValue(m)).find((v): v is number => v != null) ?? null;
      if (official == null) continue;
      const closeIso = new Date(closeMs).toISOString();

      // Per-rung calibration: the outcome is decided by the official value
      // against that rung's own strike, exactly as the contract settles.
      const preds = await db<{ checkpoint: number; ticker: string; strike: number; p_model: number | null; p_market: number | null; p_baseline_dist: number | null }>`
        select checkpoint, ticker, strike, p_model, p_market, p_baseline_dist
        from desk_hour_predictions where close_time = ${closeIso}::timestamptz and graded_at is null
      `;
      for (const p of preds) {
        const y = outcomeForStrike(official, Number(p.strike));
        await db`
          update desk_hour_predictions set
            result = ${y ? "YES" : "NO"}, official_value = ${official}, outcome_yes = ${y},
            brier_model = ${p.p_model == null ? null : brier(Number(p.p_model), y)},
            brier_market = ${p.p_market == null ? null : brier(Number(p.p_market), y)},
            brier_baseline = ${p.p_baseline_dist == null ? null : brier(Number(p.p_baseline_dist), y)},
            graded_at = now()
          where close_time = ${closeIso}::timestamptz and checkpoint = ${p.checkpoint} and ticker = ${p.ticker}
        `;
      }

      // The shadow book row: settle the one candidate at its own strike.
      const shadow = await db<{ decision: string; side: string | null; strike: number | null; ask: number | null; fee: number | null }>`
        select decision, side, strike, ask, fee from desk_hour_shadow where close_time = ${closeIso}::timestamptz
      `;
      const s = shadow[0];
      if (s) {
        const y = s.strike == null ? null : outcomeForStrike(official, Number(s.strike));
        const result = y == null ? null : y ? "YES" : "NO";
        const settleCents = y == null || s.side == null ? null : (s.side === "YES" ? y === 1 : y === 0) ? 100 : 0;
        const ev =
          settleCents == null || s.ask == null ? null : settleCents - Number(s.ask) - Number(s.fee ?? 0);
        await db`
          update desk_hour_shadow set
            result = ${result}, official_value = ${official}, settle_cents = ${settleCents}, ev_cents = ${ev}, graded_at = now()
          where close_time = ${closeIso}::timestamptz and graded_at is null
        `;
      }
      done += 1;
      st.graded += 1;
    }
    st.error = null;
    return done;
  } catch (err) {
    st.error = err instanceof Error ? err.message : String(err);
    return 0;
  } finally {
    st.grading = false;
  }
}

/** Idempotent boot, kicked from the health check beside the other observers. */
export function ensureHourResearchObserver(): void {
  const st = state();
  if (st.timer) return;
  st.timer = setInterval(() => {
    void hourResearchOnce();
    const now = Date.now();
    if (now - st.lastGrade >= GRADE_EVERY_MS) {
      st.lastGrade = now;
      void gradeHourResearch(now);
    }
  }, TICK_MS);
  st.first = setTimeout(() => void hourResearchOnce(), FIRST_DELAY_MS);
}

/** Read-only diagnostics. Nothing here is a score and nothing reads it back. */
export function hourResearchStatus() {
  const st = state();
  return {
    started: Boolean(st.timer),
    version: HOUR_RESEARCH_VERSION,
    authority: HOUR_RESEARCH_AUTHORITY,
    checkpoints_recorded: st.checkpoints,
    shadow_rows: st.shadowRows,
    graded: st.graded,
    last_run: st.lastRun ? new Date(st.lastRun).toISOString() : null,
    error: st.error,
  };
}
