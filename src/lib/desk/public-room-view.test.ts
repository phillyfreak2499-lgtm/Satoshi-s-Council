import assert from "node:assert/strict";
import test from "node:test";
import { cleanBoardBody, evidenceAge, labComparisons, pageIndex } from "./public-room-view.ts";
import type { PublicLabSpecimen } from "./lab-public";

const specimen = (id: string, extra: Partial<PublicLabSpecimen> = {}): PublicLabSpecimen => ({
  id, label: id, status: "COLLECTING", control: false, frozen_at: "2026-09-01T00:00:00Z",
  hypothesis: "fixture", sample_n: 5, net_cents: 0, avg_cents: null, profitable: 0, losing: 0,
  worst_cents: null, paired_n: 0, paired_delta: null, sample_gate: { current: 5, required: 250 }, ...extra,
});

test("pagination recovers when the final page disappears and handles empty lists", () => {
  assert.equal(pageIndex(13, 2, 6), 2);
  assert.equal(pageIndex(12, 2, 6), 1);
  assert.equal(pageIndex(0, 8, 6), 0);
  assert.equal(pageIndex(13, -2, 6), 0);
  assert.equal(pageIndex(13, NaN, 6), 0);
});

test("Lab comparison uses matched evidence even when unpaired averages imply the opposite", () => {
  const result = labComparisons([
    specimen("hold", { control: true, avg_cents: 20, sample_n: 100 }),
    specimen("candidate", { avg_cents: 30, sample_n: 5, paired_n: 5, paired_delta: -2.5 }),
  ], "hold");
  assert.equal(result.comparisons[0].delta, -2.5);
  assert.equal(result.comparisons[0].row.paired_n, 5);
  assert.equal(result.candidates.length, 1);
});

test("missing comparisons stay unknown while a measured zero remains zero", () => {
  const rows = [specimen("hold", { control: true }),
    specimen("missing", { paired_n: 0, paired_delta: 9 }),
    specimen("zero", { paired_n: 3, paired_delta: 0 }),
    specimen("invalid", { paired_n: 3, paired_delta: NaN })];
  assert.deepEqual(labComparisons(rows, "hold").comparisons.map((x) => x.delta), [null, 0, null]);
  assert.equal(labComparisons(rows.slice(1), "hold").comparisons[1].delta, null);
});

test("sample progress counts candidates only and does not mutate evidence", () => {
  const rows = [specimen("hold", { control: true, sample_gate: { current: 400, required: 250 } }),
    specimen("first", { sample_gate: { current: 250, required: 250 } }),
    specimen("second", { sample_gate: { current: 249, required: 250 } })];
  const before = structuredClone(rows);
  assert.equal(labComparisons(rows, "hold").reached, 1);
  assert.deepEqual(rows, before);
});

test("humanized evidence dates use the supplied snapshot and UTC at midnight boundaries", () => {
  assert.equal(evidenceAge("2026-09-14T01:00:00Z", "2026-09-14T03:00:00Z"), "2h ago");
  assert.equal(evidenceAge("2026-08-01T00:30:00Z", "2026-09-14T03:00:00Z"), "Aug 1, 2026");
  assert.equal(evidenceAge("invalid", "2026-09-14T03:00:00Z"), "invalid");
});

test("Board messages retain paragraphs, normalize controls and enforce the original length cap", () => {
  assert.equal(cleanBoardBody(" First\tline\r\n Second\u0000line \n\n\n Third "), "First line\nSecond line\n\nThird");
  assert.equal(cleanBoardBody(" \n \r\n "), "");
  assert.equal(cleanBoardBody("a".repeat(401)).length, 400);
  assert.equal(cleanBoardBody(null), "");
});
