import assert from "node:assert/strict";
import test from "node:test";
import {
  addKeyed,
  jobKey,
  partitionResolved,
  PENDING_CAP,
  removeKeyed,
  sanitizePending,
} from "./reliability.ts";
import { matchSettle, type SettleLike } from "./window-identity.ts";

/**
 * The pre-settlement half of the grading race.
 *
 * A window closes, the desk decides, Kalshi's official result arrives later.
 * Everything here is about that gap surviving a process death: the decision must
 * come back as it was, grade once, and grade in the right order.
 */

const ms = (iso: string) => Date.parse(iso);

/** A pending entry shaped like the engine's, small enough to read. */
type Pend = {
  ticker: string;
  close_time: number;
  snap: { ticker: string; close_time: number; conf: number };
  votes: { seat: string; lean: string }[];
  chair: { lean: string; conf: number };
};

const pend = (ticker: string, iso: string, conf = 71): Pend => ({
  ticker,
  close_time: ms(iso),
  snap: { ticker, close_time: ms(iso), conf },
  votes: [{ seat: "DRIFT", lean: "UP" }],
  chair: { lean: "UP", conf },
});

/** Persist → die → boot. The only thing that crosses is JSON. */
const restart = (list: Pend[]) => sanitizePending<Pend>(JSON.parse(JSON.stringify(list)));

// ---------------------------------------------------------------------------
// Restart
// ---------------------------------------------------------------------------

test("a pending window survives a restart with its decision intact", () => {
  const before = [pend("KXBTC15M-26SEP110800-00", "2026-09-11T12:00:00Z", 83)];
  const after = restart(before);
  assert.equal(after.length, 1);
  // The ORIGINAL decision, not a re-derivation. Grading after a restart must
  // reproduce what the desk actually voted, never what today's learner would.
  assert.deepEqual(after[0], before[0]);
  assert.equal(after[0]!.chair.conf, 83);
  assert.equal(after[0]!.snap.conf, 83);
});

test("an empty or absent pending list restores as empty, never as undefined", () => {
  assert.deepEqual(sanitizePending(undefined), []);
  assert.deepEqual(sanitizePending(null), []);
  assert.deepEqual(sanitizePending([]), []);
  assert.deepEqual(sanitizePending("nonsense"), []);
  assert.deepEqual(sanitizePending({ ticker: "x" }), []);
});

test("a half-written entry is dropped, not repaired", () => {
  // A snapshot that did not survive is not a decision. Inventing one would put
  // votes in the ledger that no seat ever cast.
  const raw = [
    pend("GOOD-26SEP110800-00", "2026-09-11T12:00:00Z"),
    { ticker: "NO-SNAP", close_time: ms("2026-09-11T12:00:00Z"), votes: [], chair: {} },
    { ticker: "NO-VOTES", close_time: ms("2026-09-11T12:00:00Z"), snap: {}, chair: {} },
    { ticker: "NO-CHAIR", close_time: ms("2026-09-11T12:00:00Z"), snap: {}, votes: [] },
    { ticker: "", close_time: ms("2026-09-11T12:00:00Z"), snap: {}, votes: [], chair: {} },
    { ticker: "NO-CLOSE", close_time: 0, snap: {}, votes: [], chair: {} },
  ];
  const out = sanitizePending<Pend>(raw);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.ticker, "GOOD-26SEP110800-00");
});

test("restore is bounded", () => {
  const many = Array.from({ length: PENDING_CAP + 25 }, (_, i) =>
    pend(`T-${i}`, new Date(ms("2026-09-11T00:00:00Z") + i * 900_000).toISOString()),
  );
  const out = sanitizePending<Pend>(many);
  assert.equal(out.length, PENDING_CAP);
  // Keeps the NEWEST, because an ancient unsettled window is the one least
  // likely to ever resolve.
  assert.equal(out[out.length - 1]!.ticker, `T-${many.length - 1}`);
});

// ---------------------------------------------------------------------------
// No duplicate grading
// ---------------------------------------------------------------------------

test("the same window restored twice grades once", () => {
  const w = pend("KXBTC15M-26SEP110800-00", "2026-09-11T12:00:00Z");
  const out = sanitizePending<Pend>([w, { ...w }, JSON.parse(JSON.stringify(w))]);
  assert.equal(out.length, 1, "one entry per window, or the learner is taught twice from one result");
});

test("re-adding a window in flight replaces rather than stacks", () => {
  const a = pend("KXBTC15M-26SEP110800-00", "2026-09-11T12:00:00Z", 70);
  const b = pend("KXBTC15M-26SEP110800-00", "2026-09-11T12:00:00Z", 88);
  const list = addKeyed(addKeyed([], a, PENDING_CAP), b, PENDING_CAP);
  assert.equal(list.length, 1);
  assert.equal(list[0]!.chair.conf, 88);
});

test("a graded window is removed, and removing it twice is harmless", () => {
  const tk = "KXBTC15M-26SEP110800-00";
  const close = ms("2026-09-11T12:00:00Z");
  let list = addKeyed([], pend(tk, "2026-09-11T12:00:00Z"), PENDING_CAP);
  list = removeKeyed(list, tk, close);
  assert.equal(list.length, 0);
  assert.equal(removeKeyed(list, tk, close).length, 0, "idempotent retry must not throw or resurrect");
});

test("one window resolving never drops the others", () => {
  const early = pend("KXBTC15M-26SEP110745-45", "2026-09-11T11:45:00Z");
  const late = pend("KXBTC15M-26SEP110800-00", "2026-09-11T12:00:00Z");
  const { resolved, remaining } = partitionResolved([early, late], (p) => p.ticker === late.ticker);
  assert.deepEqual(
    resolved.map((r) => r.ticker),
    [late.ticker],
  );
  assert.deepEqual(
    remaining.map((r) => r.ticker),
    [early.ticker],
  );
});

test("oldest-first resolution survives the restart", () => {
  const order = ["2026-09-11T12:00:00Z", "2026-09-11T11:15:00Z", "2026-09-11T11:45:00Z", "2026-09-11T11:30:00Z"];
  const stored = order.map((iso, i) => pend(`T-${i}`, iso));
  const restored = restart(stored);
  const { resolved } = partitionResolved(restored, () => true);
  assert.deepEqual(
    resolved.map((r) => new Date(r.close_time).toISOString()),
    ["2026-09-11T11:15:00.000Z", "2026-09-11T11:30:00.000Z", "2026-09-11T11:45:00.000Z", "2026-09-11T12:00:00.000Z"],
  );
});

// ---------------------------------------------------------------------------
// Delayed settlement, stale feed, ticker mismatch — end to end over the gap
// ---------------------------------------------------------------------------

const settleOf = (p: Pend, lean: "UP" | "DOWN" = "UP"): SettleLike => ({
  ticker: p.ticker,
  close_time: p.close_time,
  lean,
});

test("delayed settlement: pending across a restart, then grades when the result lands", () => {
  const w = pend("KXBTC15M-26SEP110800-00", "2026-09-11T12:00:00Z");

  // Window closed, no result yet.
  assert.equal(matchSettle([], w.ticker, w.close_time).ok, false);

  // Process dies and boots.
  const restored = restart([w])[0]!;

  // Result finally arrives on a later tick.
  const v = matchSettle([settleOf(restored, "DOWN")], restored.ticker, restored.close_time);
  assert.equal(v.ok, true);
  assert.equal(v.ok === true && v.settle.lean, "DOWN");
});

test("a stale feed carrying an old window's settle cannot grade the restored one", () => {
  // The 2026-09-10 shape, now across a restart: the bundle still carries the
  // earlier market's result while the desk is waiting on a later window.
  const stale = "KXBTC15M-26SEP100300-00";
  const waiting = pend(stale, "2026-09-10T08:45:00Z");
  const restored = restart([waiting])[0]!;
  const v = matchSettle(
    [{ ticker: stale, close_time: ms("2026-09-10T07:00:00Z"), lean: "UP" }],
    restored.ticker,
    restored.close_time,
  );
  assert.equal(v.ok, false, "a restored window is still protected by the identity invariant");
  assert.equal(v.ok === false && v.fault, "ticker-close-time-mismatch");
});

test("window rollover: the closing window stays pending while the next one runs", () => {
  const closing = pend("KXBTC15M-26SEP110745-45", "2026-09-11T11:45:00Z");
  const next = pend("KXBTC15M-26SEP110800-00", "2026-09-11T12:00:00Z");
  let list = addKeyed([], closing, PENDING_CAP);
  // The roll does not touch the pending list; only a settle does.
  assert.equal(list.length, 1);
  list = addKeyed(list, next, PENDING_CAP);
  assert.equal(list.length, 2);
  assert.notEqual(jobKey(closing.ticker, closing.close_time), jobKey(next.ticker, next.close_time));
});
