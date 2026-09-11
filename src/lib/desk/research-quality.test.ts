import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  COUNTABLE,
  EXCLUSIONS,
  exclusionReport,
  isCountable,
  qualityOf,
  rangeWindows,
  splitQuality,
  RESEARCH_VIEW,
  VALID_ONLY_SQL,
} from "./research-quality.ts";

const ms = (iso: string) => Date.parse(iso);

/** The eight windows the 2026-09-10 fault produced, in full. */
const BAD = [
  "2026-09-10T07:15:00Z", "2026-09-10T07:30:00Z", "2026-09-10T07:45:00Z", "2026-09-10T08:00:00Z",
  "2026-09-10T08:15:00Z", "2026-09-10T08:30:00Z", "2026-09-10T08:45:00Z", "2026-09-10T09:00:00Z",
];

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

test("the known block is excluded, and nothing either side of it is", () => {
  for (const iso of BAD) {
    const v = qualityOf(iso);
    assert.equal(v.quality, "excluded", `${iso} must not be countable`);
    assert.equal(v.rule, "2026-09-10-ticker-reuse");
    assert.match(v.why ?? "", /KXBTC15M-26SEP100300-00/);
  }
  // The 07:00 window is the legitimate one: its settlement really was its own.
  assert.equal(qualityOf("2026-09-10T07:00:00Z").quality, "valid");
  // And the desk resumed correctly at 09:15.
  assert.equal(qualityOf("2026-09-10T09:15:00Z").quality, "valid");
});

test("the range covers exactly the eight rows it claims to", () => {
  for (const x of EXCLUSIONS) {
    assert.equal(rangeWindows(x.from, x.to), x.windows, `${x.id} covers ${x.windows} windows`);
  }
  const only = EXCLUSIONS.find((x) => x.id === "2026-09-10-ticker-reuse");
  assert.ok(only);
  assert.equal(only.windows, 8);
});

test("a window with an unreadable close is suspect, never valid by default", () => {
  // A row whose own identity cannot be read must not be counted merely because
  // no rule happened to exclude it.
  assert.equal(qualityOf(null).quality, "suspect");
  assert.equal(qualityOf(undefined).quality, "suspect");
  assert.equal(qualityOf("not a date").quality, "suspect");
  assert.equal(isCountable(null), false);
  assert.equal(isCountable("not a date"), false);
});

test("only 'valid' is countable", () => {
  assert.deepEqual([...COUNTABLE], ["valid"]);
  assert.equal(isCountable("2026-09-11T12:00:00Z"), true);
  assert.equal(isCountable("2026-09-10T08:00:00Z"), false);
});

test("dates, numbers and ISO strings all resolve the same", () => {
  const iso = "2026-09-10T08:00:00Z";
  assert.equal(qualityOf(iso).quality, "excluded");
  assert.equal(qualityOf(ms(iso)).quality, "excluded");
  assert.equal(qualityOf(new Date(iso)).quality, "excluded");
});

// ---------------------------------------------------------------------------
// THE LEAK TEST. Excluded rows must not reach an aggregate.
// ---------------------------------------------------------------------------

test("LEAK: excluded rows cannot reach a hit rate, and the shortfall is stated", () => {
  // A believable aggregate: eight corrupted windows that all "won" (they carry
  // one UP settlement), plus four real windows split 2-2. Counted raw, the desk
  // looks like it hit 10 of 12 — 83%. It actually hit 2 of 4.
  type Row = { close: string; hit: boolean };
  const rows: Row[] = [
    ...BAD.map((close) => ({ close, hit: true })),
    { close: "2026-09-10T09:15:00Z", hit: true },
    { close: "2026-09-10T09:30:00Z", hit: true },
    { close: "2026-09-10T09:45:00Z", hit: false },
    { close: "2026-09-10T10:00:00Z", hit: false },
  ];
  const raw = rows.filter((r) => r.hit).length / rows.length;
  assert.equal(Math.round(raw * 100), 83, "the contaminated number");

  const split = splitQuality(rows, (r) => r.close);
  assert.equal(split.countable.length, 4);
  assert.equal(split.held.length, 8);
  const clean = split.countable.filter((r) => r.hit).length / split.countable.length;
  assert.equal(Math.round(clean * 100), 50, "the honest number");

  // A sample that shrank must say so, or an exclusion is indistinguishable from
  // a desk that simply traded less.
  assert.match(split.note, /8 of 12/);
  assert.match(split.note, /2026-09-10-ticker-reuse: 8/);
  assert.match(split.note, /remain readable for forensics/);
  for (const h of split.held) assert.equal(h.rule, "2026-09-10-ticker-reuse");
});

test("a clean sample says so rather than going quiet", () => {
  const split = splitQuality([{ c: "2026-09-11T12:00:00Z" }], (r) => r.c);
  assert.equal(split.held.length, 0);
  assert.match(split.note, /all 1 windows countable/);
});

test("the excluded rows are still reachable for forensics", () => {
  // The mechanism is a filter, not a deletion: the held list hands the rows back.
  const rows = BAD.map((close) => ({ close }));
  const split = splitQuality(rows, (r) => r.close);
  assert.equal(split.countable.length, 0);
  assert.equal(split.held.length, 8);
  assert.deepEqual(
    split.held.map((h) => h.row.close),
    BAD,
  );
});

test("the registry is reportable for the research API and the UI", () => {
  const rep = exclusionReport();
  assert.equal(rep.length, EXCLUSIONS.length);
  assert.equal(rep[0]!.id, "2026-09-10-ticker-reuse");
  assert.equal(rep[0]!.quality, "excluded");
  assert.ok(rep[0]!.why.length > 40, "a reason a later reader can act on");
});

// ---------------------------------------------------------------------------
// The registry and the migration must not drift apart.
// ---------------------------------------------------------------------------

test("the migration stamps exactly the ranges the registry declares", () => {
  const sql = readFileSync(new URL("../../../migrations/0024_desk_ledger_quality.sql", import.meta.url), "utf8");
  for (const x of EXCLUSIONS) {
    // Both bounds and the rule id must appear, or SQL aggregates and JS filters
    // would disagree about which windows are evidence.
    assert.ok(sql.includes(x.from.replace(".000Z", "Z")), `migration names ${x.from}`);
    assert.ok(sql.includes(x.to.replace(".000Z", "Z")), `migration names ${x.to}`);
    assert.ok(sql.includes(x.id), `migration names ${x.id}`);
  }
  // Additive only: the fault's evidence is the rows themselves.
  assert.doesNotMatch(sql, /\bdelete\s+from\s+desk_ledger\b/i);
  assert.doesNotMatch(sql, /\bdrop\s+(table|column)\b/i);
  // The update may only touch the two metadata columns.
  const setClause = /set\s+([\s\S]*?)\s+where/i.exec(sql)?.[1] ?? "";
  assert.match(setClause, /research_quality/);
  assert.doesNotMatch(setClause, /winner|settle_cents|entry_cents|ev_cents|official_value|chair_lean/);
  assert.match(sql, /add column if not exists/i, "idempotent");
});

test("the guard lives in one view, and the migration defines it that way", () => {
  assert.equal(VALID_ONLY_SQL, "research_quality = 'valid'");
  assert.equal(RESEARCH_VIEW, "desk_ledger_research");
  const sql = readFileSync(new URL("../../../migrations/0024_desk_ledger_quality.sql", import.meta.url), "utf8");
  // The view must read the bare table and apply exactly this predicate: a view
  // built on anything else would silently change what research counts.
  assert.match(sql, new RegExp(`create view ${RESEARCH_VIEW}\\s+as\\s+select \\* from desk_ledger where ${VALID_ONLY_SQL.replace(/[.*+?^$()|[\]\\]/g, "\\$&")}`));
  // Dropped first, because `select *` freezes the column list at creation time.
  assert.match(sql, new RegExp(`drop view if exists ${RESEARCH_VIEW}`));
});
