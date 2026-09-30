// Unit rails for OWNER_RESTORE_E1_PAIR_V1 (src/lib/desk/owner-restore.ts), loaded
// through Vite like the other scripts/ rails so the default npm test glob runs them.
import assert from "node:assert/strict";
import test, { after } from "node:test";

if (typeof process.env.DATABASE_URL === "string" && process.env.DATABASE_URL.trim()) {
 throw new Error("owner-restore rails refuse nonempty DATABASE_URL before Vite startup");
}
const { createServer } = await import("vite");
const vite = await createServer({ envDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
after(() => vite.close());
const {
 applyOwnerRestore, ownerRestoreMode, rollbackOwnerRestore,
 OWNER_RESTORE_CARDS, OWNER_RESTORE_E1_PAIR_V1, OWNER_RESTORE_ENV,
} = await vite.ssrLoadModule("/src/lib/desk/owner-restore.ts");
const { calibNOf, listenCalib, seatCalib, WARM_N } = await vite.ssrLoadModule("/src/lib/desk/math.ts");
// SYNTHETIC fixture shaped like the post-review state (committed DB_VERIFIED
// snapshot 2026-09-22 for seat_n/debt; E1 authority summary 2026-09-30 for the
// numeric pass). It is not a copy of production learner state.
const card = (id, status, extra = {}) => ({
  id, owner: id.split(".")[0], status, n: 683, hits: 640, wilson: 0.9, ev: 5, ev_n: 683,
  brier: 0.2, brier_n: 683, last20: [], pocket: {}, manual_hold: false, ...extra,
});
function postReview() {
  return {
    skills: {
      "STRIKE.itm_time": card("STRIKE.itm_time", "SHADOW"),
      "CHAIN.oi_with_price": card("CHAIN.oi_with_price", "SHADOW"),
      "STREAK.continue_young": card("STREAK.continue_young", "SHADOW"),
      "CARRY.trend_carry": card("CARRY.trend_carry", "SHADOW"),
      "DRIFT.aligned_3h": card("DRIFT.aligned_3h", "LIVE"),
      "DRIFT.pullback_in_trend": card("DRIFT.pullback_in_trend", "SHADOW"),
    },
    seat_n: { STRIKE: 210, STREAK: 587, CHAIN: 398 },
    seat_calib_debt: { STRIKE: 210, STREAK: 587, CHAIN: 340 },
  };
}
const NOW = Date.parse("2026-09-30T15:00:00Z");
const clone = (x) => structuredClone(x);
test("the switch is exact-string and defaults OFF", () => {
  assert.equal(ownerRestoreMode({}), "OFF");
  for (const v of ["true", "1", "on", "status_only", " STATUS_ONLY", "LIVE"])
    assert.equal(ownerRestoreMode({ [OWNER_RESTORE_ENV]: v }), "OFF", v);
  assert.equal(ownerRestoreMode({ [OWNER_RESTORE_ENV]: "STATUS_ONLY" }), "STATUS_ONLY");
  assert.equal(ownerRestoreMode({ [OWNER_RESTORE_ENV]: "STATUS_AND_STRIKE_CALIBRATION" }), "STATUS_AND_STRIKE_CALIBRATION");
  assert.equal(ownerRestoreMode({ [OWNER_RESTORE_ENV]: "ROLLBACK" }), "ROLLBACK");
});
test("OFF changes nothing at all", () => {
  const L = postReview();
  const before = clone(L);
  const r = applyOwnerRestore(L, "OFF", NOW);
  assert.equal(r.outcome, "OFF");
  assert.equal(r.changed, false);
  assert.deepEqual(L, before);
});
test("STATUS_ONLY moves exactly the two P1-clean cards and nothing else", () => {
  const L = postReview();
  const before = clone(L);
  const r = applyOwnerRestore(L, "STATUS_ONLY", NOW);
  assert.equal(r.outcome, "APPLIED");
  assert.deepEqual(r.status.map((s) => [s.card, s.from, s.to]), [["STRIKE.itm_time", "SHADOW", "LIVE"], ["CHAIN.oi_with_price", "SHADOW", "LIVE"]]);
  assert.deepEqual(r.debt, []);
  assert.deepEqual([...OWNER_RESTORE_CARDS], ["STRIKE.itm_time", "CHAIN.oi_with_price"]);
  // Everything outside the two statuses and the marker is byte-identical.
  const { owner_restore, ...rest } = L;
  const expected = clone(before);
  expected.skills["STRIKE.itm_time"].status = "LIVE";
  expected.skills["CHAIN.oi_with_price"].status = "LIVE";
  assert.deepEqual(rest, expected);
  assert.equal(L.skills["STREAK.continue_young"].status, "SHADOW", "P1: STREAK+STRIKE is one effective book family, so STREAK stays out");
  assert.equal(owner_restore?.version, OWNER_RESTORE_E1_PAIR_V1);
  assert.equal(owner_restore?.state, "APPLIED");
  // STRIKE stays UNCALIBRATED: calibration is re-earned only through normal grading.
  assert.equal(calibNOf(L.seat_n.STRIKE, L.seat_calib_debt.STRIKE), 0);
});
test("STATUS_AND_STRIKE_CALIBRATION lifts only the UNCALIBRATED label, not STRIKE's weight", () => {
  const L = postReview();
  const r = applyOwnerRestore(L, "STATUS_AND_STRIKE_CALIBRATION", NOW);
  assert.equal(r.outcome, "APPLIED");
  assert.deepEqual(r.debt, [{ seat: "STRIKE", from: 210, to: 190 }]);
  const cn = calibNOf(L.seat_n.STRIKE, L.seat_calib_debt.STRIKE);
  assert.equal(cn, WARM_N, "effective calibration n sits exactly at WARM_N");
  assert.equal(seatCalib(cn), 0, "so seatCalib (and sit weight) is unchanged");
  assert.equal(listenCalib(cn), listenCalib(0), "and the Chair's listen factor is unchanged");
  assert.equal(L.seat_calib_debt.STREAK, 587);
  assert.equal(L.seat_calib_debt.CHAIN, 340);
});
test("it is applied at most once and a rolled-back marker blocks a silent re-apply", () => {
  const L = postReview();
  assert.equal(applyOwnerRestore(L, "STATUS_ONLY", NOW).outcome, "APPLIED");
  const again = clone(L);
  assert.equal(applyOwnerRestore(L, "STATUS_ONLY", NOW + 1).outcome, "ALREADY_DONE");
  assert.deepEqual(L, again);
  const C = postReview();
  assert.equal(applyOwnerRestore(C, "STATUS_AND_STRIKE_CALIBRATION", NOW).outcome, "APPLIED");
  const calibrated = clone(C);
  for (const mode of ["STATUS_AND_STRIKE_CALIBRATION", "STATUS_ONLY"]) {
    const r = applyOwnerRestore(C, mode, NOW + 1);
    assert.equal(r.outcome, "ALREADY_DONE", mode);
    assert.deepEqual(C, calibrated, mode);
  }
  assert.equal(rollbackOwnerRestore(L, NOW + 2).outcome, "ROLLED_BACK");
  const rolled = clone(L);
  const r = applyOwnerRestore(L, "STATUS_ONLY", NOW + 3);
  assert.equal(r.outcome, "ALREADY_DONE");
  assert.match(r.reason, /new owner-approved version/);
  assert.deepEqual(L, rolled);
});
test("STATUS_ONLY can later be upgraded with the calibration step alone, and ROLLBACK undoes both", () => {
  const L = postReview();
  const original = clone(L);
  applyOwnerRestore(L, "STATUS_ONLY", NOW);
  L.seat_n.STRIKE = 214; // STRIKE graded 4 windows while LIVE but still UNCALIBRATED (n - debt = 4)
  const r = applyOwnerRestore(L, "STATUS_AND_STRIKE_CALIBRATION", NOW + 60_000);
  assert.equal(r.outcome, "APPLIED");
  assert.deepEqual(r.status, [], "no status moves in the upgrade");
  assert.deepEqual(r.debt, [{ seat: "STRIKE", from: 210, to: 194 }]);
  assert.equal(calibNOf(L.seat_n.STRIKE, L.seat_calib_debt.STRIKE), WARM_N);
  assert.equal(L.owner_restore?.mode, "STATUS_AND_STRIKE_CALIBRATION");
  assert.equal(applyOwnerRestore(L, "ROLLBACK", NOW + 120_000).outcome, "ROLLED_BACK");
  const { owner_restore, ...rest } = L;
  assert.deepEqual(rest, { ...original, seat_n: { ...original.seat_n, STRIKE: 214 } }, "grading's own seat_n growth is kept; restored fields return");
  assert.equal(owner_restore?.state, "ROLLED_BACK");
});
test("preconditions fail closed and never leave a partial change", () => {
  const cases = [
    ["card already LIVE", (L) => { L.skills["CHAIN.oi_with_price"].status = "LIVE"; }, /CHAIN\.oi_with_price is LIVE, not SHADOW/],
    ["card benched", (L) => { L.skills["STRIKE.itm_time"].status = "BENCH"; }, /STRIKE\.itm_time is BENCH/],
    ["card missing", (L) => { delete L.skills["CHAIN.oi_with_price"]; }, /missing/],
    ["too few graded reads", (L) => { L.skills["CHAIN.oi_with_price"].ev_n = 49; }, /fewer than 50 graded economic reads/],
    ["Wilson below owner bar", (L) => { L.skills["STRIKE.itm_time"].wilson = 0.59; }, /Wilson or after-fee EV below owner bar/],
    ["owner hold", (L) => { L.skills["STRIKE.itm_time"].manual_hold = true; L.skills["STRIKE.itm_time"].held_why = "owner hold"; }, /owner hold/],
  ];
  for (const [name, mutate, reason] of cases) {
    const L = postReview();
    mutate(L);
    const before = clone(L);
    const r = applyOwnerRestore(L, "STATUS_AND_STRIKE_CALIBRATION", NOW);
    assert.equal(r.outcome, "REFUSED", name);
    assert.match(r.reason, reason, name);
    assert.deepEqual(L, before, `${name}: no partial mutation`);
  }
});
test("calibration refuses if STRIKE's approved debt moved or seat_n shrank; STATUS_ONLY does not depend on them", () => {
  for (const [n, debt] of [[210, 209], [210, 211], [209, 210], [undefined, 210]]) {
    const L = postReview();
    if (n === undefined)
      delete L.seat_n.STRIKE;
    else
      L.seat_n.STRIKE = n;
    L.seat_calib_debt.STRIKE = debt;
    const before = clone(L);
    const r = applyOwnerRestore(L, "STATUS_AND_STRIKE_CALIBRATION", NOW);
    assert.equal(r.outcome, "REFUSED", `${n}/${debt}`);
    assert.match(r.reason, /calibration inputs moved/);
    assert.deepEqual(L, before);
    assert.equal(applyOwnerRestore(clone(before), "STATUS_ONLY", NOW).outcome, "APPLIED");
  }
  // seat_n may only have grown: lift to exactly WARM_N, or leave an already-calibrated seat alone.
  const grown = postReview();
  grown.seat_n.STRIKE = 215;
  assert.deepEqual(applyOwnerRestore(grown, "STATUS_AND_STRIKE_CALIBRATION", NOW).debt, [{ seat: "STRIKE", from: 210, to: 195 }]);
  const warm = postReview();
  warm.seat_n.STRIKE = 240;
  assert.deepEqual(applyOwnerRestore(warm, "STATUS_AND_STRIKE_CALIBRATION", NOW).debt, [{ seat: "STRIKE", from: 210, to: 210 }]);
  assert.equal(warm.seat_calib_debt.STRIKE, 210);
});
test("ROLLBACK restores the exact recorded values and refuses if anything moved them", () => {
  const L = postReview();
  const original = clone(L);
  applyOwnerRestore(L, "STATUS_AND_STRIKE_CALIBRATION", NOW);
  const r = applyOwnerRestore(L, "ROLLBACK", NOW + 60_000);
  assert.equal(r.outcome, "ROLLED_BACK");
  const { owner_restore, ...rest } = L;
  assert.deepEqual(rest, original);
  assert.equal(owner_restore?.state, "ROLLED_BACK");
  assert.equal(applyOwnerRestore(L, "ROLLBACK", NOW + 120_000).outcome, "ALREADY_DONE");
  const moved = postReview();
  applyOwnerRestore(moved, "STATUS_ONLY", NOW);
  moved.skills["STRIKE.itm_time"].status = "BENCH"; // e.g. the unchanged huddle bench rule fired
  const before = clone(moved);
  const refused = rollbackOwnerRestore(moved, NOW + 1);
  assert.equal(refused.outcome, "ROLLBACK_REFUSED");
  assert.deepEqual(moved, before);
  assert.equal(rollbackOwnerRestore(postReview(), NOW).outcome, "ROLLBACK_REFUSED");
});
test("ROLLBACK refuses a malformed marker without touching anything", () => {
  const corruptions = [
    (L) => { delete L.owner_restore.prior; },
    (L) => { L.owner_restore.prior.status = { "STREAK.continue_young": "SHADOW" }; L.owner_restore.applied.status = { "STREAK.continue_young": "LIVE" }; },
    (L) => { L.owner_restore.prior.debt = { CHAIN: 340 }; L.owner_restore.applied.debt = { CHAIN: 0 }; },
    (L) => { L.owner_restore.prior.status["STRIKE.itm_time"] = "PROMOTED"; },
    (L) => { delete L.owner_restore.applied.status["CHAIN.oi_with_price"]; },
  ];
  for (const corrupt of corruptions) {
    const L = postReview();
    applyOwnerRestore(L, "STATUS_AND_STRIKE_CALIBRATION", NOW);
    corrupt(L);
    const before = clone(L);
    const r = rollbackOwnerRestore(L, NOW + 1);
    assert.equal(r.outcome, "ROLLBACK_REFUSED");
    assert.deepEqual(L, before);
  }
});

test("authority rejects invalid numbers without promoting either card", () => {
  const invalid = [undefined, null, NaN, Infinity, -Infinity, "683"];
  for (const id of OWNER_RESTORE_CARDS) {
    for (const field of ["n", "ev_n", "wilson", "ev"]) {
      for (const value of invalid) {
        const L = postReview();
        L.skills[id][field] = value;
        const before = clone(L);
        const r = applyOwnerRestore(L, "STATUS_ONLY", NOW);
        assert.equal(r.outcome, "REFUSED", `${id}.${field}=${value}`);
        assert.match(r.reason, /invalid numeric authority inputs/);
        assert.deepEqual(L, before);
      }
    }
    for (const [field, value] of [["n", -1], ["ev_n", 50.5], ["wilson", 1.1], ["wilson", -0.1], ["min_walkforward_n", NaN], ["min_regime_n", Infinity]]) {
      const L = postReview();
      L.skills[id][field] = value;
      const before = clone(L);
      assert.equal(applyOwnerRestore(L, "STATUS_ONLY", NOW).outcome, "REFUSED", `${field}=${value}`);
      assert.deepEqual(L, before);
    }
  }
});

test("calibration refuses nonfinite or fractional counts without partial changes", () => {
  for (const field of ["seat_n", "seat_calib_debt"]) {
    for (const value of [NaN, Infinity, -Infinity, 210.5, "210", null]) {
      const L = postReview();
      L[field].STRIKE = value;
      const before = clone(L);
      const r = applyOwnerRestore(L, "STATUS_AND_STRIKE_CALIBRATION", NOW);
      assert.equal(r.outcome, "REFUSED", `${field}=${value}`);
      assert.match(r.reason, /calibration inputs moved/);
      assert.deepEqual(L, before);
    }
  }
});

test("an unknown marker version is never overwritten, including on rollback", () => {
  for (const mode of ["STATUS_ONLY", "STATUS_AND_STRIKE_CALIBRATION", "ROLLBACK"]) {
    const L = postReview();
    L.owner_restore = { version: "OTHER_VERSION", mode: "STATUS_ONLY", state: "APPLIED" };
    const before = clone(L);
    const r = applyOwnerRestore(L, mode, NOW);
    assert.equal(r.outcome, mode === "ROLLBACK" ? "ROLLBACK_REFUSED" : "REFUSED");
    assert.deepEqual(L, before);
  }
});

test("exact marker shape is checked before repeat, upgrade and rollback", () => {
  const corruptions = [
    ["empty status maps", (m) => { m.prior.status = {}; m.applied.status = {}; }],
    ["one-card maps", (m) => { delete m.prior.status["CHAIN.oi_with_price"]; delete m.applied.status["CHAIN.oi_with_price"]; }],
    ["wrong prior status", (m) => { m.prior.status["STRIKE.itm_time"] = "LIVE"; }],
    ["wrong applied status", (m) => { m.applied.status["CHAIN.oi_with_price"] = "BENCH"; }],
    ["extra applied card", (m) => { m.applied.status["STREAK.continue_young"] = "LIVE"; }],
    ["unknown state", (m) => { m.state = "CORRUPT"; }],
    ["unknown mode", (m) => { m.mode = "ALL_CARDS"; }],
    ["invalid timestamp", (m) => { m.applied_at = NaN; }],
    ["premature rollback field", (m) => { m.rolled_back_at = NOW + 1; }],
  ];
  for (const initial of ["STATUS_ONLY", "STATUS_AND_STRIKE_CALIBRATION"]) {
    for (const [name, corrupt] of corruptions) {
      for (const mode of ["STATUS_ONLY", "STATUS_AND_STRIKE_CALIBRATION", "ROLLBACK"]) {
        const L = postReview();
        applyOwnerRestore(L, initial, NOW);
        corrupt(L.owner_restore);
        const before = clone(L);
        const r = applyOwnerRestore(L, mode, NOW + 1);
        assert.equal(r.outcome, mode === "ROLLBACK" ? "ROLLBACK_REFUSED" : "REFUSED", `${initial}/${mode}/${name}`);
        assert.match(r.reason, /malformed/);
        assert.deepEqual(L, before);
      }
    }
  }
});

test("marker debt must match its exact policy mode and approved STRIKE transition", () => {
  const corruptions = [
    ["STATUS_ONLY", (m) => { m.prior.debt.STRIKE = 210; m.applied.debt.STRIKE = 190; }],
    ["STATUS_ONLY", (m) => { m.upgraded_at = NOW + 1; }],
    ["STATUS_AND_STRIKE_CALIBRATION", (m) => { m.prior.debt = {}; m.applied.debt = {}; }],
    ["STATUS_AND_STRIKE_CALIBRATION", (m) => { m.prior.debt.STRIKE = 209; }],
    ["STATUS_AND_STRIKE_CALIBRATION", (m) => { m.applied.debt.STRIKE = 0; }],
    ["STATUS_AND_STRIKE_CALIBRATION", (m) => { m.applied.debt.STRIKE = 211; }],
    ["STATUS_AND_STRIKE_CALIBRATION", (m) => { m.applied.debt.STRIKE = NaN; }],
    ["STATUS_AND_STRIKE_CALIBRATION", (m) => { m.prior.debt.CHAIN = 340; m.applied.debt.CHAIN = 0; }],
  ];
  for (const [initial, corrupt] of corruptions) {
    for (const mode of ["STATUS_ONLY", "STATUS_AND_STRIKE_CALIBRATION", "ROLLBACK"]) {
      const L = postReview();
      applyOwnerRestore(L, initial, NOW);
      corrupt(L.owner_restore);
      const before = clone(L);
      const r = applyOwnerRestore(L, mode, NOW + 2);
      assert.equal(r.outcome, mode === "ROLLBACK" ? "ROLLBACK_REFUSED" : "REFUSED", `${initial}/${mode}`);
      assert.deepEqual(L, before);
    }
  }
});

test("calibration upgrade rechecks both current cards and existing authority", () => {
  const changes = [
    (L) => { L.skills["CHAIN.oi_with_price"].status = "BENCH"; },
    (L) => { L.skills["STRIKE.itm_time"].ev_n = 49; },
    (L) => { L.skills["CHAIN.oi_with_price"].wilson = 0.59; },
    (L) => { L.skills["CHAIN.oi_with_price"].ev = 1; },
    (L) => { L.skills["STRIKE.itm_time"].ev = NaN; },
    (L) => { L.skills["CHAIN.oi_with_price"].manual_hold = true; },
  ];
  for (const change of changes) {
    const L = postReview();
    applyOwnerRestore(L, "STATUS_ONLY", NOW);
    change(L);
    const before = clone(L);
    assert.equal(applyOwnerRestore(L, "STATUS_AND_STRIKE_CALIBRATION", NOW + 1).outcome, "REFUSED");
    assert.deepEqual(L, before);
  }
});

test("a malformed rolled-back marker cannot masquerade as an already completed restore", () => {
  const L = postReview();
  applyOwnerRestore(L, "STATUS_ONLY", NOW);
  rollbackOwnerRestore(L, NOW + 1);
  delete L.owner_restore.rolled_back_at;
  const before = clone(L);
  assert.equal(applyOwnerRestore(L, "STATUS_ONLY", NOW + 2).outcome, "REFUSED");
  assert.equal(rollbackOwnerRestore(L, NOW + 2).outcome, "ROLLBACK_REFUSED");
  assert.deepEqual(L, before);
});

test("keyed card identities must match before status release or calibration upgrade", () => {
  for (const id of OWNER_RESTORE_CARDS) {
    for (const [field, value] of [["id", undefined], ["id", "STREAK.continue_young"], ["owner", undefined], ["owner", "STREAK"]]) {
      for (const upgrade of [false, true]) {
        const L = postReview();
        if (upgrade) applyOwnerRestore(L, "STATUS_ONLY", NOW);
        L.skills[id][field] = value;
        const before = clone(L);
        const r = applyOwnerRestore(L, upgrade ? "STATUS_AND_STRIKE_CALIBRATION" : "STATUS_ONLY", NOW + 1);
        assert.equal(r.outcome, "REFUSED", `${id}.${field}/${upgrade}`);
        assert.match(r.reason, /mismatched card identity/);
        assert.deepEqual(L, before);
      }
    }
  }
});

test("null optional authority minima preserve the existing absent-setting behavior", () => {
  const L = postReview();
  for (const id of OWNER_RESTORE_CARDS) {
    L.skills[id].min_walkforward_n = null;
    L.skills[id].min_regime_n = null;
  }
  assert.equal(applyOwnerRestore(L, "STATUS_AND_STRIKE_CALIBRATION", NOW).outcome, "APPLIED");
});

test("a rewound upgrade clock refuses without creating an invalid marker", () => {
  for (const now of [NOW - 1, NaN, Infinity, -Infinity, 0]) {
    const L = postReview();
    applyOwnerRestore(L, "STATUS_ONLY", NOW);
    const before = clone(L);
    const r = applyOwnerRestore(L, "STATUS_AND_STRIKE_CALIBRATION", now);
    assert.equal(r.outcome, "REFUSED", `${now}`);
    assert.match(r.reason, /invalid clock/);
    assert.deepEqual(L, before);
  }
  const sameClock = postReview();
  applyOwnerRestore(sameClock, "STATUS_ONLY", NOW);
  assert.equal(applyOwnerRestore(sameClock, "STATUS_AND_STRIKE_CALIBRATION", NOW).outcome, "APPLIED");
});
