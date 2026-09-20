import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addKeyed,
  afterPersist,
  alertHealth,
  BOOT_GRACE_MS,
  enqueueLedger,
  type Keyed,
  partitionResolved,
  PENDING_CAP,
  removeKeyed,
  sanitizeQueue,
  healthVerdict,
  IDENTITY_FAULT_RECENT_MS,
  JOB_RETRY_MS,
  jobKey,
  type LedgerJob,
  type LedgerRow,
  LEDGER_STALL_MS,
  ledgerGaps,
  MAX_QUEUE,
  oldestQueueAgeMs,
  persistOnce,
  type PersistIO,
  recentIdentityFaultCount,
  pushErr,
  QUEUE_STUCK_MS,
  TICK_STALL_MS,
  WINDOW_MS,
} from "./reliability.ts";

const row = (ticker: string, closeTime: number): LedgerRow => ({ ticker, close_time: closeTime, values: [ticker, closeTime] });
const job = (r: LedgerRow, now = 0): LedgerJob => ({ key: jobKey(r.ticker, r.close_time), row: r, attempts: 0, firstAt: now, nextAt: now, lastErr: null });

/**
 * A fake ledger keyed by (ticker, close_time), the real unique key. `write` is an
 * idempotent upsert (ON CONFLICT DO NOTHING): a second write of the same window
 * is a no-op, never a duplicate. `fail`/`blackhole` inject the ugly cases.
 */
function fakeLedger(opts: { failTimes?: number; blackhole?: boolean; hang?: boolean } = {}) {
  const rows = new Set<string>();
  let failsLeft = opts.failTimes ?? 0;
  const io: PersistIO & { rows: Set<string>; writes: number } = {
    rows,
    writes: 0,
    async write(r) {
      io.writes += 1;
      if (opts.hang) await new Promise(() => {}); // never resolves — the caller must time out around it
      if (failsLeft > 0) {
        failsLeft -= 1;
        throw new Error("ECONNREFUSED: the database is down");
      }
      if (!opts.blackhole) rows.add(jobKey(r.ticker, r.close_time)); // blackhole: write "succeeds" but nothing lands
    },
    async verify(r) {
      return rows.has(jobKey(r.ticker, r.close_time));
    },
  };
  return io;
}

// --- persistOnce: write, then VERIFY; a failed or unverified write is a retry ---

test("a clean write that reads back is verified", async () => {
  const io = fakeLedger();
  const out = await persistOnce(job(row("KX", 1000)), io, 0);
  assert.equal(out.status, "verified");
  assert.equal(io.rows.size, 1);
});

test("Postgres failure during grading is a retry, not a completed grade", async () => {
  const io = fakeLedger({ failTimes: 1 });
  const out = await persistOnce(job(row("KX", 1000)), io, 0);
  assert.equal(out.status, "retry");
  assert.equal(out.job.attempts, 1);
  assert.match(out.job.lastErr ?? "", /database is down/);
  assert.equal(out.job.nextAt, JOB_RETRY_MS); // backoff scheduled
  assert.equal(io.rows.size, 0); // nothing landed
});

test("a write that succeeds but does not read back is a retry, never a success", async () => {
  const io = fakeLedger({ blackhole: true });
  const out = await persistOnce(job(row("KX", 1000)), io, 0);
  assert.equal(out.status, "retry");
  assert.match(out.job.lastErr ?? "", /did not read back/);
});

test("a transient outage recovers the evidence when the DB returns", async () => {
  const io = fakeLedger({ failTimes: 2 });
  let j = job(row("KX", 1000));
  const first = await persistOnce(j, io, 0);
  assert.equal(first.status, "retry");
  j = first.job;
  const second = await persistOnce(j, io, JOB_RETRY_MS);
  assert.equal(second.status, "retry");
  j = second.job;
  const third = await persistOnce(j, io, JOB_RETRY_MS * 2);
  assert.equal(third.status, "verified"); // the row is recovered, not lost
  assert.equal(io.rows.size, 1);
  assert.equal(j.attempts, 2);
});

test("retrying a window is idempotent — never a duplicate row or a second grade", async () => {
  const io = fakeLedger();
  const j = job(row("KX", 1000));
  await persistOnce(j, io, 0);
  await persistOnce(j, io, JOB_RETRY_MS); // retry the SAME window (e.g. lost ack)
  await persistOnce(j, io, JOB_RETRY_MS * 2);
  assert.equal(io.rows.size, 1); // one row, no matter how many attempts
  assert.equal(io.writes, 3); // upsert ran each time; ON CONFLICT keeps it at one
});

test("a hung DB write does not hang the caller when wrapped in a timeout", async () => {
  const io = fakeLedger({ hang: true });
  const timed = Promise.race([
    persistOnce(job(row("KX", 1000)), io, 0).then(() => "resolved"),
    new Promise((r) => setTimeout(() => r("timeout"), 30)),
  ]);
  assert.equal(await timed, "timeout"); // the real pool's statement_timeout turns this into a thrown retry
});

// --- the exact drain transition the engine runs (afterPersist + persistOnce) ---

test("a failed write keeps the window queued and never advances the recorded clock", async () => {
  const io = fakeLedger({ failTimes: 99 }); // DB down throughout
  let queue = enqueueLedger([], row("KX", 1000), 0);
  let recordedAt = 0; // stands in for lastLedgerOkAt
  const out = await persistOnce(queue[0], io, 100);
  const res = afterPersist(queue, out);
  queue = res.queue;
  if (res.verified) recordedAt = 100;
  assert.equal(res.verified, false);
  assert.equal(queue.length, 1); // still queued — the window is preserved, not lost
  assert.equal(recordedAt, 0); // the recorded clock did NOT move on a failed write
  assert.match(queue[0].lastErr ?? "", /database is down/);
});

test("the queue drains and advances the clock only once the write verifies", async () => {
  const io = fakeLedger({ failTimes: 1 }); // one failure, then the DB returns
  let queue = enqueueLedger([], row("KX", 1000), 0);
  let recordedAt = 0;
  // attempt 1 — fails, stays queued, clock unmoved
  let out = await persistOnce(queue[0], io, 100);
  let res = afterPersist(queue, out);
  queue = res.queue;
  if (res.verified) recordedAt = 100;
  assert.equal(queue.length, 1);
  assert.equal(recordedAt, 0);
  // attempt 2 — verifies, clears the queue, advances the clock
  out = await persistOnce(queue[0], io, 200);
  res = afterPersist(queue, out);
  queue = res.queue;
  if (res.verified) recordedAt = 200;
  assert.equal(res.verified, true);
  assert.equal(queue.length, 0); // evidence recorded, window cleared
  assert.equal(recordedAt, 200); // clock advances only now
  assert.equal(io.rows.size, 1);
});

// --- enqueue: idempotent by window, bounded ---

test("the same window is enqueued once", () => {
  let q: LedgerJob[] = [];
  q = enqueueLedger(q, row("KX", 1000), 0);
  q = enqueueLedger(q, row("KX", 1000), 5); // same window again
  q = enqueueLedger(q, row("KX", 2000), 6);
  assert.equal(q.length, 2);
});

test("the queue is bounded at MAX_QUEUE", () => {
  let q: LedgerJob[] = [];
  for (let i = 0; i < MAX_QUEUE + 50; i += 1) q = enqueueLedger(q, row("KX", i), i);
  assert.equal(q.length, MAX_QUEUE);
  assert.equal(q[q.length - 1].row.close_time, MAX_QUEUE + 49); // newest kept
});

test("oldestQueueAgeMs measures the longest-unrecorded window", () => {
  const q: LedgerJob[] = [job(row("KX", 1), 1000), job(row("KX", 2), 5000)];
  assert.equal(oldestQueueAgeMs(q, 9000), 8000);
  assert.equal(oldestQueueAgeMs([], 9000), 0);
});

// --- durable outbox: a grade survives process death and drains on the next boot ---

test("a queued grade round-trips through the persisted outbox and still drains", async () => {
  // Grade enqueued, force-persisted to desk_state, THEN the process dies.
  const q = enqueueLedger([], row("KX", 1000), 111);
  const persisted = JSON.parse(JSON.stringify(q.slice(-120))); // what desk_state holds
  // ...restart: the in-memory queue is gone; rebuild it from desk_state.
  const restored = sanitizeQueue(persisted, 999);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].key, "KX:1000");
  assert.deepEqual(restored[0].row.values, ["KX", 1000]);
  // and it drains normally against a working DB — the evidence is recovered, not lost.
  const io = fakeLedger();
  const out = await persistOnce(restored[0], io, 1000);
  assert.equal(out.status, "verified");
  assert.equal(io.rows.size, 1);
});

test("a malformed persisted outbox is dropped, never crashes boot", () => {
  assert.deepEqual(sanitizeQueue(null, 0), []);
  assert.deepEqual(sanitizeQueue("nope", 0), []);
  assert.deepEqual(sanitizeQueue([{ row: { ticker: "KX" } }, 7, null], 0), []); // missing close_time/values
  const ok = sanitizeQueue([{ row: { ticker: "KX", close_time: 1, values: [] } }], 5);
  assert.equal(ok.length, 1);
  assert.equal(ok[0].firstAt, 5); // defaulted from `now`
});

// --- G5: overlapping pending windows never overwrite one another ---

type P = Keyed & { tag: string };
const pw = (closeTime: number, tag: string): P => ({ ticker: "KX", close_time: closeTime, tag });

test("two windows can be pending at once — neither drops the other", () => {
  let list: P[] = [];
  list = addKeyed(list, pw(1000, "A"), PENDING_CAP);
  list = addKeyed(list, pw(2000, "B"), PENDING_CAP); // B does NOT evict A
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((p) => p.tag), ["A", "B"]);
});

test("re-pending the same window replaces it in place (idempotent)", () => {
  let list: P[] = [addKeyed([], pw(1000, "A"), PENDING_CAP)[0]];
  list = addKeyed(list, pw(1000, "A2"), PENDING_CAP);
  assert.equal(list.length, 1);
  assert.equal(list[0].tag, "A2");
});

test("resolving one pending window keeps the rest — the G5 fix", () => {
  const list = [pw(1000, "A"), pw(2000, "B"), pw(3000, "C")];
  // only B's official result has arrived
  const { resolved, remaining } = partitionResolved(list, (p) => p.close_time === 2000);
  assert.deepEqual(resolved.map((p) => p.tag), ["B"]);
  assert.deepEqual(remaining.map((p) => p.tag), ["A", "C"]); // A and C are NOT dropped
});

test("resolved windows come back oldest-first, and removeKeyed drops just one", () => {
  const list = [pw(3000, "C"), pw(1000, "A"), pw(2000, "B")];
  const { resolved } = partitionResolved(list, () => true);
  assert.deepEqual(resolved.map((p) => p.close_time), [1000, 2000, 3000]); // chronological grading order
  assert.deepEqual(removeKeyed(list, "KX", 2000).map((p) => p.tag), ["C", "A"]);
});

test("the pending list is bounded — a long result outage drops the oldest, not the newest", () => {
  let list: P[] = [];
  for (let i = 0; i < PENDING_CAP + 5; i += 1) list = addKeyed(list, pw(i, `w${i}`), PENDING_CAP);
  assert.equal(list.length, PENDING_CAP);
  assert.equal(list[list.length - 1].tag, `w${PENDING_CAP + 4}`); // newest kept
});

// --- ledgerGaps: detect a lost window (e.g. crash between grade and persist) ---

test("an interior hole is a lost window", () => {
  const t = 1_700_000_000_000;
  const present = [t, t + WINDOW_MS, t + 3 * WINDOW_MS]; // the 3rd slot is missing
  assert.deepEqual(ledgerGaps(present), [t + 2 * WINDOW_MS]);
});

test("trailing absence (a pending window) is not a hole", () => {
  const t = 1_700_000_000_000;
  const present = [t, t + WINDOW_MS, t + 2 * WINDOW_MS]; // most recent slot simply not graded yet
  assert.deepEqual(ledgerGaps(present), []);
});

test("a contiguous run has no gaps, and a multi-slot hole names every window", () => {
  const t = 1_700_000_000_000;
  assert.deepEqual(ledgerGaps([t, t + WINDOW_MS, t + 2 * WINDOW_MS]), []);
  assert.deepEqual(ledgerGaps([t, t + 4 * WINDOW_MS]), [t + WINDOW_MS, t + 2 * WINDOW_MS, t + 3 * WINDOW_MS]);
});

test("small clock skew does not fabricate a gap", () => {
  const t = 1_700_000_000_000;
  assert.deepEqual(ledgerGaps([t, t + WINDOW_MS + 1500, t + 2 * WINDOW_MS - 900]), []);
});

// --- healthVerdict: fail only on genuine unhealth ---

const NOW = 1_700_000_000_000;
const healthy = {
  now: NOW,
  started: true,
  startedAt: NOW - 60 * 60_000,
  lastTickAt: NOW - 4_000,
  lastLedgerOkAt: NOW - 3 * 60_000,
  queueOldestAgeMs: 0,
  gaps: 0,
};

test("a quiet, all-WAIT desk that is ticking and recording is healthy", () => {
  // WAIT streaks, quiet markets and gagged seats are not even inputs here — they
  // cannot make the service look dead. Only tick/ledger liveness matters.
  assert.deepEqual(healthVerdict(healthy), { ok: true, reasons: [] });
});

test("a wedged tick loop is unhealthy", () => {
  const v = healthVerdict({ ...healthy, lastTickAt: NOW - TICK_STALL_MS - 1 });
  assert.equal(v.ok, false);
  assert.match(v.reasons.join(" "), /tick loop stalled/);
});

test("no window recorded far past the cadence is unhealthy", () => {
  const v = healthVerdict({ ...healthy, lastLedgerOkAt: NOW - LEDGER_STALL_MS - 1 });
  assert.equal(v.ok, false);
  assert.match(v.reasons.join(" "), /no window recorded/);
});

test("boot grace: a just-restarted process is not judged for a stale ledger clock yet", () => {
  const v = healthVerdict({ ...healthy, startedAt: NOW - BOOT_GRACE_MS + 10_000, lastLedgerOkAt: NOW - LEDGER_STALL_MS - 1 });
  assert.equal(v.ok, true); // no window could have closed yet — do not false-alarm on boot
});

test("a stuck ledger write is unhealthy even if a grade was calculated recently", () => {
  const v = healthVerdict({ ...healthy, queueOldestAgeMs: QUEUE_STUCK_MS + 1 });
  assert.equal(v.ok, false);
  assert.match(v.reasons.join(" "), /ledger write stuck/);
});

test("a detected ledger hole is unhealthy", () => {
  const v = healthVerdict({ ...healthy, gaps: 2 });
  assert.equal(v.ok, false);
  assert.match(v.reasons.join(" "), /2 ledger windows missing/);
});

test("a recent identity contradiction is unhealthy but forensic history ages out", () => {
  const recent = healthVerdict({ ...healthy, recentIdentityFaults: 2 });
  assert.equal(recent.ok, false);
  assert.match(recent.reasons.join(" "), /2 recent window identity faults/);

  assert.equal(
    recentIdentityFaultCount([NOW - IDENTITY_FAULT_RECENT_MS + 1, NOW - IDENTITY_FAULT_RECENT_MS - 1], NOW),
    1,
  );
  assert.equal(
    healthVerdict({ ...healthy, recentIdentityFaults: recentIdentityFaultCount([NOW - IDENTITY_FAULT_RECENT_MS - 1], NOW) }).ok,
    true,
    "old persisted faults remain forensic evidence without permanently failing health",
  );
});

test("before boot the service is not a failure", () => {
  assert.equal(healthVerdict({ ...healthy, started: false, lastTickAt: 0 }).ok, true);
});

// --- alert-channel health: surfaced separately, never a single point of failure ---

test("no push subscriber is reported as undeliverable, separately from data health", () => {
  const a = alertHealth({ ownerSubs: 0, lastSend: null });
  assert.equal(a.deliverable, false);
  assert.match(a.note, /no owner push subscription/);
  // Crucially, this does not enter healthVerdict at all — a dead alert channel
  // cannot make the data/engine status fail; the external /status monitor covers it.
  assert.equal(healthVerdict(healthy).ok, true);
});

test("a push-send failure is visible in the alert note without failing data health", () => {
  const a = alertHealth({ ownerSubs: 2, lastSend: "watchdog: 0 sent, 0 gone, 2 failed" });
  assert.equal(a.deliverable, true);
  assert.match(a.note, /2 failed/);
  assert.equal(healthVerdict(healthy).ok, true);
});

// --- error ring: keep scope + text, bounded ---

test("the error ring keeps recent failures with scope and text, bounded", () => {
  let ring = pushErr([], "ledger", "ECONNREFUSED KX:1000", NOW);
  ring = pushErr(ring, "feed", "kalshi DOWN", NOW + 1);
  assert.equal(ring.length, 2);
  assert.equal(ring[0].scope, "ledger");
  assert.match(ring[0].msg, /KX:1000/);
  for (let i = 0; i < 40; i += 1) ring = pushErr(ring, "x", `e${i}`, NOW + 2 + i, 25);
  assert.equal(ring.length, 25); // bounded
  assert.equal(ring[ring.length - 1].msg, "e39"); // newest kept
});
