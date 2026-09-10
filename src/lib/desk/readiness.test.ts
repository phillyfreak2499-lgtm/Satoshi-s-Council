import { test } from "node:test";
import assert from "node:assert/strict";
import {
  READINESS_PROMPT,
  READY_MIN_CHAIR_WAIT,
  READY_MIN_TAKER_DIR,
  READY_MIN_WINDOWS,
  readinessReport,
  regimesMeeting,
  type ReadinessInput,
} from "./readiness.ts";
import { TAKER_FROZEN_AT } from "./taker.ts";

/** An input that clears every gate — tests then break one thing at a time. */
function met(over: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    windows_since_freeze: READY_MIN_WINDOWS,
    taker_dir_graded: READY_MIN_TAKER_DIR,
    chair_wait_since_freeze: READY_MIN_CHAIR_WAIT,
    regimes: [
      { regime: "US_PM_MID", n: 220 },
      { regime: "US_AM_MID", n: 160 },
    ],
    gaps: 0,
    recon_new_holes: 0,
    ...over,
  };
}

const check = (r: ReturnType<typeof readinessReport>, key: string) => r.checks.find((c) => c.key === key)!;

test("all conditions met → ready", () => {
  const r = readinessReport(met());
  assert.equal(r.ready, true);
  assert.equal(r.met_count, r.total_count);
  assert.ok(r.checks.every((c) => c.met));
});

test("windows just short → not ready, only that check fails", () => {
  const r = readinessReport(met({ windows_since_freeze: READY_MIN_WINDOWS - 1 }));
  assert.equal(r.ready, false);
  assert.equal(check(r, "windows").met, false);
  assert.equal(check(r, "taker_dir").met, true);
  assert.equal(r.met_count, r.total_count - 1);
});

test("windows exactly at threshold → met (>=)", () => {
  assert.equal(check(readinessReport(met({ windows_since_freeze: READY_MIN_WINDOWS })), "windows").met, true);
});

test("taker directional count is the binding constraint", () => {
  assert.equal(readinessReport(met({ taker_dir_graded: READY_MIN_TAKER_DIR - 1 })).ready, false);
  assert.equal(readinessReport(met({ taker_dir_graded: READY_MIN_TAKER_DIR })).ready, true);
});

test("chair WAIT volume gates (never chair directional volume)", () => {
  assert.equal(readinessReport(met({ chair_wait_since_freeze: READY_MIN_CHAIR_WAIT - 1 })).ready, false);
});

test("one regime clearing the floor is not enough", () => {
  const r = readinessReport(met({ regimes: [{ regime: "US_PM_MID", n: 900 }] }));
  assert.equal(r.ready, false);
  assert.equal(check(r, "regimes").have, 1);
  assert.equal(check(r, "regimes").met, false);
});

test("two regimes exactly at the per-regime floor → met", () => {
  const r = readinessReport(
    met({
      regimes: [
        { regime: "A", n: 150 },
        { regime: "B", n: 150 },
      ],
    }),
  );
  assert.equal(check(r, "regimes").met, true);
  assert.equal(r.ready, true);
});

test("regimes below the floor and blank-named regimes do not count", () => {
  const r = readinessReport(
    met({
      regimes: [
        { regime: "A", n: 149 },
        { regime: "", n: 5000 },
        { regime: "B", n: 400 },
      ],
    }),
  );
  // only B clears the floor → 1 regime → not enough
  assert.equal(check(r, "regimes").have, 1);
  assert.equal(r.ready, false);
});

test("regimesMeeting filters by floor and sorts richest first", () => {
  const out = regimesMeeting(
    [
      { regime: "low", n: 10 },
      { regime: "mid", n: 200 },
      { regime: "", n: 999 },
      { regime: "top", n: 800 },
    ],
    150,
  );
  assert.deepEqual(
    out.map((r) => r.regime),
    ["top", "mid"],
  );
});

test("a recent-ledger hole blocks readiness", () => {
  const r = readinessReport(met({ gaps: 1 }));
  assert.equal(r.ready, false);
  assert.equal(check(r, "integrity").met, false);
  assert.equal(check(r, "integrity").have, 1);
});

test("a newly-missing window (beyond baseline) blocks readiness", () => {
  const r = readinessReport(met({ recon_new_holes: 2 }));
  assert.equal(r.ready, false);
  assert.equal(check(r, "integrity").have, 2);
});

test("clean integrity (no gaps, no new holes) passes", () => {
  assert.equal(check(readinessReport(met()), "integrity").met, true);
});

test("prompt is self-contained and carries the guardrails", () => {
  assert.ok(READINESS_PROMPT.includes(TAKER_FROZEN_AT), "names the freeze boundary");
  assert.match(READINESS_PROMPT, /read-only/i);
  assert.match(READINESS_PROMPT, /incremental/i);
  assert.match(READINESS_PROMPT, /calibrat/i);
  assert.match(READINESS_PROMPT, /separate.*sign-off/i);
  assert.match(READINESS_PROMPT, /70¢ floor/, "asks where the floor belongs");
  assert.match(READINESS_PROMPT, /70–79¢ against 80¢/, "compares the shelves out of sample");
});

test("frozen_at defaults to the freeze constant and honors an override", () => {
  assert.equal(readinessReport(met()).frozen_at, TAKER_FROZEN_AT);
  assert.equal(readinessReport(met(), "2027-01-01").frozen_at, "2027-01-01");
});

test("met_count counts exactly the passing checks", () => {
  const r = readinessReport(met({ windows_since_freeze: 0, taker_dir_graded: 0 }));
  assert.equal(r.met_count, 3);
  assert.equal(r.total_count, 5);
});
