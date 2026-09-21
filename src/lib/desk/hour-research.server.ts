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
  distanceBaselineFor,
  hourRead,
  ladderRungs,
  brier,
  type HourCheckpoint,
  type HourFeatures,
  type HourRead,
  type HourRung,
} from "./hour-research.ts";
import { HOUR_SHADOW_UPSERT, hourPredictionsInsert } from "./hour-research-sql.ts";
import { parseHourTicker, quoteCents, type HourMarketRow } from "./hour.ts";
import { eventLadder } from "./hour-closer.server";
import { hourEventTicker, isSettled, officialValue } from "./hour-closer";

const HOUR_MS = 60 * 60 * 1000;
/**
 * The observer's cadence. It must be shorter than HOUR_CHECKPOINT_GRACE_S so a
 * running process always gets at least one tick inside a checkpoint's capture
 * window; a rail asserts that relationship holds.
 */
const TICK_MS = 20_000;
const FIRST_DELAY_MS = 25_000;
/** How far back the grader looks for hours that have settled. */
const GRADE_LOOKBACK_MS = 6 * HOUR_MS;
const GRADE_EVERY_MS = 10 * 60_000;
/**
 * A safety bound on rows per checkpoint, not a modelling choice. Every priced
 * rung is stored; this only stops a pathological ladder from writing unbounded
 * rows, and a truncation is recorded on the shadow row rather than hidden.
 */
const STORE_RUNGS_MAX = 250;

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
export function featuresFromRaw(snap: RawSnap | null, brti: BrtiRead | null = null): HourFeatures {
  const spot = numOrNull(snap?.spot);
  const venueIndex = numOrNull(snap?.index_px);
  const brtiValue = brti && Number.isFinite(brti.value) && brti.value > 0 ? brti.value : null;
  return {
    // THE SETTLEMENT INPUT, FROM THE SETTLEMENT FEED. Both clocks are carried:
    // the age WE measured, and the age of the vendor's own stamp. When there is
    // no value there is no age either, so a missing reading can never look
    // current; and a tick that arrived without a source time keeps a null vendor
    // age, which `brtiUsable` refuses rather than waves through.
    brti: brtiValue,
    brti_age_s: brtiValue != null ? numOrNull(brti?.age_s) : null,
    brti_source_age_s: brtiValue != null ? numOrNull(brti?.source_age_s) : null,
    brti_source: brtiValue != null ? (brti?.source ?? "") : "",

    // VENUE CONTEXT, NEVER SETTLEMENT. `snap.index_px` is an OKX/Binance
    // PERPETUAL index and `snap.basis_bps` is perp-vs-spot basis. They are
    // stored because they are useful, and they are structurally unable to become
    // the expected settlement value: `expectedSettlement` reads only `brti`.
    venue_index: venueIndex != null && venueIndex > 0 ? venueIndex : null,
    venue_index_age_s: venueIndex != null && venueIndex > 0 ? numOrNull(snap?.spot_age_s) : null,
    venue_basis_bps: numOrNull(snap?.basis_bps),

    spot,
    spot_age_s: numOrNull(snap?.spot_age_s),
    brti_spot_basis: brtiValue != null && spot != null ? brtiValue - spot : null,

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
 * The shape this module needs from the lab's BRTI read. Structural on purpose.
 *
 * `source_age_s` is the vendor's own stamp age and is `null` when the tick
 * carried none. It is carried all the way onto the frozen snapshot because a
 * reading that cannot be dated at the source cannot be trusted to be current,
 * however recently it arrived.
 */
export type BrtiRead = { value: number; age_s: number; source_age_s: number | null; source: string };

/**
 * The CF Benchmarks settlement value, from the lab's websocket state.
 *
 * Dynamic on purpose, exactly as the frame read is: nothing here statically
 * imports the lab, and the only thing taken from it is raw measurement — a
 * number, its two ages and its source. No fair value, no probability, no Chair,
 * no seat, no learner. When the lab is dark this is null and the model WAITs
 * rather than substituting an exchange print or a perpetual index for the thing
 * the contract actually settles on.
 */
export async function brtiSnapshot(): Promise<BrtiRead | null> {
  try {
    const { labBrtiNow } = await import("./lab.server");
    const b = labBrtiNow();
    if (!b) return null;
    return { value: b.value, age_s: b.age_s, source_age_s: b.source_age_s, source: b.source };
  } catch {
    return null;
  }
}

/** The same settlement read, for the public brief. One feed, one model. */
export const brtiForBrief = brtiSnapshot;

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

/**
 * A rung worth storing: one the feed actually priced on at least one side.
 *
 * EVERY PRICED RUNG IS STORED, which is what the calibration surface was always
 * supposed to be. An earlier version kept only the 41 rungs nearest expected
 * settlement while the PR claimed it kept them all — so the tails, which are
 * exactly where a probability model is most likely to be badly calibrated, were
 * silently missing from the record.
 *
 * A rung with NO quote on either side is dropped rather than stored, because it
 * carries no market information to calibrate against; `ladder_rungs` versus
 * `stored_rungs` on the shadow row makes that difference visible on every hour.
 * `STORE_RUNGS_MAX` is a safety bound against a pathological feed, not a
 * modelling choice, and a truncation is recorded rather than hidden.
 */
export function pricedRungs(rungs: readonly HourRung[]): HourRung[] {
  return rungs.filter((r) => r.yes_bid != null || r.yes_ask != null || r.no_bid != null || r.no_ask != null);
}

/** Rungs actually written for one checkpoint, nearest expected settlement first when truncation is forced. */
export function rungsToStore(
  rungs: readonly HourRung[],
  expected: number | null,
  selected: string | null,
  limit = STORE_RUNGS_MAX,
): HourRung[] {
  const priced = pricedRungs(rungs);
  if (priced.length <= limit) return priced;
  // Only reachable on a pathological ladder. Keep the band around expected
  // settlement plus the model's own choice, and say so on the row.
  const anchor = expected ?? priced[Math.floor(priced.length / 2)]!.strike;
  const near = [...priced].sort((a, b) => Math.abs(a.strike - anchor) - Math.abs(b.strike - anchor)).slice(0, limit);
  if (selected && !near.some((r) => r.ticker === selected)) {
    const pick = priced.find((r) => r.ticker === selected);
    if (pick) near[near.length - 1] = pick;
  }
  return near.sort((a, b) => a.strike - b.strike);
}

/**
 * Freeze one checkpoint.
 *
 * TWO WRITES, BOTH IDEMPOTENT AND BOTH FORWARD-ONLY.
 *
 * The per-rung table takes every priced rung in ONE statement — the old version
 * issued a round trip per rung, which is why it could only afford a 41-rung
 * band. `on conflict do nothing` means a repeated tick inside the same capture
 * window writes nothing, so a restart cannot double-count.
 *
 * The shadow row is ONE ROW PER HOUR and is replaced WHOLE or not at all. The
 * old WAIT upsert moved `checkpoint`, `as_of`, `secs_left` and `explanation`
 * forward while leaving `expected_settlement`, the index and spot fields, sigma,
 * the ladder counts and the features JSON from the PREVIOUS checkpoint — so a
 * row could claim the 10-minute clock over the 30-minute snapshot. Every frozen
 * field now moves together, guarded by `excluded.checkpoint < ...checkpoint`:
 * checkpoints count DOWN, so that admits only a strictly later instant and makes
 * a duplicate or out-of-order tick a no-op.
 */
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
  const selected = read.candidate?.ticker ?? null;

  const store = rungsToStore(rungs, read.expected_settlement, selected);
  const keep = new Set(store.map((r) => r.ticker));
  const scored = read.rungs.filter((r) => keep.has(r.ticker));

  if (scored.length) {
    const params: unknown[] = [];
    for (const r of scored) {
      params.push(
        eventTicker, closeIso, checkpoint, r.ticker, r.strike, asOfIso, secsLeft,
        r.p_yes, r.uncertainty, r.z, r.dollars_to_strike, r.market_p_yes,
        // Null unless spot itself passes the same freshness contract the quality
        // verdict uses. A baseline priced off a spot the desk cannot date is not
        // a fair comparison, so the row stores no baseline rather than a bad one.
        distanceBaselineFor(features, r.strike, secsLeft),
        r.yes_ask, r.no_ask, r.spread_yes, r.spread_no, r.edge_yes, r.edge_no,
        r.best_side, r.best_edge, r.ticker === selected, HOUR_RESEARCH_VERSION, sha,
      );
    }
    await db.query(hourPredictionsInsert(scored.length), params);
  }

  const c = read.candidate;
  const featureJson = JSON.stringify({
    ...features,
    quality: read.quality,
    expected_source: read.expected_source,
    stored_rungs: scored.length,
    priced_rungs: pricedRungs(rungs).length,
    ladder_rungs: rungs.length,
  });

  // Every frozen field of the shadow row, written together. The two branches
  // differ only in the candidate columns; the snapshot half is identical, so a
  // WAIT and a call can never disagree about what the desk could see.
  const values = [
    closeIso, eventTicker, checkpoint,
    c ? c.side : "WAIT", c ? null : read.wait_reason,
    c?.ticker ?? null, c?.strike ?? null, c?.side ?? null, c?.ask ?? null, c?.fee ?? null,
    c?.p_model ?? null, c?.market_p_yes ?? null, c?.edge_cents ?? null, c?.uncertainty ?? null,
    asOfIso, secsLeft, read.expected_settlement, read.expected_source, read.sigma_horizon,
    features.brti, features.spot, features.brti_spot_basis, features.sigma_hour,
    read.quality.rungs, read.quality.ladder_complete, read.quality.inversions, scored.length,
    featureJson, read.explanation, HOUR_RESEARCH_VERSION, HOUR_RESEARCH_AUTHORITY, sha,
  ];
  await db.query(HOUR_SHADOW_UPSERT, values);
  if (c) state().shadowRows += 1;
}

/**
 * One observer pass: record a checkpoint for the hour now in progress, if due.
 *
 * CAPTURE IS AT OR AFTER THE TARGET, NEVER BEFORE. `checkpointFor` admits only
 * `target ≥ secsLeft ≥ target − grace`, so a 30-minute checkpoint always means
 * "thirty minutes left, or a few seconds less" — the same thing every hour,
 * whatever the process happened to be doing.
 *
 * A RESTART CHANGES NOTHING ABOUT THE RULE. The in-process `seen` set is only a
 * fetch-saving optimisation; after a restart it is empty and the DB's own
 * conflict clauses decide. A checkpoint whose window has closed is simply
 * missing — never backfilled, because anything reconstructed later would carry
 * information the model did not have at the target instant.
 */
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
    const [ladder, snap, brti] = await Promise.all([eventLadder(eventTicker), rawSnapshot(), brtiSnapshot()]);
    const rungs = ladderRungs(ladder.markets as readonly HourMarketRow[], closeMs, parseHourTicker, quoteCents);
    const features = featuresFromRaw(snap, brti);
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
