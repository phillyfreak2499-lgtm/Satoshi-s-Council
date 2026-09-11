import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FROZEN_AT,
  MIN_PROSPECTIVE,
  researchBoard,
  researchRow,
  statusOf,
  type ResearchRow,
} from "./research-status.ts";

const base = {
  id: "X",
  family: "TAPE 2.0",
  n: 0,
  prospective_n: 0,
  since: FROZEN_AT,
  since_why: "frozen with the rest of Phase 2",
  regime_n: {},
  directional: 0,
  result: null as string | null,
  note: "a measurement",
};

test("the ladder climbs from nothing to measurable and stops there", () => {
  assert.equal(statusOf({ n: 0, prospective_n: 0 }), "no sample");
  assert.equal(statusOf({ n: 500, prospective_n: 0 }), "gathering");
  assert.equal(statusOf({ n: 500, prospective_n: MIN_PROSPECTIVE - 1 }), "gathering");
  assert.equal(statusOf({ n: 500, prospective_n: MIN_PROSPECTIVE }), "measurable");
  assert.equal(statusOf({ n: 500, prospective_n: 900, restarted: true }), "restarted");
});

test("a large retrospective sample does not make a row measurable", () => {
  // The whole point of the board. 4,000 observations, all from before the
  // definition was fixed, is not evidence for the definition.
  const r = researchRow({ ...base, n: 4000, prospective_n: 2 });
  assert.equal(r.status, "gathering");
  assert.equal(r.n, 4000);
  assert.equal(r.prospective_n, 2);
});

test("a result is withheld, not merely labelled, below the bar", () => {
  // A number beside a thin sample is read as a finding whatever the status says.
  const thin = researchRow({ ...base, n: 100, prospective_n: 5, result: "+9.5 points of overpricing" });
  assert.equal(thin.result, null);
  const ready = researchRow({ ...base, n: 100, prospective_n: 40, result: "+9.5 points of overpricing" });
  assert.equal(ready.result, "+9.5 points of overpricing");
});

test("a corrected definition restarts the clock and says why", () => {
  const r = researchRow({
    ...base,
    id: "TAPE2.ofi_norm_15s",
    n: 4000,
    prospective_n: 4000,
    restarted: true,
    since: "2026-09-11",
    since_why: "divided by residue levels before the book dropped them; earlier records are unusable",
    result: "something",
  });
  assert.equal(r.status, "restarted");
  assert.equal(r.result, null, "a restarted row must not carry a result from the broken era");
  assert.match(r.since_why, /unusable/);
});

test("the best-populated regime is reported, because a result can live in one session", () => {
  const r = researchRow({ ...base, n: 90, prospective_n: 90, regime_n: { US_AM_MID: 70, ASIA_MID: 15, EUROPE_MID: 5 } });
  assert.equal(r.best_regime_n, 70);
  assert.equal(Object.keys(r.regime_n).length, 3);
});

test("a row with no regimes reports zero rather than crashing on an empty max", () => {
  assert.equal(researchRow({ ...base, n: 5, prospective_n: 5 }).best_regime_n, 0);
});

test("directional occurrences are tracked apart from row count", () => {
  // A feature that is zero on nine windows in ten has a tenth of the evidence
  // its row count suggests.
  const r = researchRow({ ...base, n: 1000, prospective_n: 1000, directional: 90 });
  assert.equal(r.prospective_n, 1000);
  assert.equal(r.directional, 90);
});

test("the board tallies by status and sorts the best-evidenced first", () => {
  const rows: ResearchRow[] = [
    researchRow({ ...base, id: "a", n: 10, prospective_n: 10 }),
    researchRow({ ...base, id: "b", n: 100, prospective_n: 100 }),
    researchRow({ ...base, id: "c", n: 0, prospective_n: 0 }),
  ];
  const b = researchBoard(rows);
  assert.deepEqual(b.rows.map((r) => r.id), ["b", "a", "c"]);
  assert.equal(b.tally.measurable, 1);
  assert.equal(b.tally.gathering, 1);
  assert.equal(b.tally["no sample"], 1);
  assert.equal(b.tally.restarted, 0);
});

test("the board states in its own payload that it promotes nothing", () => {
  const b = researchBoard([]);
  assert.match(b.note, /nothing on this board promotes anything/i);
  assert.match(b.note, /is not evidence for it/);
  assert.equal(b.frozen_at, FROZEN_AT);
  assert.equal(b.min_prospective, MIN_PROSPECTIVE);
});

test("there is no rung above measurable", () => {
  // A "promote" or "adopt" status would be read as permission. The type has no
  // such member and this asserts the ladder's whole range.
  const all = new Set(
    [
      statusOf({ n: 0, prospective_n: 0 }),
      statusOf({ n: 1, prospective_n: 0 }),
      statusOf({ n: 1e6, prospective_n: 1e6 }),
      statusOf({ n: 1, prospective_n: 1, restarted: true }),
    ],
  );
  assert.deepEqual([...all].sort(), ["gathering", "measurable", "no sample", "restarted"]);
});
