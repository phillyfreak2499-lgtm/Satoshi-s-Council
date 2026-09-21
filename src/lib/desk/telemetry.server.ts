/**
 * MEASUREMENT-ONLY seat + Chair telemetry WRITER. Authority: NONE.
 *
 * Structural guarantees (see the invariant tests in telemetry.test.ts):
 *  - Reads the already-computed (snap, votes, ChairResult) objects. Mutates none
 *    of them, calls no decider/booker/learner-writer/actuator.
 *  - OFF by default. It does nothing unless SEAT_TELEMETRY_ENABLED is truthy, so
 *    merging this file cannot change production behaviour until it is deliberately
 *    turned on.
 *  - Live only: demo ticks are skipped.
 *  - No synchronous DB work on the tick. `noteSeatTelemetry` only classifies and
 *    buffers in memory; a background interval flushes batches to Postgres.
 *  - Fail-open: every path is wrapped so a build, buffer, or DB error is recorded
 *    and swallowed. Telemetry can never throw into, delay, or alter a Chair tick.
 *  - Bounded: per-window min-interval + sample cap keep row volume sane; the
 *    in-memory buffer is capped (oldest dropped) so a DB outage cannot grow memory;
 *    old rows are pruned on a fixed retention.
 */
import { getSql } from "@/lib/db";
import {
  buildChairEvalRow,
  buildSeatReadRows,
  DEFAULT_SAMPLE_POLICY,
  emptyCounters,
  flushBatch,
  shouldSample,
  type ChairEvalRow,
  type SamplePolicy,
  type SampleState,
  type SeatReadRow,
  type TelemetryCounters,
} from "./telemetry.ts";
import type { ChairResult, Learner, Snapshot, Vote } from "./types";

const truthy = (v: string | undefined): boolean =>
  v != null && ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());

/** OFF unless explicitly enabled. Re-read every call so it can be flipped by env. */
function enabled(): boolean {
  return truthy(process.env.SEAT_TELEMETRY_ENABLED);
}

const numEnv = (name: string, dflt: number): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : dflt;
};

// Sampling policy (env-overridable; defaults from the pure DEFAULT_SAMPLE_POLICY,
// sized so a full 15-minute window is covered end to end without the cap being
// the normal reason sampling stops).
function policy(): SamplePolicy {
  return {
    minIntervalMs: numEnv("SEAT_TELEMETRY_MIN_INTERVAL_MS", DEFAULT_SAMPLE_POLICY.minIntervalMs),
    windowCap: numEnv("SEAT_TELEMETRY_WINDOW_CAP", DEFAULT_SAMPLE_POLICY.windowCap),
  };
}
const FLUSH_MS = 5_000;
const MAX_BUFFER_ROWS = 20_000;
const INSERT_BATCH = 200;
const RETENTION_DAYS = () => numEnv("SEAT_TELEMETRY_RETENTION_DAYS", 45);
const PRUNE_EVERY_FLUSHES = 240; // ~20 min at 5s cadence

type Observer = {
  seatBuf: SeatReadRow[];
  chairBuf: ChairEvalRow[];
  sampled: Map<string, SampleState>;
  timer: ReturnType<typeof setInterval> | null;
  flushing: boolean;
  counters: TelemetryCounters;
};

const g = globalThis as typeof globalThis & { __seatTelemetry__?: Observer };
const state = (): Observer =>
  (g.__seatTelemetry__ ??= {
    seatBuf: [],
    chairBuf: [],
    sampled: new Map(),
    timer: null,
    flushing: false,
    counters: emptyCounters(),
  });

function buildSha(): string {
  const sha = String(process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? "").trim().toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(sha) ? sha : "";
}

/**
 * Buffer this tick's telemetry (never blocks, never throws). Call AFTER the Chair
 * decision exists; `raw` is the canonical runChair output (carries the bar
 * breakdown and per-seat rows), `final` is what was presented downstream.
 */
export function noteSeatTelemetry(
  snap: Snapshot,
  votes: Vote[],
  raw: ChairResult,
  final: ChairResult,
  learner: Learner,
): void {
  try {
    if (!enabled()) return;
    if (snap.demo) return;
    if (!snap.ticker || !(snap.close_time > 0)) return;

    const s = state();
    const key = `${snap.ticker}|${snap.close_time}`;
    const now = snap.as_of;
    const decision = shouldSample(s.sampled.get(key), now, policy());
    if (!decision.take) return;
    s.sampled.set(key, decision.state);
    if (s.sampled.size > 256) {
      // keep only recent windows so the sampler map cannot grow unbounded
      const cutoff = now - 60 * 60_000;
      for (const [k, v] of s.sampled) if (v.last < cutoff) s.sampled.delete(k);
    }

    s.chairBuf.push(buildChairEvalRow(snap, votes, raw, final));
    for (const r of buildSeatReadRows(snap, votes, raw, learner)) s.seatBuf.push(r);

    if (s.seatBuf.length > MAX_BUFFER_ROWS) {
      s.counters.bufferOverflowRows += s.seatBuf.length - MAX_BUFFER_ROWS;
      s.seatBuf.splice(0, s.seatBuf.length - MAX_BUFFER_ROWS);
    }
    if (s.chairBuf.length > MAX_BUFFER_ROWS) {
      s.counters.bufferOverflowRows += s.chairBuf.length - MAX_BUFFER_ROWS;
      s.chairBuf.splice(0, s.chairBuf.length - MAX_BUFFER_ROWS);
    }
    ensureFlusher();
  } catch (e) {
    try {
      state().counters.lastError = e instanceof Error ? e.message : String(e);
    } catch {
      /* never throw into the tick */
    }
  }
}

function ensureFlusher(): void {
  const s = state();
  if (s.timer) return;
  s.timer = setInterval(() => void flush(), FLUSH_MS);
  if (typeof s.timer === "object" && s.timer && "unref" in s.timer) {
    (s.timer as { unref?: () => void }).unref?.();
  }
}

async function flush(): Promise<void> {
  const s = state();
  if (s.flushing) return;
  if (!s.seatBuf.length && !s.chairBuf.length) return;
  s.flushing = true;
  try {
    const sha = buildSha();
    // Dequeue first: fail-open means these rows are already out of the buffer, so
    // a DB failure never applies retry pressure to the desk. flushBatch counts
    // exactly what persists and what is lost, per side (seat vs chair), so a
    // partial write (one insert succeeds, the other fails) is never miscounted as
    // total loss and DB-loss never disappears silently.
    const seat = s.seatBuf.splice(0, INSERT_BATCH);
    const chair = s.chairBuf.splice(0, INSERT_BATCH);
    await flushBatch(
      seat,
      chair,
      (rows) => insertSeatRows(rows, sha),
      (rows) => insertChairRows(rows, sha),
      s.counters,
      Date.now(),
    );
    if (s.counters.flushes % PRUNE_EVERY_FLUSHES === 0) {
      try {
        await prune();
      } catch (e) {
        s.counters.lastError = e instanceof Error ? e.message : String(e);
      }
    }
  } finally {
    s.flushing = false;
  }
}

const SEAT_COLS = [
  "ticker", "close_time", "as_of", "seat", "phase", "mins_left", "secs_left",
  "eligible_voter", "active_skill", "skill_status", "raw_lean", "raw_conf",
  "speak_offset", "effective_speak_threshold", "passed_speak", "final_lean",
  "final_conf", "forced_sit", "suppression_reason", "seat_weight", "seat_status",
  "contribution", "health", "feed_age_s", "shadow_lean", "build_sha",
];

async function insertSeatRows(rows: SeatReadRow[], sha: string): Promise<void> {
  const db = await getSql();
  const params: unknown[] = [];
  const groups: string[] = [];
  let i = 1;
  for (const r of rows) {
    const vals = [
      r.ticker, r.close_time, r.as_of, r.seat, r.phase, r.mins_left, r.secs_left,
      r.eligible_voter, r.active_skill, r.skill_status, r.raw_lean, r.raw_conf,
      r.speak_offset, r.effective_speak_threshold, r.passed_speak, r.final_lean,
      r.final_conf, r.forced_sit, r.suppression_reason, r.seat_weight, r.seat_status,
      r.contribution, r.health, r.feed_age_s, r.shadow_lean, sha,
    ];
    groups.push(`(${vals.map(() => `$${i++}`).join(",")})`);
    params.push(...vals);
  }
  await db.query(
    `insert into desk_seat_reads (${SEAT_COLS.join(",")}) values ${groups.join(",")} on conflict do nothing`,
    params,
  );
}

const CHAIR_COLS = [
  "ticker", "close_time", "as_of", "phase", "mins_left", "secs_left", "raw_score",
  "abs_score", "dir_mass", "sit_total_mass", "sit_mass", "eligible_voter_count",
  "speaker_count", "up_speakers", "down_speakers", "silent_count", "bar_base",
  "bar_quiet", "bar_weekend", "bar_phase", "bar_law_miss1", "bar_calib_tax",
  "bar_sit_mass", "bar_knn", "bar_pre_clamp", "bar_final", "aggressiveness",
  "time_factor", "vs_bar", "diversity", "categories_agree", "conflict",
  "conflict_frac", "hard_fail", "raw_chair_lean", "final_lean",
  "final_differs_from_raw", "confidence", "size", "wait_reason", "gates", "build_sha",
];

async function insertChairRows(rows: ChairEvalRow[], sha: string): Promise<void> {
  const db = await getSql();
  const params: unknown[] = [];
  const groups: string[] = [];
  let i = 1;
  for (const r of rows) {
    const scalars = [
      r.ticker, r.close_time, r.as_of, r.phase, r.mins_left, r.secs_left, r.raw_score,
      r.abs_score, r.dir_mass, r.sit_total_mass, r.sit_mass, r.eligible_voter_count,
      r.speaker_count, r.up_speakers, r.down_speakers, r.silent_count, r.bar_base,
      r.bar_quiet, r.bar_weekend, r.bar_phase, r.bar_law_miss1, r.bar_calib_tax,
      r.bar_sit_mass, r.bar_knn, r.bar_pre_clamp, r.bar_final, r.aggressiveness,
      r.time_factor, r.vs_bar, r.diversity, r.categories_agree, r.conflict,
      r.conflict_frac, r.hard_fail, r.raw_chair_lean, r.final_lean,
      r.final_differs_from_raw, r.confidence, r.size, r.wait_reason,
    ];
    const ph = scalars.map(() => `$${i++}`);
    ph.push(`$${i++}::jsonb`); // gates
    ph.push(`$${i++}`); // build_sha
    groups.push(`(${ph.join(",")})`);
    params.push(...scalars, JSON.stringify(r.gates), sha);
  }
  await db.query(
    `insert into desk_chair_evals (${CHAIR_COLS.join(",")}) values ${groups.join(",")} on conflict do nothing`,
    params,
  );
}

async function prune(): Promise<void> {
  const db = await getSql();
  const days = RETENTION_DAYS();
  await db.query(`delete from desk_seat_reads where as_of < now() - ($1 || ' days')::interval`, [String(days)]);
  await db.query(`delete from desk_chair_evals where as_of < now() - ($1 || ' days')::interval`, [String(days)]);
}

/**
 * Read-only health for an ops endpoint. Never used by any decision path. Every
 * kind of lost row is a distinct counter: buffer-overflow drops, failed seat-row
 * DB batches and failed Chair-row DB batches are never merged into one ambiguous
 * number, so research can tell whether telemetry coverage was actually complete.
 */
export function seatTelemetryHealth() {
  const s = state();
  const c = s.counters;
  return {
    enabled: enabled(),
    buffered_seat: s.seatBuf.length,
    buffered_chair: s.chairBuf.length,
    wrote: c.wrote,
    buffer_overflow_rows: c.bufferOverflowRows,
    failed_seat_write_rows: c.failedSeatRows,
    failed_chair_write_rows: c.failedChairRows,
    write_failures: c.writeFailures,
    flushes: c.flushes,
    last_flush: c.lastFlush,
    last_error: c.lastError,
  };
}

/** Test-only: flush synchronously and reset buffers. */
export const __telemetryTest = { flush, state };
