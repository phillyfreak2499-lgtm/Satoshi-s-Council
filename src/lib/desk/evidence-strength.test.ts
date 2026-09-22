import assert from "node:assert/strict";
import test from "node:test";
import { evidenceStrength } from "./evidence-strength.ts";

test("17/17 and 19/19 are promising but insufficient against an 80¢-plus need; 86/86 at 82¢ clears it", () => {
  const a = evidenceStrength("PULSE.vol_lag_5m", 17, 17, 89.5);
  assert.equal(a.point_wr_pct, 100);
  assert.equal(a.wilson_lower_pct, 81.6);
  assert.equal(a.needed_wr_pct, 90.5);
  assert.equal(a.label, "PROMISING_INSUFFICIENT", "point 100% clears 90.5% but the lower bound 81.6% does not; n=17 is flagged small");
  assert.equal(a.small_n, true);
  const b = evidenceStrength("X", 19, 19, 82);
  assert.equal(b.label, "PROMISING_INSUFFICIENT");
  const c = evidenceStrength("STREAK@grade", 86, 86, 82.1);
  assert.equal(c.label, "LOWER_BOUND_CLEARS_NEED");
  assert.equal(c.small_n, false);
  assert.equal(evidenceStrength("Y", 5, 5, 85).label, "INSUFFICIENT_N");
  assert.equal(evidenceStrength("Z", 30, 40, 85).label, "BELOW_NEED");
});
