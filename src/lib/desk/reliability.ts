/**
 * Reliability core — pure and injectable, so every failure mode is unit-testable
 * with fakes, no database and no wall clock. The engine wires these into its
 * tick and watchdog timers; NOTHING here decides what the desk calls. It governs
 * only how a graded window becomes a durable ledger row, and how the service
 * reports its own health. Tests: src/lib/desk/reliability.test.ts.
 *
 * The distinction this file enforces: a grade is CALCULATED in memory (the chair
 * and learner, unchanged), then PERSISTED (the ledger write), then VERIFIED (the
 * row reads back). Only a verified persist counts as a recorded window — a failed
 * write is never treated as a completed grade.
 */

export const WINDOW_MS = 15 * 60_000;

// Health thresholds. Deliberately above the 15-minute grading cadence so a
// normal quiet / all-WAIT market never trips them — every window still closes
// and grades on WAIT, so a genuine stall is the only thing that shows here.
export const LEDGER_STALL_MS = 25 * 60_000; // no window durably recorded this long → unhealthy
export const TICK_STALL_MS = 120_000; // the tick loop has not finished a pass this long → wedged
export const QUEUE_STUCK_MS = 5 * 60_000; // a ledger row has stayed un-persisted this long → the write is failing
export const BOOT_GRACE_MS = 3 * 60_000; // after boot, don't judge "nothing recorded yet" until a window could have closed
export const JOB_RETRY_MS = 8_000; // a failed ledger job waits at least this long before its next attempt
export const MAX_QUEUE = 400; // hard cap (~4 days of windows) so a long outage can't grow memory unbounded

export type LedgerRow = {
  ticker: string;
  /** Window close, ms epoch — with ticker, the ledger's unique key. */
  close_time: number;
  /** The ordered insert params, built once at grade time (never recomputed later). */
  values: unknown[];
};

export type LedgerJob = {
  key: string; // `${ticker}:${close_time}`
  row: LedgerRow;
  attempts: number;
  firstAt: number; // first enqueued (age = how long this window has gone unrecorded)
  nextAt: number; // earliest next attempt (backoff)
  lastErr: string | null;
};

export function jobKey(ticker: string, closeTime: number): string {
  return `${ticker}:${closeTime}`;
}

/**
 * Add a row unless its window is already queued (idempotent by key), bounded by
 * MAX_QUEUE. Anything shed at the cap is still named by the gap scan, so a drop
 * here is never silent.
 */
export function enqueueLedger(queue: LedgerJob[], row: LedgerRow, now: number): LedgerJob[] {
  const key = jobKey(row.ticker, row.close_time);
  if (queue.some((j) => j.key === key)) return queue;
  const next = queue.concat({ key, row, attempts: 0, firstAt: now, nextAt: now, lastErr: null });
  return next.length > MAX_QUEUE ? next.slice(next.length - MAX_QUEUE) : next;
}

export type PersistIO = {
  /** Idempotent upsert (ON CONFLICT (ticker, close_time) DO NOTHING). */
  write: (row: LedgerRow) => Promise<void>;
  /** Read-back: is the row actually in the ledger now? */
  verify: (row: LedgerRow) => Promise<boolean>;
};

export type PersistOutcome =
  | { status: "verified"; job: LedgerJob }
  | { status: "retry"; job: LedgerJob };

/**
 * One persist attempt for one window: write, then VERIFY by read-back. A write
 * that throws — or one that "succeeds" but does not read back — is a retry, never
 * a success, so a silent or half write can never advance the recorded clock.
 * Idempotent: write + verify may run any number of times for the same window
 * with no duplicate row and no second grade (grading already happened in memory;
 * this only records it).
 */
export async function persistOnce(job: LedgerJob, io: PersistIO, now: number): Promise<PersistOutcome> {
  try {
    await io.write(job.row);
    const there = await io.verify(job.row);
    if (there) return { status: "verified", job };
    return {
      status: "retry",
      job: { ...job, attempts: job.attempts + 1, nextAt: now + JOB_RETRY_MS, lastErr: "written but did not read back" },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: "retry",
      job: { ...job, attempts: job.attempts + 1, nextAt: now + JOB_RETRY_MS, lastErr: msg },
    };
  }
}

/**
 * Fold one persist outcome back into the queue. A verified window is removed
 * (and the caller advances the recorded clock); a retry is kept in place with
 * its updated attempts/backoff/error, so the window stays queued until it lands
 * or is named as lost. This is the exact transition the engine runs — it never
 * advances the clock on anything but a verified write.
 */
export function afterPersist(queue: LedgerJob[], out: PersistOutcome): { queue: LedgerJob[]; verified: boolean } {
  if (out.status === "verified") return { queue: queue.filter((q) => q.key !== out.job.key), verified: true };
  return { queue: queue.map((q) => (q.key === out.job.key ? out.job : q)), verified: false };
}

/** Age of the oldest un-persisted window, or 0 when the queue is empty. */
export function oldestQueueAgeMs(queue: LedgerJob[], now: number): number {
  return queue.reduce((max, j) => Math.max(max, now - j.firstAt), 0);
}

/**
 * Interior holes in the ledger. A 15-minute slot with a recorded neighbour on
 * BOTH sides but no row of its own is a window that was graded and then lost.
 * Trailing absence (the most recent slots, possibly still pending) is not a
 * hole — only gaps bracketed by present rows count — so a normal pending window
 * never false-positives. `closeTimesMs` is whatever the caller read from the
 * ledger over its lookback window.
 */
export function ledgerGaps(closeTimesMs: number[], opts?: { windowMs?: number; maxReport?: number }): number[] {
  const w = opts?.windowMs ?? WINDOW_MS;
  const maxReport = opts?.maxReport ?? 200;
  const present = [...new Set(closeTimesMs)].sort((a, b) => a - b);
  if (present.length < 2) return [];
  const holes: number[] = [];
  for (let i = 0; i < present.length - 1 && holes.length < maxReport; i += 1) {
    const gap = present[i + 1] - present[i];
    const k = Math.round(gap / w);
    // Only clean multiples of the window (aligned quarter-hours); tolerate a
    // little clock skew, ignore odd spacing from early history.
    if (k >= 2 && Math.abs(gap - k * w) < 60_000) {
      for (let s = 1; s < k && holes.length < maxReport; s += 1) holes.push(present[i] + s * w);
    }
  }
  return holes;
}

export type HealthInput = {
  now: number;
  started: boolean;
  startedAt: number;
  lastTickAt: number;
  lastLedgerOkAt: number;
  queueOldestAgeMs: number;
  gaps: number;
};

export type HealthVerdict = { ok: boolean; reasons: string[] };

/**
 * The honest data/engine verdict for the deep health endpoint. Unhealthy ONLY on
 * conditions that genuinely mean the experiment stopped working: a wedged tick
 * loop, no window recorded for far longer than the grading cadence, a ledger
 * write stuck failing, or a detected hole. It deliberately does NOT fail on a
 * WAIT streak, a quiet market, a gagged seat, a stale non-critical feed, or a
 * transient error string — none of those mean the desk is down.
 */
export function healthVerdict(i: HealthInput): HealthVerdict {
  const reasons: string[] = [];
  if (!i.started) return { ok: true, reasons }; // a route will boot it; not yet a failure
  if (i.lastTickAt > 0 && i.now - i.lastTickAt > TICK_STALL_MS) {
    reasons.push(`tick loop stalled ${Math.round((i.now - i.lastTickAt) / 1000)}s`);
  }
  if (i.now - i.startedAt > BOOT_GRACE_MS && i.now - i.lastLedgerOkAt > LEDGER_STALL_MS) {
    reasons.push(`no window recorded in ${Math.round((i.now - i.lastLedgerOkAt) / 60_000)} min`);
  }
  if (i.queueOldestAgeMs > QUEUE_STUCK_MS) {
    reasons.push(`ledger write stuck ${Math.round(i.queueOldestAgeMs / 60_000)} min`);
  }
  if (i.gaps > 0) reasons.push(`${i.gaps} ledger window${i.gaps === 1 ? "" : "s"} missing`);
  return { ok: reasons.length === 0, reasons };
}

export type AlertStatus = { ownerSubs: number; lastSend: string | null };

/**
 * Alert-channel health — kept as its own function, and reported in its own
 * section, so a push problem (no owner subscriber, or a failed send) is surfaced
 * SEPARATELY and never flips the data/engine verdict. The external /status
 * monitor is the independent backstop: it catches a stalled desk even when this
 * channel is dead, so alerting is not a single point of failure.
 */
export function alertHealth(a: AlertStatus): { deliverable: boolean; note: string } {
  if (a.ownerSubs <= 0) {
    return {
      deliverable: false,
      note: "no owner push subscription — the internal watchdog has no recipient; the external /status monitor is the backstop",
    };
  }
  return { deliverable: true, note: a.lastSend ? `last ${a.lastSend}` : "owner subscription present" };
}

export type ErrLog = { at: number; scope: string; msg: string };

/** Append to a bounded error ring so recent failures keep their scope and text. */
export function pushErr(ring: ErrLog[], scope: string, msg: string, now: number, cap = 25): ErrLog[] {
  const next = ring.concat({ at: now, scope, msg: String(msg).slice(0, 200) });
  return next.length > cap ? next.slice(next.length - cap) : next;
}
