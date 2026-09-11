import { test } from "node:test";
import assert from "node:assert/strict";
import { ERAS, QTY_FIX_AT, QTY_FIX_MS, eraAt, splitByEra, usableFor } from "./research-era.ts";

test("the boundary is the moment the fix reached production", () => {
  assert.equal(QTY_FIX_AT, "2026-09-11T03:47:17.000Z");
  assert.equal(eraAt(QTY_FIX_MS - 1), "pre-qty-fix");
  assert.equal(eraAt(QTY_FIX_MS), "post-qty-fix", "the boundary instant belongs to the clean era");
  assert.equal(eraAt(QTY_FIX_MS + 1), "post-qty-fix");
});

test("a moment can be given as ms, an ISO string or a Date", () => {
  for (const t of [QTY_FIX_MS + 1000, "2026-09-11T04:00:00Z", new Date(QTY_FIX_MS + 1000)]) {
    assert.equal(eraAt(t), "post-qty-fix");
  }
  assert.equal(eraAt("2026-09-10T00:00:00Z"), "pre-qty-fix");
});

test("an unreadable timestamp falls to the unusable era, never the clean one", () => {
  // Guessing "clean" on a broken stamp would quietly admit a bad row.
  assert.equal(eraAt(NaN), "pre-qty-fix");
  assert.equal(eraAt("not a date"), "pre-qty-fix");
});

test("the earlier era is marked as unusable for sizes, with the reason attached", () => {
  assert.equal(ERAS["pre-qty-fix"].sizes_usable, false);
  assert.equal(ERAS["post-qty-fix"].sizes_usable, true);
  assert.match(ERAS["pre-qty-fix"].why, /89\.4%/);
  assert.match(ERAS["pre-qty-fix"].why, /is not repaired/);
  assert.equal(ERAS["pre-qty-fix"].until, QTY_FIX_AT);
  assert.equal(ERAS["post-qty-fix"].since, QTY_FIX_AT);
});

test("a split keeps the two eras apart and never concatenates them", () => {
  const rows = [
    { t: "2026-09-10T12:00:00Z", v: 1 },
    { t: "2026-09-11T03:47:16Z", v: 2 },
    { t: "2026-09-11T03:47:17Z", v: 3 },
    { t: "2026-09-11T09:00:00Z", v: 4 },
  ];
  const s = splitByEra(rows, (r) => r.t);
  assert.deepEqual(s.pre.map((r) => r.v), [1, 2]);
  assert.deepEqual(s.post.map((r) => r.v), [3, 4]);
  // There is no field holding both, so a caller cannot reach for one by accident.
  assert.ok(!("all" in s));
  assert.ok(!Array.isArray(s));
});

test("the split carries its own warning, for a caller that never opens the module", () => {
  const s = splitByEra([{ t: "2026-09-10T00:00:00Z" }], (r) => r.t);
  assert.match(s.note, new RegExp(QTY_FIX_AT));
  assert.match(s.note, /never\s+added together/);
  assert.match(s.note, /unusable in the earlier set/);
});

test("a size-dependent study sees only the clean era, and is told what it lost", () => {
  const s = splitByEra(
    [
      ...Array.from({ length: 900 }, () => ({ t: "2026-09-10T00:00:00Z" })),
      ...Array.from({ length: 12 }, () => ({ t: "2026-09-11T05:00:00Z" })),
    ],
    (r) => r.t,
  );
  const u = usableFor(s, true);
  assert.equal(u.n, 12, "900 contaminated rows must not be counted");
  assert.equal(u.discarded, 900);
  assert.equal(u.era, "post-qty-fix");
  assert.match(u.why, /left in place and left out/);
});

test("a study that reads no size keeps both eras, because nothing changed for it", () => {
  const s = splitByEra(
    [{ t: "2026-09-10T00:00:00Z" }, { t: "2026-09-11T05:00:00Z" }],
    (r) => r.t,
  );
  const u = usableFor(s, false);
  assert.equal(u.n, 2);
  assert.equal(u.discarded, 0);
  assert.equal(u.era, "both");
  assert.match(u.why, /reads no order-book size/);
});

test("an empty history reports zero rather than pretending to a clean sample", () => {
  const s = splitByEra([] as { t: string }[], (r) => r.t);
  const u = usableFor(s, true);
  assert.equal(u.n, 0);
  assert.equal(u.discarded, 0);
});
