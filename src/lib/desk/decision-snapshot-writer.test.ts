/**
 * S2-5 write orchestration: concurrency, failure visibility, and retry.
 *
 * createDecisionWriter is driven through an injected store, so these model the
 * exact hazards the review raised without a database: a later tick whose DB work
 * would finish first must not steal OPENING; a transient write failure must be
 * observable to the caller and leave a retry possible that re-writes the ORIGINAL
 * captured row.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createDecisionWriter, type DecisionStore, type PersistedWindow } from "./decision-snapshot-writer.ts";
import type { DecisionSnapshotRow } from "./decision-snapshot.ts";
import type { Lean } from "./types.ts";

// Ticker and close AGREE: KXBTC15M-26SEP111800-00 encodes 18:00 America/New_York =
// 22:00Z, so tickerAgrees(T, C) === true and the identity guard lets these through.
const T = "KXBTC15M-26SEP111800-00";
const C = Date.parse("2026-09-11T22:00:00Z");

function row(lean: Lean, at: number, closeMs = C, ticker = T): DecisionSnapshotRow {
  // The writer reads only ticker, close_time_ms, decision_at_ms, chair_lean.
  return { ticker, close_time_ms: closeMs, decision_at_ms: at, chair_lean: lean } as DecisionSnapshotRow;
}

function deferred(): { p: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const p = new Promise<void>((r) => (resolve = r));
  return { p, resolve };
}

type StoredRow = { ticker: string; closeMs: number; kind: string; lean: Lean; at: number };

/** A fake durable store with PK-dedup, a one-shot lookup gate, and a one-shot insert failure. */
function fakeStore() {
  const rows: StoredRow[] = [];
  const inserts: { kind: string; lean: Lean; at: number }[] = [];
  let lookupGate: Promise<void> | null = null;
  let failNextInsert = false;
  const store: DecisionStore & {
    rows: StoredRow[];
    inserts: typeof inserts;
    gateNextLookup(g: Promise<void>): void;
    failNextInsertOnce(): void;
  } = {
    rows,
    inserts,
    gateNextLookup(g) {
      lookupGate = g;
    },
    failNextInsertOnce() {
      failNextInsert = true;
    },
    async lookupWindow(ticker: string, closeMs: number): Promise<PersistedWindow> {
      if (lookupGate) {
        const g = lookupGate;
        lookupGate = null; // one-shot: only the first lookup blocks
        await g;
      }
      const w = rows.filter((r) => r.ticker === ticker && r.closeMs === closeMs);
      const op = w.find((r) => r.kind === "OPENING");
      return { openingExists: !!op, openingLean: op ? op.lean : null, firstDirectionalExists: w.some((r) => r.kind === "FIRST_DIRECTIONAL") };
    },
    async insertSnapshot(r: DecisionSnapshotRow, kind): Promise<void> {
      if (failNextInsert) {
        failNextInsert = false;
        throw new Error("transient DB failure");
      }
      inserts.push({ kind, lean: r.chair_lean, at: r.decision_at_ms });
      if (!rows.some((x) => x.ticker === r.ticker && x.closeMs === r.close_time_ms && x.kind === kind)) {
        rows.push({ ticker: r.ticker, closeMs: r.close_time_ms, kind, lean: r.chair_lean, at: r.decision_at_ms });
      }
    },
  };
  return store;
}

test("OPENING concurrency: a faster t2 cannot steal OPENING from a delayed t1 WAIT", async () => {
  const store = fakeStore();
  const w = createDecisionWriter(store);
  const gate = deferred();
  store.gateNextLookup(gate.p); // t1's first lookup blocks until released

  const p1 = w.record(row("WAIT", 1_000)); // t1: opening read, DB path delayed
  const p2 = w.record(row("UP", 2_000)); // t2: later directional, DB path would be faster
  gate.resolve();
  await Promise.all([p1, p2]);

  const opening = store.rows.filter((r) => r.kind === "OPENING");
  assert.equal(opening.length, 1, "exactly one OPENING");
  assert.equal(opening[0]!.lean, "WAIT", "OPENING remains t1 WAIT");
  assert.equal(opening[0]!.at, 1_000, "OPENING carries t1's values, not t2's");
  assert.ok(!store.inserts.some((i) => i.kind === "OPENING" && i.lean === "UP"), "t2 never inserted an OPENING");
  const fd = store.rows.filter((r) => r.kind === "FIRST_DIRECTIONAL");
  assert.equal(fd.length, 1, "once t1 OPENING is durable, t2 becomes FIRST_DIRECTIONAL");
  assert.equal(fd[0]!.lean, "UP");
  assert.equal(fd[0]!.at, 2_000);
});

test("OPENING concurrency: a directional t1 UP delayed, t2 DOWN faster → OPENING UP, no FIRST_DIRECTIONAL", async () => {
  const store = fakeStore();
  const w = createDecisionWriter(store);
  const gate = deferred();
  store.gateNextLookup(gate.p);

  const p1 = w.record(row("UP", 1_000));
  const p2 = w.record(row("DOWN", 2_000));
  gate.resolve();
  await Promise.all([p1, p2]);

  const opening = store.rows.filter((r) => r.kind === "OPENING");
  assert.equal(opening.length, 1);
  assert.equal(opening[0]!.lean, "UP", "directional OPENING is t1 UP");
  assert.equal(opening[0]!.at, 1_000);
  assert.equal(store.rows.filter((r) => r.kind === "FIRST_DIRECTIONAL").length, 0, "a directional OPENING spawns no FIRST_DIRECTIONAL");
});

test("a transient write failure is observable to the caller and marks nothing done", async () => {
  const store = fakeStore();
  const w = createDecisionWriter(store);
  store.failNextInsertOnce(); // the first OPENING insert throws

  await assert.rejects(w.record(row("WAIT", 1_000)), /transient DB failure/, "the promise rejects — the engine's catch can see it");
  assert.equal(store.rows.length, 0, "nothing was persisted");
});

test("after a transient OPENING failure, the retry re-writes the ORIGINAL t1 facts", async () => {
  const store = fakeStore();
  const w = createDecisionWriter(store);
  store.failNextInsertOnce();

  await assert.rejects(w.record(row("WAIT", 1_000)), /transient/); // t1 fails
  await w.record(row("UP", 2_000)); // t2 arrives; retry succeeds

  const opening = store.rows.filter((r) => r.kind === "OPENING");
  assert.equal(opening.length, 1, "one OPENING after retry");
  assert.equal(opening[0]!.lean, "WAIT", "OPENING still contains t1 WAIT, not t2 UP");
  assert.equal(opening[0]!.at, 1_000, "OPENING retains t1's decision time");
  const fd = store.rows.filter((r) => r.kind === "FIRST_DIRECTIONAL");
  assert.equal(fd.length, 1, "t2 becomes FIRST_DIRECTIONAL once the opening is durable");
  assert.equal(fd[0]!.lean, "UP");
});

test("FIRST_DIRECTIONAL is the first captured directional, preserved across a transient FD failure", async () => {
  const store = fakeStore();
  const w = createDecisionWriter(store);
  await w.record(row("WAIT", 1_000)); // OPENING WAIT durable
  store.failNextInsertOnce(); // the first FD insert (t2 UP) throws
  await assert.rejects(w.record(row("UP", 2_000)), /transient/);
  // a later DOWN flip must not become the first directional; the frozen UP retries
  await w.record(row("DOWN", 3_000));

  const fd = store.rows.filter((r) => r.kind === "FIRST_DIRECTIONAL");
  assert.equal(fd.length, 1, "one FIRST_DIRECTIONAL");
  assert.equal(fd[0]!.lean, "UP", "the first captured directional (UP) is preserved, not the later DOWN");
  assert.equal(fd[0]!.at, 2_000);
});

test("restart: reading a persisted OPENING WAIT back lets a later UP still record FIRST_DIRECTIONAL", async () => {
  const store = fakeStore();
  // Seed as if a prior process wrote OPENING WAIT, then 'restart' with a fresh writer.
  store.rows.push({ ticker: T, closeMs: C, kind: "OPENING", lean: "WAIT", at: 1_000 });
  const w = createDecisionWriter(store);
  await w.record(row("UP", 5_000));
  const fd = store.rows.filter((r) => r.kind === "FIRST_DIRECTIONAL");
  assert.equal(fd.length, 1, "FIRST_DIRECTIONAL recorded after restart");
  assert.equal(fd[0]!.lean, "UP");
  assert.equal(store.rows.filter((r) => r.kind === "OPENING").length, 1, "no duplicate OPENING after restart");
});

test("restart: a persisted directional OPENING produces no FIRST_DIRECTIONAL", async () => {
  const store = fakeStore();
  store.rows.push({ ticker: T, closeMs: C, kind: "OPENING", lean: "UP", at: 1_000 });
  const w = createDecisionWriter(store);
  await w.record(row("DOWN", 5_000));
  assert.equal(store.rows.filter((r) => r.kind === "FIRST_DIRECTIONAL").length, 0, "no FIRST_DIRECTIONAL after a directional opening");
});

test("a neighbouring window is never touched by another window's writes", async () => {
  const store = fakeStore();
  const w = createDecisionWriter(store);
  // Two real adjacent windows, each with its OWN agreeing ticker (18:00Z→22:00Z and
  // 18:15Z→22:15Z), so both pass the identity guard.
  const C2 = C + 900_000;
  const T2 = "KXBTC15M-26SEP111815-00";
  await w.record(row("WAIT", 1_000, C, T));
  await w.record(row("UP", 1_100, C2, T2));
  const c1 = store.rows.filter((r) => r.closeMs === C);
  const c2 = store.rows.filter((r) => r.closeMs === C2);
  assert.deepEqual(c1.map((r) => [r.kind, r.lean]), [["OPENING", "WAIT"]], "c1 has only its WAIT opening");
  assert.deepEqual(c2.map((r) => [r.kind, r.lean]), [["OPENING", "UP"]], "c2 has only its UP opening");
});

// --- S2-5 follow-up: window-identity guard at rollover ----------------------
// These exercise the pure writer's identity guard (tickerAgrees === false → skip).
// Tickers that AGREE with their close pass; a stale-ticker/new-close pair is refused
// without freezing OPENING; an unparseable ticker is NOT refused.

const STALE = "KXBTC15M-26SEP111800-00"; // encodes 22:00Z
const NEWCLOSE = C + 900_000; //           22:15Z — disagrees with STALE by 900s
const FRESH = "KXBTC15M-26SEP111815-00"; // encodes 22:15Z — agrees with NEWCLOSE

test("I1: a stale-ticker / new-close pair is refused — no OPENING, no FIRST_DIRECTIONAL", async () => {
  const store = fakeStore();
  const w = createDecisionWriter(store);
  await w.record(row("WAIT", 1_000, NEWCLOSE, STALE)); // tickerAgrees === false
  await w.record(row("UP", 2_000, NEWCLOSE, STALE)); // still contradictory
  assert.equal(store.rows.length, 0, "no row persists for a contradictory window");
  assert.equal(store.inserts.length, 0, "the contradictory pair never reaches an insert");
});

test("I2: an invalid rollover tick cannot reserve OPENING; the valid ticker records it", async () => {
  const store = fakeStore();
  const w = createDecisionWriter(store);
  await w.record(row("WAIT", 1_000, NEWCLOSE, STALE)); // invalid: old ticker + new close
  await w.record(row("WAIT", 2_000, NEWCLOSE, FRESH)); // valid: correct ticker + new close
  const openings = store.rows.filter((r) => r.kind === "OPENING");
  assert.equal(openings.length, 1, "exactly one OPENING for the real window");
  assert.equal(openings[0]!.ticker, FRESH, "OPENING is the valid-ticker tick, not the stale one");
  assert.equal(openings[0]!.at, 2_000, "the invalid t1 left no frozen OPENING to win");
});

test("I3: a correct exact pair still records normally", async () => {
  const store = fakeStore();
  const w = createDecisionWriter(store);
  await w.record(row("UP", 1_000, C, T)); // agrees
  const openings = store.rows.filter((r) => r.kind === "OPENING");
  assert.equal(openings.length, 1);
  assert.equal(openings[0]!.lean, "UP");
});

test("I4: an unparseable ticker is NOT refused (tickerAgrees === null)", async () => {
  const store = fakeStore();
  const w = createDecisionWriter(store);
  await w.record(row("WAIT", 1_000, C, "KXBTC15M-—")); // the live.ts dark-ticker fallback
  const openings = store.rows.filter((r) => r.kind === "OPENING");
  assert.equal(openings.length, 1, "an unreadable ticker must not be fatal to measurement");
  assert.equal(openings[0]!.lean, "WAIT");
});

test("I5: a valid OPENING WAIT still persists", async () => {
  const store = fakeStore();
  const w = createDecisionWriter(store);
  await w.record(row("WAIT", 1_000, C, T));
  assert.deepEqual(
    store.rows.map((r) => [r.kind, r.lean]),
    [["OPENING", "WAIT"]],
  );
});

test("I6: a valid OPENING WAIT then UP still yields FIRST_DIRECTIONAL", async () => {
  const store = fakeStore();
  const w = createDecisionWriter(store);
  await w.record(row("WAIT", 1_000, C, T));
  await w.record(row("UP", 2_000, C, T));
  assert.deepEqual(
    store.rows.map((r) => [r.kind, r.lean]),
    [["OPENING", "WAIT"], ["FIRST_DIRECTIONAL", "UP"]],
  );
});

test("I7: restart with a persisted valid OPENING WAIT still permits FIRST_DIRECTIONAL", async () => {
  const store = fakeStore();
  store.rows.push({ ticker: T, closeMs: C, kind: "OPENING", lean: "WAIT", at: 1_000 });
  const w = createDecisionWriter(store);
  await w.record(row("UP", 5_000, C, T));
  assert.equal(store.rows.filter((r) => r.kind === "FIRST_DIRECTIONAL").length, 1);
});

test("I8: the identity guard keys only on ticker/close, independent of chair_lean", async () => {
  // A contradictory pair is refused for every lean; a valid pair is accepted for every
  // lean. The guard never looks at the Chair's decision (I9/I10: Chair/booking untouched).
  for (const lean of ["WAIT", "UP", "DOWN"] as Lean[]) {
    const bad = fakeStore();
    await createDecisionWriter(bad).record(row(lean, 1_000, NEWCLOSE, STALE));
    assert.equal(bad.rows.length, 0, `contradictory pair refused for lean=${lean}`);
    const ok = fakeStore();
    await createDecisionWriter(ok).record(row(lean, 1_000, C, T));
    assert.equal(ok.rows.length, 1, `valid pair accepted for lean=${lean}`);
  }
});

test("production-shaped rollover: 03:30 valid, stale 03:45 refused, correct 03:45 valid → two rows", async () => {
  const store = fakeStore();
  const w = createDecisionWriter(store);
  const close330 = Date.parse("2026-09-12T03:30:00Z");
  const close345 = Date.parse("2026-09-12T03:45:00Z");
  const t2330 = "KXBTC15M-26SEP112330-30"; // encodes 03:30Z
  const t2345 = "KXBTC15M-26SEP112345-45"; // encodes 03:45Z
  // 03:29:20 — valid OPENING for the 03:30 window
  await w.record(row("WAIT", Date.parse("2026-09-12T03:29:20.267Z"), close330, t2330));
  // 03:30:04 — close advanced to 03:45 but ticker still 2330 → refused (the known bad row)
  await w.record(row("WAIT", Date.parse("2026-09-12T03:30:04.050Z"), close345, t2330));
  // 03:30:12 — correct 03:45 ticker → valid OPENING for the 03:45 window
  await w.record(row("WAIT", Date.parse("2026-09-12T03:30:12.005Z"), close345, t2345));

  const openings = store.rows.filter((r) => r.kind === "OPENING");
  assert.equal(openings.length, 2, "two OPENINGs, not three — the contradictory pair is dropped");
  const byClose = Object.fromEntries(openings.map((r) => [r.closeMs, r.ticker]));
  assert.equal(byClose[close330], t2330, "03:30 window → its own 2330 ticker");
  assert.equal(byClose[close345], t2345, "03:45 window → the correct 2345 ticker, never the stale 2330");
});
