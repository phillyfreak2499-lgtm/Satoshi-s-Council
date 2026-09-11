import assert from "node:assert/strict";
import test from "node:test";
import { addKeyed, jobKey, partitionResolved, PENDING_CAP, removeKeyed, sanitizePending } from "./reliability.ts";
import { isInconsistent, matchSettle, type SettleLike } from "./window-identity.ts";

/**
 * The two sequences that matter, driven end to end.
 *
 * The other suites test the invariant and the restore in isolation. These run the
 * engine's actual settle loop — the same functions, in the same order — over the
 * two histories that produced, or could still produce, wrong data:
 *
 *   1. 2026-09-10: the close advances while the ticker stays frozen, then the
 *      stale market's result arrives. Nothing may be graded or taught.
 *   2. A restart either side of a resolve. Exactly one grade, exactly one row.
 *
 * The loop below mirrors settleIfNeeded/resolvePending/applyGrade: leave pending
 * before grading, refuse a window already graded, and write the ledger row keyed
 * by window. It is a model, not the engine, so a rail asserts the engine keeps
 * the properties this file proves (see desk-safety-rails.test.mjs).
 */

const ms = (iso: string) => Date.parse(iso);

type Window = { ticker: string; close_time: number; conf: number };
type Pend = Window & { snap: Window; votes: { seat: string }[]; chair: { conf: number } };

const pend = (ticker: string, iso: string, conf = 74): Pend => ({
  ticker,
  close_time: ms(iso),
  conf,
  snap: { ticker, close_time: ms(iso), conf },
  votes: [{ seat: "DRIFT" }],
  chair: { conf },
});

/** Everything a grade touches, so a wrong grade is visible as a side effect. */
type Desk = {
  pending: Pend[];
  gradedKeys: string[];
  /** Durable, ON CONFLICT (ticker, close_time) DO NOTHING. */
  ledger: Map<string, { ticker: string; close_time: number; winner: string }>;
  /** Every learner mutation, in order. Must stay empty on a refused window. */
  taught: string[];
  faults: { ticker: string; close_time: number; fault: string }[];
};

const freshDesk = (): Desk => ({ pending: [], gradedKeys: [], ledger: new Map(), taught: [], faults: [] });

/** applyGrade: refuses a window already graded, then teaches and writes once. */
function applyGrade(d: Desk, w: Window, winner: "UP" | "DOWN") {
  const key = jobKey(w.ticker, w.close_time);
  if (d.gradedKeys.includes(key)) return; // the idempotence guard
  d.gradedKeys = [...d.gradedKeys, key];
  d.taught.push(key);
  if (!d.ledger.has(key)) d.ledger.set(key, { ticker: w.ticker, close_time: w.close_time, winner });
}

/** officialHit: the invariant, recording a contradiction rather than grading. */
function officialHit(d: Desk, settles: SettleLike[], ticker: string, close: number) {
  const v = matchSettle(settles, ticker, close);
  if (v.ok) return v.settle;
  if (isInconsistent(v.fault)) {
    const key = `${ticker}|${close}|${v.fault}`;
    if (!d.faults.some((f) => `${f.ticker}|${f.close_time}|${f.fault}` === key)) {
      d.faults.push({ ticker, close_time: close, fault: v.fault });
    }
  }
  return undefined;
}

/** resolvePending: oldest first, leaving pending before grading. */
function resolvePending(d: Desk, settles: SettleLike[]) {
  const { resolved, remaining } = partitionResolved(d.pending, (p) => Boolean(officialHit(d, settles, p.ticker, p.close_time)));
  if (!resolved.length) return;
  d.pending = remaining;
  for (const p of resolved) {
    const hit = officialHit(d, settles, p.ticker, p.close_time);
    if (hit) applyGrade(d, p.snap, hit.lean);
  }
}

/** settleIfNeeded's close path: grade now, or hold the window pending. */
function closeWindow(d: Desk, w: Pend, settles: SettleLike[]) {
  resolvePending(d, settles);
  const hit = officialHit(d, settles, w.ticker, w.close_time);
  if (hit) {
    d.pending = removeKeyed(d.pending, w.ticker, w.close_time); // before grading, never after
    applyGrade(d, w.snap, hit.lean);
    return;
  }
  d.pending = addKeyed(d.pending, w, PENDING_CAP);
}

/** Persist → die → boot. Only JSON crosses, and only what persistState writes. */
function restart(d: Desk): Desk {
  const blob = JSON.parse(JSON.stringify({ pending: d.pending, graded_keys: d.gradedKeys }));
  return {
    pending: sanitizePending<Pend>(blob.pending),
    gradedKeys: blob.graded_keys,
    ledger: d.ledger, // the database outlives the process
    taught: [...d.taught],
    faults: [...d.faults],
  };
}

// ---------------------------------------------------------------------------
// GATE 1 — the exact 2026-09-10 sequence.
// ---------------------------------------------------------------------------

test("GATE: close advances, ticker stays frozen, stale result arrives — nothing grades", () => {
  const STALE = "KXBTC15M-26SEP100300-00"; // the 07:00Z market
  const staleResult: SettleLike[] = [{ ticker: STALE, close_time: ms("2026-09-10T07:00:00Z"), lean: "UP" }];
  const d = freshDesk();

  // The legitimate window closes and grades on its own result.
  closeWindow(d, pend(STALE, "2026-09-10T07:00:00Z"), staleResult);
  assert.equal(d.ledger.size, 1);
  assert.deepEqual(d.taught, [jobKey(STALE, ms("2026-09-10T07:00:00Z"))]);

  // Now the feed freezes: eight more windows close, each carrying the SAME
  // ticker, while the bundle keeps re-offering the 07:00 market's result.
  const later = [
    "2026-09-10T07:15:00Z", "2026-09-10T07:30:00Z", "2026-09-10T07:45:00Z", "2026-09-10T08:00:00Z",
    "2026-09-10T08:15:00Z", "2026-09-10T08:30:00Z", "2026-09-10T08:45:00Z", "2026-09-10T09:00:00Z",
  ];
  for (const iso of later) closeWindow(d, pend(STALE, iso, 82), staleResult);

  // No grade. No ledger row for any false close. No learner mutation.
  assert.equal(d.ledger.size, 1, "only the 07:00 window may be in the ledger");
  assert.equal(d.taught.length, 1, "the learner must not be touched by the eight");
  for (const iso of later) {
    assert.equal(d.ledger.has(jobKey(STALE, ms(iso))), false, `no ledger row for the false close ${iso}`);
  }

  // A fault is recorded for each, and each window is still recoverable.
  assert.equal(d.faults.length, 8, "every refusal is recorded, not swallowed");
  for (const f of d.faults) assert.equal(f.fault, "ticker-close-time-mismatch");
  assert.equal(d.pending.length, 8, "the windows stay pending for investigation");

  // And the state survives a restart, so the forensics are not lost with the process.
  const booted = restart(d);
  assert.equal(booted.pending.length, 8);
  assert.equal(booted.taught.length, 1);
});

test("GATE: once the feed recovers, the new window grades and the frozen ones still do not", () => {
  const STALE = "KXBTC15M-26SEP100300-00";
  const GOOD = "KXBTC15M-26SEP110800-00";
  const d = freshDesk();
  closeWindow(d, pend(STALE, "2026-09-10T08:45:00Z"), [
    { ticker: STALE, close_time: ms("2026-09-10T07:00:00Z"), lean: "UP" },
  ]);
  assert.equal(d.taught.length, 0);

  // The feed recovers; a correct window closes with its own correct result.
  closeWindow(d, pend(GOOD, "2026-09-11T12:00:00Z"), [
    { ticker: STALE, close_time: ms("2026-09-10T07:00:00Z"), lean: "UP" },
    { ticker: GOOD, close_time: ms("2026-09-11T12:00:00Z"), lean: "DOWN" },
  ]);
  assert.deepEqual(d.taught, [jobKey(GOOD, ms("2026-09-11T12:00:00Z"))]);
  assert.equal(d.ledger.get(jobKey(GOOD, ms("2026-09-11T12:00:00Z")))!.winner, "DOWN");
  // The frozen window is still held, still ungraded.
  assert.equal(d.pending.some((p) => p.close_time === ms("2026-09-10T08:45:00Z")), true);
});

// ---------------------------------------------------------------------------
// GATE 2 — restart, resolve, restart. Exactly one grade, exactly one row.
// ---------------------------------------------------------------------------

test("GATE: restart → resolve → restart grades exactly once and writes exactly one row", () => {
  const TK = "KXBTC15M-26SEP110800-00";
  const CLOSE = "2026-09-11T12:00:00Z";
  const key = jobKey(TK, ms(CLOSE));
  const result: SettleLike[] = [{ ticker: TK, close_time: ms(CLOSE), lean: "UP" }];

  // The window closes with no result yet, and is held.
  let d = freshDesk();
  closeWindow(d, pend(TK, CLOSE), []);
  assert.equal(d.pending.length, 1);
  assert.equal(d.taught.length, 0);

  // Restart #1: the pending window comes back with its original decision.
  d = restart(d);
  assert.equal(d.pending.length, 1);
  assert.equal(d.pending[0]!.chair.conf, 74, "the decision, not a re-derivation");

  // The result lands and the window grades.
  resolvePending(d, result);
  assert.deepEqual(d.taught, [key]);
  assert.equal(d.ledger.size, 1);
  assert.equal(d.pending.length, 0);

  // Restart #2, from the state the resolve left behind.
  d = restart(d);
  resolvePending(d, result);
  assert.deepEqual(d.taught, [key], "one grade, total");
  assert.equal(d.ledger.size, 1, "one ledger row, total");
});

test("GATE: the crash that used to double-teach — graded, persisted, rebooted still pending", () => {
  // The hazard persisting `pending` introduced. applyGrade force-persists at its
  // end; if the window were removed from pending AFTER that, the persisted state
  // would hold an already-graded window and the next boot would teach it twice.
  // Reproduced here by restoring a state that still lists a graded window.
  const TK = "KXBTC15M-26SEP110800-00";
  const CLOSE = "2026-09-11T12:00:00Z";
  const key = jobKey(TK, ms(CLOSE));
  const result: SettleLike[] = [{ ticker: TK, close_time: ms(CLOSE), lean: "UP" }];

  const d = freshDesk();
  closeWindow(d, pend(TK, CLOSE), result); // grades immediately
  assert.deepEqual(d.taught, [key]);

  // A persist that lost the removal: the window is back in pending, already graded.
  const wedged: Desk = { ...d, pending: [pend(TK, CLOSE)], taught: [...d.taught] };
  const booted = restart(wedged);
  assert.equal(booted.pending.length, 1, "the bad state is restorable, by construction");

  resolvePending(booted, result);
  assert.deepEqual(booted.taught, [key], "the graded set refuses the second teach");
  assert.equal(booted.ledger.size, 1);
});

test("GATE: two different windows both resolving still grade once each", () => {
  // The idempotence guard must not be so eager that it swallows a real window.
  const a = pend("KXBTC15M-26SEP110745-45", "2026-09-11T11:45:00Z");
  const b = pend("KXBTC15M-26SEP110800-00", "2026-09-11T12:00:00Z");
  const d = freshDesk();
  d.pending = [b, a]; // deliberately out of order
  resolvePending(d, [
    { ticker: a.ticker, close_time: a.close_time, lean: "UP" },
    { ticker: b.ticker, close_time: b.close_time, lean: "DOWN" },
  ]);
  assert.deepEqual(d.taught, [jobKey(a.ticker, a.close_time), jobKey(b.ticker, b.close_time)], "oldest first");
  assert.equal(d.ledger.size, 2);
  assert.equal(d.pending.length, 0);
});

test("GATE: a delayed result arriving twice grades once", () => {
  const TK = "KXBTC15M-26SEP110800-00";
  const CLOSE = "2026-09-11T12:00:00Z";
  const result: SettleLike[] = [{ ticker: TK, close_time: ms(CLOSE), lean: "UP" }];
  const d = freshDesk();
  closeWindow(d, pend(TK, CLOSE), []);
  // The bundle keeps carrying the settle on every subsequent tick.
  for (let i = 0; i < 5; i++) resolvePending(d, result);
  assert.equal(d.taught.length, 1, "a settle repeated on every tick must not re-teach");
  assert.equal(d.ledger.size, 1);
});

// ---------------------------------------------------------------------------
// GATE 2b — the crash boundary, explicitly.
//
// The sequence has to be: claim the window (leave pending, record the key) →
// make that fact DURABLE → mutate the learner. If the claim became durable only
// after the learner mutation, a crash in between would leave a learner that had
// already been taught and a window that still looked ungraded.
//
// The real engine satisfies this a slightly different way, and these tests pin
// the property rather than the mechanism: applyGrade claims the key IN MEMORY
// before touching the learner, and persistState writes the learner, the graded
// set and pending as ONE JSONB upsert — a single statement, so atomic. Therefore
// no persist can carry the learner mutation without also carrying the claim, and
// a crash before that persist discards both. Re-grading on reboot is then
// correct, not a double.
//
// Modelled below with an explicit durable snapshot so "died before the persist"
// is a real state and not an assumption. The learner is a per-window counter
// carried IN the snapshot, so only a mutation that became durable counts.
// ---------------------------------------------------------------------------

/** What persistState writes: one blob, written atomically or not at all. */
type Blob = { pending: Pend[]; gradedKeys: string[]; taught: Record<string, number> };

type Live = { blob: Blob; ledger: Map<string, { winner: string }> };

const snapshot = (l: Live): Blob => JSON.parse(JSON.stringify(l.blob));

/** Boot from the last durable blob. Anything not in it died with the process. */
const bootFrom = (blob: Blob, ledger: Map<string, { winner: string }>): Live => ({
  blob: { pending: sanitizePending<Pend>(JSON.parse(JSON.stringify(blob.pending))), gradedKeys: [...blob.gradedKeys], taught: { ...blob.taught } },
  ledger,
});

/** applyGrade: claim in memory, then mutate. The caller decides whether to persist. */
function gradeLive(l: Live, w: Window, winner: "UP" | "DOWN") {
  const key = jobKey(w.ticker, w.close_time);
  if (l.blob.gradedKeys.includes(key)) return;
  l.blob.gradedKeys = [...l.blob.gradedKeys, key]; // the claim, before any mutation
  l.blob.taught[key] = (l.blob.taught[key] ?? 0) + 1; // the learner mutation
  if (!l.ledger.has(key)) l.ledger.set(key, { winner });
}

function resolveLive(l: Live, settles: SettleLike[]) {
  const { resolved, remaining } = partitionResolved(l.blob.pending, (p) => matchSettle(settles, p.ticker, p.close_time).ok);
  if (!resolved.length) return;
  l.blob.pending = remaining; // leave pending before grading
  for (const p of resolved) {
    const v = matchSettle(settles, p.ticker, p.close_time);
    if (v.ok) gradeLive(l, p.snap, v.settle.lean);
  }
}

test("GATE: dying AFTER the learner mutation but BEFORE the persist teaches exactly once", () => {
  const TK = "KXBTC15M-26SEP110800-00";
  const CLOSE = "2026-09-11T12:00:00Z";
  const key = jobKey(TK, ms(CLOSE));
  const result: SettleLike[] = [{ ticker: TK, close_time: ms(CLOSE), lean: "UP" }];
  const ledger = new Map<string, { winner: string }>();

  // Durable state before the result lands: one window waiting, nothing taught.
  let durable: Blob = { pending: [pend(TK, CLOSE)], gradedKeys: [], taught: {} };

  // Life 1. The result arrives, the window grades — and the process dies before
  // the end-of-grade persist. No snapshot is taken.
  const life1 = bootFrom(durable, ledger);
  resolveLive(life1, result);
  assert.equal(life1.blob.taught[key], 1, "in memory the learner was advanced");
  assert.equal(life1.blob.pending.length, 0, "and pending was left");
  // ...crash. `durable` is untouched, so BOTH the mutation and the claim are gone.
  assert.equal(durable.taught[key], undefined, "the learner mutation never became durable");
  assert.equal(durable.gradedKeys.includes(key), false, "nor did the claim");
  assert.equal(durable.pending.length, 1, "so the window is still owed a grade");

  // Life 2. Boots from the pre-grade blob, re-grades, and this time persists.
  const life2 = bootFrom(durable, ledger);
  resolveLive(life2, result);
  durable = snapshot(life2);
  assert.equal(durable.taught[key], 1, "taught exactly once, durably");

  // Life 3. Boots from the persisted blob. The claim is durable, so no re-teach.
  const life3 = bootFrom(durable, ledger);
  resolveLive(life3, result);
  assert.equal(life3.blob.taught[key], 1, "the durable claim refuses a second teach");
  assert.equal(ledger.size, 1, "one ledger row across all three lives");
});

test("GATE: the claim cannot be durable without the mutation, or vice versa", () => {
  // The invariant the atomic blob buys: any snapshot that shows the learner
  // advanced also shows the window claimed and no longer pending. A snapshot
  // taken at ANY point after the grade must satisfy all three together.
  const TK = "KXBTC15M-26SEP110800-00";
  const CLOSE = "2026-09-11T12:00:00Z";
  const key = jobKey(TK, ms(CLOSE));
  const result: SettleLike[] = [{ ticker: TK, close_time: ms(CLOSE), lean: "UP" }];

  const live = bootFrom({ pending: [pend(TK, CLOSE)], gradedKeys: [], taught: {} }, new Map());
  resolveLive(live, result);
  const b = snapshot(live);
  const taught = (b.taught[key] ?? 0) > 0;
  const claimed = b.gradedKeys.includes(key);
  const stillPending = b.pending.some((p) => jobKey(p.ticker, p.close_time) === key);
  assert.equal(taught, true);
  assert.equal(claimed, true, "a taught window must be claimed in the same blob");
  assert.equal(stillPending, false, "and must not still be pending in the same blob");
});

test("GATE: a crash between two windows does not lose the one already taught", () => {
  // Two windows resolve on one tick; the process dies after the second. The blob
  // is written once, so either both grades are durable or neither is — and
  // neither case can teach a window twice.
  const a = pend("KXBTC15M-26SEP110745-45", "2026-09-11T11:45:00Z");
  const b = pend("KXBTC15M-26SEP110800-00", "2026-09-11T12:00:00Z");
  const settles: SettleLike[] = [
    { ticker: a.ticker, close_time: a.close_time, lean: "UP" },
    { ticker: b.ticker, close_time: b.close_time, lean: "DOWN" },
  ];
  const ledger = new Map<string, { winner: string }>();
  let durable: Blob = { pending: [a, b], gradedKeys: [], taught: {} };

  // Life 1: both grade, then the process dies with no persist.
  const life1 = bootFrom(durable, ledger);
  resolveLive(life1, settles);
  assert.equal(Object.keys(life1.blob.taught).length, 2);

  // Life 2: neither was durable, so both are re-graded — once each.
  const life2 = bootFrom(durable, ledger);
  resolveLive(life2, settles);
  durable = snapshot(life2);
  assert.deepEqual(Object.values(durable.taught), [1, 1], "each window taught exactly once");

  // Life 3: nothing left to do.
  const life3 = bootFrom(durable, ledger);
  resolveLive(life3, settles);
  assert.deepEqual(Object.values(life3.blob.taught), [1, 1]);
  assert.equal(ledger.size, 2);
});
