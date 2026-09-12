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

const T = "KXBTC15M-26SEP111800-00";
const C = 1_700_000_900_000;

function row(lean: Lean, at: number, closeMs = C): DecisionSnapshotRow {
  // The writer reads only ticker, close_time_ms, decision_at_ms, chair_lean.
  return { ticker: T, close_time_ms: closeMs, decision_at_ms: at, chair_lean: lean } as DecisionSnapshotRow;
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
  const C2 = C + 900_000;
  await w.record(row("WAIT", 1_000, C));
  await w.record(row("UP", 1_100, C2));
  const c1 = store.rows.filter((r) => r.closeMs === C);
  const c2 = store.rows.filter((r) => r.closeMs === C2);
  assert.deepEqual(c1.map((r) => [r.kind, r.lean]), [["OPENING", "WAIT"]], "c1 has only its WAIT opening");
  assert.deepEqual(c2.map((r) => [r.kind, r.lean]), [["OPENING", "UP"]], "c2 has only its UP opening");
});
