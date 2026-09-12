/**
 * S2-5 decision-snapshot semantics, behaviorally.
 *
 * Two pure surfaces are under test here: the event rule (which of the two bounded
 * rows a tick should write) and the row builder (that a row carries THIS tick's
 * facts, never a later fill/grade/quote). The database side -- idempotence,
 * exact-window identity, restart read-back -- is proven against PGlite in
 * scripts/migrations-apply.test.mjs; the two together cover M1-M11.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDecisionSnapshotRow,
  decisionSnapshotEvents,
  type SnapshotKind,
} from "./decision-snapshot.ts";
import type { ChairResult, Lean, Snapshot } from "./types";

/**
 * A faithful in-process model of the writer's state machine: apply the event rule
 * tick by tick and update the known window state exactly as the writer does after
 * a successful insert (OPENING sets openingExists + openingLean; FIRST_DIRECTIONAL
 * sets its flag). `seed` injects persisted state, which is how a RESTART is modeled
 * -- a fresh process reads the window back from the table before its first tick.
 */
function drive(
  leans: Lean[],
  seed?: { openingLean: Lean | null; openingExists: boolean; firstDirectionalExists: boolean },
): { kind: SnapshotKind; lean: Lean; tick: number }[] {
  let openingExists = seed?.openingExists ?? false;
  let openingLean: Lean | null = seed?.openingLean ?? null;
  let firstDirectionalExists = seed?.firstDirectionalExists ?? false;
  const out: { kind: SnapshotKind; lean: Lean; tick: number }[] = [];
  leans.forEach((currentLean, i) => {
    const plan = decisionSnapshotEvents({ openingExists, openingLean, firstDirectionalExists, currentLean });
    if (plan.insertOpening) {
      out.push({ kind: "OPENING", lean: currentLean, tick: i });
      openingExists = true;
      openingLean = currentLean;
    }
    if (plan.insertFirstDirectional) {
      out.push({ kind: "FIRST_DIRECTIONAL", lean: currentLean, tick: i });
      firstDirectionalExists = true;
    }
  });
  return out;
}

// --- M1 / M2 / M3 / M4 / M5: the event sequence ----------------------------

test("M1: the first finalized tick is the one OPENING row", () => {
  const rows = drive(["UP", "UP", "UP"]);
  assert.deepEqual(rows, [{ kind: "OPENING", lean: "UP", tick: 0 }]);
});

test("M2: a WAIT opening is a valid OPENING, not discarded for being unfillable", () => {
  const rows = drive(["WAIT"]);
  assert.deepEqual(rows, [{ kind: "OPENING", lean: "WAIT", tick: 0 }]);
});

test("M3: FIRST_DIRECTIONAL is the first UP/DOWN after an opening WAIT, once", () => {
  const rows = drive(["WAIT", "WAIT", "UP", "DOWN"]);
  assert.deepEqual(rows, [
    { kind: "OPENING", lean: "WAIT", tick: 0 },
    { kind: "FIRST_DIRECTIONAL", lean: "UP", tick: 2 },
  ]);
});

test("M4: a directional OPENING never spawns a duplicate FIRST_DIRECTIONAL", () => {
  assert.deepEqual(drive(["UP", "UP", "DOWN"]), [{ kind: "OPENING", lean: "UP", tick: 0 }]);
  assert.deepEqual(drive(["DOWN", "WAIT", "UP"]), [{ kind: "OPENING", lean: "DOWN", tick: 0 }]);
});

test("M5: WAIT forever stores OPENING only, no synthetic directional row", () => {
  assert.deepEqual(drive(["WAIT", "WAIT", "WAIT", "WAIT"]), [{ kind: "OPENING", lean: "WAIT", tick: 0 }]);
});

test("a later UP->DOWN flip after FIRST_DIRECTIONAL is out of scope: no third row", () => {
  const rows = drive(["WAIT", "UP", "DOWN", "UP", "WAIT", "DOWN"]);
  assert.deepEqual(rows, [
    { kind: "OPENING", lean: "WAIT", tick: 0 },
    { kind: "FIRST_DIRECTIONAL", lean: "UP", tick: 1 },
  ]);
});

// --- M10 / M11: restart semantics, at the rule level ------------------------

test("M10: after a restart that persisted OPENING WAIT, a later UP still records FIRST_DIRECTIONAL", () => {
  // process B starts with only the table's knowledge: OPENING exists, it was WAIT.
  const rows = drive(["UP", "DOWN"], { openingExists: true, openingLean: "WAIT", firstDirectionalExists: false });
  assert.deepEqual(rows, [{ kind: "FIRST_DIRECTIONAL", lean: "UP", tick: 0 }]);
});

test("M11: after a restart that persisted a directional OPENING, no FIRST_DIRECTIONAL duplicate", () => {
  const rows = drive(["UP", "DOWN", "UP"], { openingExists: true, openingLean: "UP", firstDirectionalExists: false });
  assert.deepEqual(rows, []);
});

test("a restart after OPENING WAIT + FIRST_DIRECTIONAL already written writes nothing more", () => {
  const rows = drive(["DOWN", "UP"], { openingExists: true, openingLean: "WAIT", firstDirectionalExists: true });
  assert.deepEqual(rows, []);
});

// --- the rule, exhaustively -------------------------------------------------

test("the event rule never emits both flags on one tick", () => {
  const leans: Lean[] = ["UP", "DOWN", "WAIT"];
  for (const openingExists of [false, true]) {
    for (const openingLean of [null, "UP", "DOWN", "WAIT"] as (Lean | null)[]) {
      for (const firstDirectionalExists of [false, true]) {
        for (const currentLean of leans) {
          const p = decisionSnapshotEvents({ openingExists, openingLean, firstDirectionalExists, currentLean });
          assert.ok(!(p.insertOpening && p.insertFirstDirectional), "never both in one tick");
          // OPENING is attempted iff none exists yet.
          assert.equal(p.insertOpening, !openingExists);
          // FIRST_DIRECTIONAL only when opening stands, was WAIT, none yet, and this is directional.
          if (openingExists) {
            assert.equal(
              p.insertFirstDirectional,
              openingLean === "WAIT" && !firstDirectionalExists && (currentLean === "UP" || currentLean === "DOWN"),
            );
          }
        }
      }
    }
  }
});

// --- M1 / M6 / M7: the builder captures THIS tick's facts -------------------

function snap(over: Partial<Snapshot>): Snapshot {
  return {
    as_of: 1_700_000_000_000,
    ticker: "KXBTC15M-26SEP111800-00",
    close_time: 1_700_000_900_000,
    secs_left: 300,
    quote_age_s: 1.2,
    quote_seq: 42,
    print_age_s: 3.4,
    quote_ts: 1_699_999_999_000,
    spot: 64000,
    spot_source: "brti",
    strike: 63950,
    yes_bid: 60,
    yes_ask: 62,
    no_bid: 37,
    no_ask: 40,
    yes_bid_size: 120,
    no_bid_size: 90,
    kalshi_taker_yes: 0.55,
    kalshi_trade_n: 12,
    fair_yes: 61.5,
    lab_fair_yes: 60.8,
    yes_mid: 61,
    spread_cents: 2,
    combined_ask_cents: 102,
    leftover_cents: 2,
    edge_up: 0.5,
    edge_down: -0.5,
    fee_yes: 1,
    fee_no: 1,
    regime_key: "QUIET",
    clock_key: "MID",
    atr: 50,
    imbalance: 0.1,
    range_pos: 0.4,
    ...over,
  } as Snapshot;
}

function chair(over: Partial<ChairResult>): ChairResult {
  return {
    lean: "UP",
    confidence: 78,
    score: 0.62,
    bar: 0.5,
    sit_mass: 0.3,
    hard_fail: false,
    quorum: { up: 4, down: 1, wait: 2 },
    size: 2,
    gates: [],
    hypothesis: "hypo",
    evidence: ["e1", "e2"],
    counter: "counter",
    decision: "UP now",
    invalidate_if: "spot < strike",
    ...over,
  } as ChairResult;
}

test("M1: the OPENING row carries this exact tick's market and chair values", () => {
  const r = buildDecisionSnapshotRow(snap({}), chair({}));
  assert.equal(r.ticker, "KXBTC15M-26SEP111800-00");
  assert.equal(r.close_time_ms, 1_700_000_900_000);
  assert.equal(r.decision_at_ms, 1_700_000_000_000); // snap.as_of, the decision clock
  assert.equal(r.quote_last_change_ms, 1_699_999_999_000); // snap.quote_ts, a last-change clock
  assert.equal(r.yes_ask, 62);
  assert.equal(r.no_ask, 40);
  assert.equal(r.chair_lean, "UP");
  assert.equal(r.chair_confidence, 78);
  assert.equal(r.chair_quorum_up, 4);
  assert.deepEqual(r.chair_evidence, ["e1", "e2"]);
});

test("M6: decision state is not the fill. t1 read at ask 62 stays 62 though t2 books at 80", () => {
  const decision = buildDecisionSnapshotRow(snap({ as_of: 1_000, yes_ask: 62 }), chair({ lean: "UP" }));
  // A later tick where the paper book fills at 80 is a DIFFERENT row the desk
  // records elsewhere (callLog/entryState). S2-5's decision row is untouched by it.
  const laterFillAsk = 80;
  assert.equal(decision.yes_ask, 62, "the decision-time ask is the read, not the fill");
  assert.notEqual(decision.yes_ask, laterFillAsk);
  assert.equal(decision.decision_at_ms, 1_000, "the decision clock is the read tick, not fill time");
});

test("M7: the builder is a snapshot of one tick; a later quote builds a different row, never a rewrite", () => {
  const t1 = buildDecisionSnapshotRow(snap({ as_of: 1_000, yes_ask: 62 }), chair({ lean: "UP" }));
  const t3 = buildDecisionSnapshotRow(snap({ as_of: 3_000, yes_ask: 73 }), chair({ lean: "UP" }));
  assert.equal(t1.yes_ask, 62);
  assert.equal(t3.yes_ask, 73);
  // The rule proves the later tick writes NOTHING once OPENING stands directional,
  // so history is never rewritten; the builder itself never mutates a prior row.
  assert.deepEqual(
    decisionSnapshotEvents({ openingExists: true, openingLean: "UP", firstDirectionalExists: false, currentLean: "UP" }),
    { insertOpening: false, insertFirstDirectional: false },
  );
});

test("non-finite market values become null, never stored NaN", () => {
  const r = buildDecisionSnapshotRow(snap({ spot: NaN, yes_ask: Infinity, quote_seq: NaN }), chair({ confidence: NaN }));
  assert.equal(r.spot, null);
  assert.equal(r.yes_ask, null);
  assert.equal(r.quote_seq, null);
  assert.equal(r.chair_confidence, null);
});

test("a WAIT read still builds a full row; no directional executable price is invented", () => {
  const r = buildDecisionSnapshotRow(snap({}), chair({ lean: "WAIT" }));
  assert.equal(r.chair_lean, "WAIT");
  // Both book sides are stored OBSERVED; the table has no single 'entry price' column
  // to manufacture for a WAIT read.
  assert.equal(r.yes_ask, 62);
  assert.equal(r.no_ask, 40);
});

// --- Fix 2: unknown freshness sentinels must not become measurements ---------

test("unknown quote clock (quote_ts<=0) stores NULL, not epoch 1970 or 999", () => {
  const r = buildDecisionSnapshotRow(snap({ quote_ts: 0, quote_age_s: 999 }), chair({}));
  assert.equal(r.quote_last_change_ms, null, "no epoch 1970");
  assert.equal(r.quote_age_s, null, "no fake 999 age");
});

test("a real quote clock is kept", () => {
  const r = buildDecisionSnapshotRow(snap({ quote_ts: 1_699_999_999_000, quote_age_s: 1.2 }), chair({}));
  assert.equal(r.quote_last_change_ms, 1_699_999_999_000);
  assert.equal(r.quote_age_s, 1.2);
});

test("quote_seq 0 (no sequence) stores NULL, not a fake 0", () => {
  assert.equal(buildDecisionSnapshotRow(snap({ quote_seq: 0 }), chair({})).quote_seq, null);
  assert.equal(buildDecisionSnapshotRow(snap({ quote_seq: 42 }), chair({})).quote_seq, 42);
});

test("print_age_s >= 999 (unknown sentinel) stores NULL; a real age is kept", () => {
  assert.equal(buildDecisionSnapshotRow(snap({ print_age_s: 999 }), chair({})).print_age_s, null, "the 999 sentinel");
  assert.equal(buildDecisionSnapshotRow(snap({ print_age_s: 1200 }), chair({})).print_age_s, null, "a carried-forward unknown that grew past 999");
  assert.equal(buildDecisionSnapshotRow(snap({ print_age_s: 3.4 }), chair({})).print_age_s, 3.4, "a real print age");
});
