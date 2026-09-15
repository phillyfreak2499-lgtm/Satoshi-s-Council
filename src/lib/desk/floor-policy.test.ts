import assert from "node:assert/strict";
import test from "node:test";
import { FLOOR_LIVE_CENTS } from "./book-floor.ts";
import {
  COMPONENTS,
  EXIT_CANDIDATES,
  EXIT_HOLD_V1,
  EXIT_PROVE120_V1,
  EXIT_PROVE180_V1,
  EXIT_PROVE240_V1,
  EXIT_TAKE90_V1,
  EXIT_TAKE90_V2,
  exitCandidatesForEntry,
  ENTRY_80_V1,
  ENTRY_SELECTIVE_V1,
  ENTRY_SELECTIVE_V2,
  FLOOR_SELECTIVE_V1,
  FLOOR_SELECTIVE_V2,
  FLOOR_V1,
  RISK_NONE_V1,
  SAFE_FALLBACK_POLICY,
  SIGNAL_CHAIR_V1,
  componentById,
  composePolicy,
  controlFor,
  fingerprint,
  policyLine,
  resolvePolicy,
  type LabStatus,
} from "./floor-policy.ts";

// ---------------------------------------------------------------------------
// THE FREEZE. The single most dangerous thing that can happen to this system is
// a component's definition changing while its id stays the same, because every
// observation already recorded under that id would silently become evidence for
// a rule that was never tested.
// ---------------------------------------------------------------------------

test("FREEZE: every component's parameters are exactly as defined", () => {
  const EXPECTED: Record<string, string> = {
    CHAIR_V1: "CHAIR_V1|signal|source=runChair",
    ENTRY_80_V1: "ENTRY_80_V1|entry|floor_cents=80",
    ENTRY_SELECTIVE_V1: "ENTRY_SELECTIVE_V1|entry|confirmation_frames=3,confirmation_seconds=8,floor_cents=80,max_calls_per_day=3,max_index_age_s=5,max_losses_per_day=1,max_opposing=0,max_receipt_age_s=10,max_seconds_left=600,max_spot_age_s=15,max_spread_cents=2,min_edge_cents=3,min_families=2,min_index_edge_cents=0,min_seconds_left=180,min_speaking=3,timezone=America/Chicago",
    ENTRY_SELECTIVE_V2: "ENTRY_SELECTIVE_V2|entry|confirmation_frames=3,confirmation_seconds=8,floor_cents=80,max_index_age_s=5,max_opposing=0,max_receipt_age_s=10,max_seconds_left=600,max_spot_age_s=15,max_spread_cents=2,min_edge_cents=3,min_families=2,min_index_edge_cents=0,min_seconds_left=180,min_speaking=3,protect_after_net_cents=100,protect_after_wins=5,tight_confirmation_frames=5,tight_confirmation_seconds=20,tight_min_edge_cents=5,tight_min_families=3,tight_min_index_edge_cents=2,tight_min_speaking=4,tighten_at_net_cents=-100,timezone=America/Chicago",
    HOLD_V1: "HOLD_V1|exit|",
    PROVE120_V1: "PROVE120_V1|exit|horizon_s=120,target_cents=10",
    PROVE180_V1: "PROVE180_V1|exit|horizon_s=180,target_cents=10",
    PROVE240_V1: "PROVE240_V1|exit|horizon_s=240,target_cents=10",
    TAKE90_V1: "TAKE90_V1|exit|take_cents=90",
    TAKE90_V2: "TAKE90_V2|exit|min_net_cents=0,take_cents=90",
    RISK_NONE_V1: "RISK_NONE_V1|risk|contracts=1",
  };
  assert.equal(COMPONENTS.length, Object.keys(EXPECTED).length, "a component was added or removed");
  for (const x of COMPONENTS) {
    assert.equal(
      fingerprint(x),
      EXPECTED[x.id],
      `${x.id} changed definition. If this is intentional, it is a NEW VERSION (${x.family}_V${x.version + 1}) ` +
        `with prospective N reset to zero — never an edit to this one.`,
    );
  }
});

test("a frozen component cannot be mutated at runtime", () => {
  // Object.freeze on the component and its params, so an accidental assignment
  // throws in strict mode rather than quietly redefining a tested rule.
  assert.throws(() => {
    (EXIT_PROVE180_V1.params as Record<string, number>).horizon_s = 999;
  });
  assert.equal(Number(EXIT_PROVE180_V1.params.horizon_s), 180);
});

test("the registry is a fixed list that runtime cannot append to", () => {
  assert.throws(() => {
    (COMPONENTS as unknown as unknown[]).push({});
  }, "candidate creation must be a code change someone reads, not a runtime event");
});

// ---------------------------------------------------------------------------
// The initial Champion is the unchanged desk.
// ---------------------------------------------------------------------------

test("FLOOR_V1 is exactly what the desk already does", () => {
  assert.equal(FLOOR_V1.policy_id, "FLOOR_V1");
  assert.equal(FLOOR_V1.signal_policy, "CHAIR_V1");
  assert.equal(FLOOR_V1.entry_policy, "ENTRY_80_V1");
  assert.equal(FLOOR_V1.exit_policy, "HOLD_V1", "holding to settlement is the incumbent exit");
  assert.equal(FLOOR_V1.risk_policy, "RISK_NONE_V1");
  assert.equal(FLOOR_V1.status, "CHAMPION");
});

test("the named entry policy agrees with the live floor constant", () => {
  // If these drift, the policy board describes a desk that does not exist. The
  // number lives in book-floor.ts; this asserts the label is not lying about it.
  assert.equal(Number(ENTRY_80_V1.params.floor_cents), FLOOR_LIVE_CENTS);
});

test("the safe fallback keeps the owner's stricter admission; the original policy remains distinct", () => {
  assert.equal(SAFE_FALLBACK_POLICY, FLOOR_SELECTIVE_V2.policy_id);
  assert.equal(FLOOR_SELECTIVE_V2.entry_policy, ENTRY_SELECTIVE_V2.id);
  assert.equal(FLOOR_SELECTIVE_V1.entry_policy, ENTRY_SELECTIVE_V1.id);
  assert.equal(FLOOR_V1.entry_policy, ENTRY_80_V1.id);
});

test("a policy resolves to four frozen definitions and reads plainly", () => {
  const r = resolvePolicy(FLOOR_V1);
  assert.equal(r.signal?.id, "CHAIR_V1");
  assert.equal(r.entry?.id, "ENTRY_80_V1");
  assert.equal(r.exit?.id, "HOLD_V1");
  assert.equal(r.risk?.id, "RISK_NONE_V1");
  assert.equal(policyLine(FLOOR_V1), "Council Chair + 80¢ floor + HOLD");
});

// ---------------------------------------------------------------------------
// HOLD is the control.
// ---------------------------------------------------------------------------

test("HOLD is the permanent control and is not a challenger", () => {
  assert.equal(EXIT_HOLD_V1.control, true);
  assert.equal(controlFor("exit")?.id, "HOLD_V1");
  assert.equal(EXIT_CANDIDATES.filter((x) => x.control).length, 1, "exactly one control");
  for (const x of [EXIT_PROVE120_V1, EXIT_PROVE180_V1, EXIT_PROVE240_V1, EXIT_TAKE90_V1, EXIT_TAKE90_V2]) {
    assert.notEqual(x.control, true);
  }
});

test("the exit competition has the control plus the five named candidates", () => {
  assert.deepEqual(
    EXIT_CANDIDATES.map((x) => x.id),
    ["HOLD_V1", "PROVE120_V1", "PROVE180_V1", "PROVE240_V1", "TAKE90_V1", "TAKE90_V2"],
  );
});

test("no parameter-mined variants are registered", () => {
  // The families present are exactly the four hypotheses plus the control. A
  // PROVE145 or a +8¢ variant appearing here without being asked for is the
  // failure mode this guards.
  const exitFamilies = [...new Set(EXIT_CANDIDATES.map((x) => x.family))].sort();
  assert.deepEqual(exitFamilies, ["HOLD", "PROVE120", "PROVE180", "PROVE240", "TAKE90"]);
});

// ---------------------------------------------------------------------------
// Composition — how a component promotion becomes a Champion.
// ---------------------------------------------------------------------------

test("promoting an exit composes a NEW policy version, it does not mutate the old one", () => {
  const v2 = composePolicy(FLOOR_V1, EXIT_PROVE180_V1, {
    policy_id: "FLOOR_V2",
    version: 2,
    created_at: "2026-10-01T00:00:00.000Z",
    prospective_start_at: "2026-10-01T00:00:00.000Z",
  });
  assert.equal(v2.policy_id, "FLOOR_V2");
  assert.equal(v2.exit_policy, "PROVE180_V1");
  assert.equal(v2.signal_policy, "CHAIR_V1", "the Chair is untouched by an exit promotion");
  assert.equal(v2.entry_policy, "ENTRY_80_V1");
  assert.equal(v2.status, "SHADOW", "a freshly composed policy has earned nothing yet");
  // The incumbent is preserved exactly.
  assert.equal(FLOOR_V1.exit_policy, "HOLD_V1");
  assert.equal(FLOOR_V1.status, "CHAMPION");
  assert.equal(policyLine(v2), "Council Chair + 80¢ floor + PROVE-180");
});

test("a component lands in its own slot and nowhere else", () => {
  const swapped = composePolicy(FLOOR_V1, ENTRY_80_V1, {
    policy_id: "FLOOR_VX",
    version: 9,
    created_at: "2026-10-01T00:00:00.000Z",
    prospective_start_at: "2026-10-01T00:00:00.000Z",
  });
  // An entry component replaces the entry slot; the exit is untouched.
  assert.equal(swapped.entry_policy, "ENTRY_80_V1");
  assert.equal(swapped.exit_policy, "HOLD_V1");
  assert.equal(swapped.signal_policy, "CHAIR_V1");
});

test("an exit candidate can never become the directional signal", () => {
  const v = composePolicy(FLOOR_V1, EXIT_PROVE180_V1, {
    policy_id: "FLOOR_VY",
    version: 9,
    created_at: "2026-10-01T00:00:00.000Z",
    prospective_start_at: "2026-10-01T00:00:00.000Z",
  });
  assert.equal(v.signal_policy, "CHAIR_V1", "PROVE-180 has no opinion about UP or DOWN");
  assert.notEqual(v.signal_policy, EXIT_PROVE180_V1.id);
});

test("a policy cannot point at an unregistered component", () => {
  // A policy referencing an id with no frozen definition could never be reproduced.
  assert.throws(
    () =>
      composePolicy(FLOOR_V1, { ...EXIT_PROVE180_V1, id: "PROVE999_V1" }, {
        policy_id: "FLOOR_VZ",
        version: 9,
        created_at: "x",
        prospective_start_at: "x",
      }),
    /not a registered component/,
  );
});

// ---------------------------------------------------------------------------
// Versioning resets evidence.
// ---------------------------------------------------------------------------

test("a new version is a different evidence bucket, not a relabelled old one", () => {
  // Observations are recorded against the component id. A V2 therefore cannot
  // inherit a single V1 observation, which is the freeze rule's whole purpose.
  const v1 = EXIT_PROVE180_V1;
  const v2 = { ...v1, id: "PROVE180_V2", version: 2, params: { target_cents: 12, horizon_s: 180 } };
  assert.notEqual(v1.id, v2.id);
  assert.notEqual(fingerprint(v1), fingerprint(v2 as typeof v1));
  assert.equal(componentById("PROVE180_V2"), null, "V2 does not exist until it is registered");
});

test("every component id is unique and matches its family and version", () => {
  const ids = new Set<string>();
  for (const x of COMPONENTS) {
    assert.equal(ids.has(x.id), false, `duplicate id ${x.id}`);
    ids.add(x.id);
    assert.equal(x.id, `${x.family}_V${x.version}`, `${x.id} does not match ${x.family}_V${x.version}`);
    assert.ok(x.why.length > 20, `${x.id} needs a reason a later reader can use`);
    assert.ok(Number.isFinite(Date.parse(x.frozen_at)), `${x.id} needs a freeze date`);
  }
});

test("lookups resolve and miss cleanly", () => {
  assert.equal(componentById("PROVE180_V1")?.label, "PROVE-180");
  assert.equal(componentById("nope"), null);
  assert.equal(controlFor("signal"), null, "no control is defined for the signal slot yet");
  assert.equal(RISK_NONE_V1.kind, "risk");
  assert.equal(SIGNAL_CHAIR_V1.kind, "signal");
});

test("the status vocabulary covers every state the board needs", () => {
  const all: LabStatus[] = [
    "CHAMPION",
    "ACTIVE",
    "CONTROL",
    "SHADOW",
    "LEADING",
    "EARLY_DATA",
    "PROMOTION_READY",
    "PROBATION",
    "ROLLBACK",
    "RETIRED",
  ];
  assert.equal(new Set(all).size, 10);
});

test("TAKE90 V2 starts a separate prospective bucket at its frozen entry time", () => {
  const start = Date.parse(EXIT_TAKE90_V2.frozen_at);
  assert.equal(fingerprint(EXIT_TAKE90_V1), "TAKE90_V1|exit|take_cents=90");
  assert.notEqual(fingerprint(EXIT_TAKE90_V1), fingerprint(EXIT_TAKE90_V2));
  assert.equal(exitCandidatesForEntry(start - 1).some((x) => x.id === EXIT_TAKE90_V2.id), false);
  assert.equal(exitCandidatesForEntry(start - 1).some((x) => x.id === EXIT_TAKE90_V1.id), true);
  assert.equal(exitCandidatesForEntry(start).some((x) => x.id === EXIT_TAKE90_V2.id), true);
  assert.deepEqual(exitCandidatesForEntry(Number.NaN), []);
  assert.deepEqual(exitCandidatesForEntry(Infinity), []);
  assert.equal(FLOOR_V1.exit_policy, EXIT_HOLD_V1.id);
});
