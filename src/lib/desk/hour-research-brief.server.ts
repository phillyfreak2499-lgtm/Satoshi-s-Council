/**
 * Hour Research v1 — the public read (server only). Read-only. Authority: NONE.
 *
 * Reads the hour in progress from the public Kalshi market list, scores it with
 * the same pure model the observer uses, and reads the frozen research rows back
 * out of desk_hour_predictions / desk_hour_shadow. It issues SELECTs only: it
 * never inserts, updates or deletes anything, and it never touches desk_ledger,
 * desk_hour_ledger, the Chair, the learner or the seat-telemetry tables.
 *
 * A table that cannot be read comes back as `null`, which the brief prints as
 * "could not be read" — never as an empty record.
 */
import {
  hourRead,
  ladderRungs,
  type HourFeatures,
  type HourRead,
  type HourShadowRow,
  type HourSide,
} from "./hour-research.ts";
import {
  buildHourResearchBrief,
  type HourCheckpointRow,
  type HourGradedPrediction,
  type HourResearchBrief,
} from "./hour-research-brief.ts";
import { parseHourTicker, quoteCents, type HourMarketRow } from "./hour.ts";
import { eventLadder } from "./hour-closer.server";
import { hourEventTicker } from "./hour-closer";
import { brtiForBrief, featuresFromRaw } from "./hour-research.server";

const HOUR_MS = 60 * 60 * 1000;
const CACHE_MS = 20_000;
/** How many settled hours the record and its calibration are drawn from. */
const RECORD_HOURS = 30 * 24;

async function sql() {
  const { getSql } = await import("@/lib/db");
  return getSql();
}

const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());
const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const side = (v: unknown): HourSide | null => (v === "YES" || v === "NO" ? v : null);

/** RAW market fields from the shared frame — spot, index, basis, candles, returns. */
async function rawSnap(): Promise<Parameters<typeof featuresFromRaw>[0]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { getServerFrame } = await import("./server-engine");
    const frame = await Promise.race([
      getServerFrame(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 2_500);
      }),
    ]);
    const s = frame?.snap as Record<string, unknown> | undefined;
    if (!s) return null;
    return {
      spot: s.spot as number | undefined,
      spot_age_s: s.spot_age_s as number | undefined,
      index_px: s.index_px as number | undefined,
      basis_bps: s.basis_bps as number | undefined,
      candles_1m: s.candles_1m as never,
      candles_1h: s.candles_1h as never,
      ret5: s.ret5 as number | undefined,
      ret15: s.ret15 as number | undefined,
      ret30: s.ret30 as number | undefined,
      ret1h: s.ret1h as number | undefined,
      range_pos: s.range_pos as number | undefined,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Every frozen checkpoint recorded for one hour, oldest first. */
async function storedCheckpoints(closeIso: string): Promise<HourCheckpointRow[] | null> {
  try {
    const db = await sql();
    const rows = await db<{
      checkpoint: number;
      decision: string;
      wait_reason: string | null;
      ticker: string | null;
      strike: unknown;
      side: string | null;
      ask: unknown;
      p_model: unknown;
      edge_cents: unknown;
      as_of: Date | string;
    }>`
      select checkpoint, decision, wait_reason, ticker, strike, side, ask, p_model, edge_cents, as_of
      from desk_hour_shadow where close_time = ${closeIso}::timestamptz
    `;
    // The shadow book keeps one row per hour; the per-rung table keeps every
    // checkpoint, so the timeline is drawn from the selected rung there.
    const picks = await db<{
      checkpoint: number;
      ticker: string;
      strike: unknown;
      p_model: unknown;
      best_side: string | null;
      best_edge: unknown;
      yes_ask: unknown;
      no_ask: unknown;
      as_of: Date | string;
    }>`
      select checkpoint, ticker, strike, p_model, best_side, best_edge, yes_ask, no_ask, as_of
      from desk_hour_predictions
      where close_time = ${closeIso}::timestamptz and is_selected
      order by checkpoint desc
    `;
    const book = rows[0];
    const out: HourCheckpointRow[] = picks.map((p) => {
      const s = side(p.best_side);
      return {
        checkpoint: Number(p.checkpoint),
        decision: s ?? "WAIT",
        wait_reason: null,
        ticker: p.ticker,
        strike: num(p.strike),
        side: s,
        ask: s === "NO" ? num(p.no_ask) : num(p.yes_ask),
        p_model: num(p.p_model),
        edge_cents: num(p.best_edge),
        as_of: iso(p.as_of),
      };
    });
    // Checkpoints that produced no candidate leave no selected rung; the hour's
    // shadow row carries their WAIT reason, so fold it in for its own checkpoint.
    if (book && !out.some((r) => r.checkpoint === Number(book.checkpoint))) {
      out.push({
        checkpoint: Number(book.checkpoint),
        decision: book.decision === "YES" || book.decision === "NO" ? book.decision : "WAIT",
        wait_reason: book.wait_reason,
        ticker: book.ticker,
        strike: num(book.strike),
        side: side(book.side),
        ask: num(book.ask),
        p_model: num(book.p_model),
        edge_cents: num(book.edge_cents),
        as_of: iso(book.as_of),
      });
    }
    return out.sort((a, b) => b.checkpoint - a.checkpoint);
  } catch {
    return null;
  }
}

/** The graded shadow book, newest first. */
async function shadowRows(): Promise<HourShadowRow[] | null> {
  try {
    const db = await sql();
    const rows = await db<Record<string, unknown>>`
      select close_time, checkpoint, decision, wait_reason, ticker, strike, side, ask, fee,
             p_model, p_market, edge_cents, explanation, result, official_value, ev_cents, graded_at
      from desk_hour_shadow
      where close_time > now() - (${RECORD_HOURS}::int * interval '1 hour')
      order by close_time desc
    `;
    return rows.map((r) => ({
      close_time: iso(r.close_time as Date | string),
      checkpoint: Number(r.checkpoint),
      decision: r.decision === "YES" || r.decision === "NO" ? r.decision : "WAIT",
      wait_reason: (r.wait_reason as string | null) ?? null,
      ticker: (r.ticker as string | null) ?? null,
      strike: num(r.strike),
      side: side(r.side),
      ask: num(r.ask),
      fee: num(r.fee),
      p_model: num(r.p_model),
      p_market: num(r.p_market),
      edge_cents: num(r.edge_cents),
      explanation: String(r.explanation ?? ""),
      result: r.result === "YES" || r.result === "NO" ? r.result : null,
      official_value: num(r.official_value),
      ev_cents: num(r.ev_cents),
      // Completion, not outcome: a graded WAIT has no result and is still a
      // finished hour.
      graded_at: r.graded_at == null ? null : iso(r.graded_at as Date | string),
    }));
  } catch {
    return null;
  }
}

/** Every graded per-rung prediction in the record window: the calibration surface. */
async function gradedPredictions(): Promise<HourGradedPrediction[] | null> {
  try {
    const db = await sql();
    const rows = await db<{ checkpoint: number; p_model: unknown; p_market: unknown; p_baseline_dist: unknown; outcome_yes: unknown }>`
      select checkpoint, p_model, p_market, p_baseline_dist, outcome_yes
      from desk_hour_predictions
      where graded_at is not null and close_time > now() - (${RECORD_HOURS}::int * interval '1 hour')
    `;
    return rows.map((r) => ({
      checkpoint: Number(r.checkpoint),
      p_model: num(r.p_model),
      p_market: num(r.p_market),
      p_baseline_dist: num(r.p_baseline_dist),
      outcome_yes: r.outcome_yes === 1 || r.outcome_yes === "1" ? 1 : r.outcome_yes === 0 || r.outcome_yes === "0" ? 0 : null,
    }));
  } catch {
    return null;
  }
}

/**
 * The hour in progress, scored off-checkpoint so the page can show the read as
 * it stands. Storage still only keeps checkpoints: this preview is never
 * written anywhere.
 */
async function liveRead(now: number): Promise<{
  hour: { event_ticker: string; close_ms: number; secs_left: number };
  read: HourRead;
  features: HourFeatures;
} | null> {
  try {
    const closeMs = Math.ceil(now / HOUR_MS) * HOUR_MS;
    const secsLeft = (closeMs - now) / 1000;
    const eventTicker = hourEventTicker(closeMs);
    // The same settlement feed the observer records from: a preview that read a
    // different input than the frozen checkpoints would be showing the reader a
    // different model than the one on the record.
    const [ladder, snap, brti] = await Promise.all([eventLadder(eventTicker), rawSnap(), brtiForBrief()]);
    const rungs = ladderRungs(ladder.markets as readonly HourMarketRow[], closeMs, parseHourTicker, quoteCents);
    if (!rungs.length) return null;
    const features = featuresFromRaw(snap, brti);
    const read = hourRead({
      clock: { event_ticker: eventTicker, close_ms: closeMs, as_of_ms: now, secs_left: secsLeft },
      rungs,
      features,
      ladderComplete: ladder.complete,
      requireCheckpoint: false,
    });
    return { hour: { event_ticker: eventTicker, close_ms: closeMs, secs_left: secsLeft }, read, features };
  } catch {
    return null;
  }
}

let cache: { at: number; body: HourResearchBrief } | null = null;
let inflight: Promise<HourResearchBrief> | null = null;

async function build(): Promise<HourResearchBrief> {
  const now = Date.now();
  const live = await liveRead(now);
  const closeIso = live ? new Date(live.hour.close_ms).toISOString() : null;
  const [stored, shadow, graded] = await Promise.all([
    closeIso ? storedCheckpoints(closeIso) : Promise.resolve<HourCheckpointRow[] | null>([]),
    shadowRows(),
    gradedPredictions(),
  ]);
  return buildHourResearchBrief({
    now,
    hour: live?.hour ?? null,
    read: live?.read ?? null,
    features: live?.features ?? null,
    stored,
    shadow,
    graded,
  });
}

export async function hourResearchBrief(): Promise<HourResearchBrief> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.body;
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
