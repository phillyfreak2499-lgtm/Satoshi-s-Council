import assert from "node:assert/strict";
import test from "node:test";
import {
  ERAS, allScope, bookSummary, chicagoDayEndMs, chicagoDayOf, chicagoDayStartMs, chicagoDaysScope, chicagoWeekKey, classifyRow,
  completedWeekScope, diffSurfaces, eraOf, inScope, rollingHoursScope, type LedgerRow,
} from "./economics-book.ts";
import { holdNetCents } from "./fee-engine.ts";

let seq = 0;
const row = (closeIso: string, extra: Partial<LedgerRow> = {}): LedgerRow => ({
  id: ++seq, ticker: `T${seq}`, close_ms: Date.parse(closeIso), graded_ms: Date.parse(closeIso) + 60_000, winner: "UP",
  official_value: 100, research_quality: "valid", chair_lean: "WAIT", entry_cents: null, settle_cents: null, ev_cents: null,
  entry_lean: null, entry_secs_left: null, shadow_entry_cents: null, shadow_ev_cents: null, ...extra,
});
const hold = (closeIso: string, ask: number, won: boolean, extra: Partial<LedgerRow> = {}): LedgerRow =>
  row(closeIso, { entry_cents: ask, settle_cents: won ? 100 : 0, ev_cents: holdNetCents(ask, won), entry_lean: "UP", ...extra });

test("eras come from the frozen constants and do not overlap", () => {
  assert.equal(eraOf(Date.parse("2026-09-06T00:00:00Z")), "A0_pre_floor");
  assert.equal(eraOf(Date.parse("2026-09-08T20:47:00Z")), "A1_floor70");
  assert.equal(eraOf(Date.parse("2026-09-10T23:00:00Z")), "B_floor80_trial");
  assert.equal(eraOf(Date.parse("2026-09-15T14:05:13Z")), "C1_selective_v1v2");
  assert.equal(eraOf(Date.parse("2026-09-17T12:09:31Z")), "C2_selective_v3");
  for (let i = 1; i < ERAS.length; i += 1) assert.equal(ERAS[i]!.since, ERAS[i - 1]!.until);
  assert.equal(ERAS[0]!.quantity, "legacy_mixed");
});

test("event classification separates legacy exits and scratches from HOLD settlements and never drops excluded rows", () => {
  assert.equal(classifyRow(hold("2026-09-12T00:00:00Z", 85, true)).event, "booked_settled");
  assert.equal(classifyRow(hold("2026-09-12T00:00:00Z", 85, false)).official_win, false);
  assert.equal(classifyRow(row("2026-09-06T00:00:00Z", { entry_cents: 74, settle_cents: 72, ev_cents: -1 })).event, "booked_legacy_exit");
  assert.equal(classifyRow(row("2026-09-06T00:00:00Z", { entry_cents: 57, settle_cents: 59, ev_cents: 0 })).event, "scratch");
  assert.equal(classifyRow(row("2026-09-12T00:00:00Z", { entry_cents: 85, settle_cents: 100, ev_cents: 3 })).event, "booked_legacy_exit");
  assert.equal(classifyRow(row("2026-09-12T00:00:00Z", { entry_cents: 85 })).event, "booked_pending");
  assert.equal(classifyRow(row("2026-09-12T00:00:00Z", { chair_lean: "UP" })).event, "chair_read_no_book");
  assert.equal(classifyRow(row("2026-09-12T00:00:00Z")).event, "no_decision");
  assert.equal(classifyRow(row("2026-09-10T08:00:00Z", { research_quality: "excluded" })).event, "excluded");
});

test("Chicago day boundaries are found, not assumed, and survive DST", () => {
  assert.equal(chicagoDayOf(Date.parse("2026-09-21T04:59:00Z")), "2026-09-20");
  assert.equal(chicagoDayOf(Date.parse("2026-09-21T05:00:00Z")), "2026-09-21");
  assert.equal(chicagoDayStartMs("2026-09-21"), Date.parse("2026-09-21T05:00:00Z"));
  assert.equal(chicagoDayEndMs("2026-09-21"), Date.parse("2026-09-22T05:00:00Z"));
  // Standard time: the day starts at 06:00Z.
  assert.equal(chicagoDayStartMs("2026-12-01"), Date.parse("2026-12-01T06:00:00Z"));
  // The fall-back day is 25 hours long.
  assert.equal(chicagoDayEndMs("2026-11-01") - chicagoDayStartMs("2026-11-01"), 25 * 3_600_000);
  assert.equal(chicagoWeekKey("2026-09-21"), "2026-09-21");
  assert.equal(chicagoWeekKey("2026-09-27"), "2026-09-21");
  assert.equal(chicagoWeekKey("2026-09-28"), "2026-09-28");
});

test("scopes: rolling 168h is half-open (as_of − 7d, as_of]; Chicago ranges are inclusive days; the completed week is Mon–Sun before as_of", () => {
  const asOf = Date.parse("2026-09-22T00:00:00Z");
  const w = rollingHoursScope(asOf, 168);
  assert.equal(inScope(row("2026-09-15T00:00:00Z"), w), false);
  assert.equal(inScope(row("2026-09-15T00:15:00Z"), w), true);
  assert.equal(inScope(row("2026-09-22T00:00:00Z"), w), true);
  assert.equal(inScope(row("2026-09-22T00:15:00Z"), w), false);
  const d = chicagoDaysScope("2026-09-15", "2026-09-21", asOf);
  assert.equal(inScope(row("2026-09-15T04:59:00Z"), d), false);
  assert.equal(inScope(row("2026-09-15T05:00:00Z"), d), true);
  assert.equal(inScope(row("2026-09-22T04:45:00Z"), d), true);
  assert.equal(inScope(row("2026-09-22T05:00:00Z"), d), false);
  const cw = completedWeekScope(asOf);
  assert.equal(cw.id, "completed_week_2026-09-14");
  assert.equal(inScope(row("2026-09-21T04:00:00Z"), cw), true);
  assert.equal(inScope(row("2026-09-21T06:00:00Z"), cw), false);
});

test("the book: identity, needed WR, drawdown order, censored recovery, tails labelled descriptive, legacy net kept apart", () => {
  const asOf = Date.parse("2026-09-22T00:00:00Z");
  const rows = [
    hold("2026-09-11T01:00:00Z", 80, true),
    hold("2026-09-11T02:00:00Z", 80, false),
    hold("2026-09-11T03:00:00Z", 85, true),
    hold("2026-09-11T04:00:00Z", 90, true),
    row("2026-09-11T05:00:00Z", { chair_lean: "UP" }),
    row("2026-09-11T06:00:00Z"),
    row("2026-09-06T00:00:00Z", { entry_cents: 74, settle_cents: 72, ev_cents: -1 }),
    row("2026-09-11T07:00:00Z", { entry_cents: 82, graded_ms: asOf + 1, settle_cents: 100, ev_cents: 17 }),
  ];
  const b = bookSummary(rows, allScope(asOf));
  assert.equal(b.windows, 8);
  assert.equal(b.settled_hold_fills, 4);
  assert.equal(b.legacy_exit_fills, 1);
  assert.equal(b.pending_fills, 1, "a grade after as_of is pending, not counted");
  assert.equal(b.pending_full_loss_exposure_cents, 84);
  assert.equal(b.official_wins, 3);
  assert.equal(b.official_wr_pct, 75);
  assert.equal(b.needed_wr_pct, 85.25); // (82+82+86+91)/4
  assert.equal(b.net_cents, 18 - 82 + 14 + 9);
  assert.equal(b.legacy_net_cents, -1);
  assert.equal(b.decisions, 7);
  assert.equal(b.identity_mismatches, 1);
  assert.equal(b.max_drawdown_cents, -82);
  assert.equal(b.time_to_recover.censored, true, "18 − 82 + 14 + 9 never regains the +18 peak");
  assert.equal(b.cvar5.descriptive, true);
  assert.equal(b.cvar5.value, -82);
  assert.equal(b.no_book_rate_pct, 25);
  assert.equal(b.by_era.find((e) => e.era === "A0_pre_floor")?.legacy, -1);
  assert.equal(b.entry_time_wait_rate_pct, null);
});

test("recovery is measured in hours from the peak when cumulative net regains it", () => {
  const asOf = Date.parse("2026-09-22T00:00:00Z");
  const rows = [
    hold("2026-09-11T01:00:00Z", 80, true), // +18 peak
    hold("2026-09-11T02:00:00Z", 80, false), // −82 → trough −64
    hold("2026-09-11T03:00:00Z", 90, true), // +9
    ...Array.from({ length: 9 }, (_, i) => hold(`2026-09-11T${String(4 + i).padStart(2, "0")}:00:00Z`, 90, true)), // +81 → regains at 12:00
  ];
  const b = bookSummary(rows, allScope(asOf));
  assert.equal(b.time_to_recover.censored, false);
  assert.equal(b.time_to_recover.hours, 11);
});

test("surface anti-joins name the discrepant rows by kind", () => {
  const a = [
    { key: "A|1", entry_cents: 80, settle_cents: 100, ev_cents: 18, fee_cents: 2 },
    { key: "B|1", entry_cents: 80, settle_cents: 100, ev_cents: 18, fee_cents: 2 },
    { key: "C|1", entry_cents: 80, settle_cents: null, ev_cents: null, fee_cents: 2 },
    { key: "D|1", entry_cents: 80, settle_cents: 100, ev_cents: 18, fee_cents: 2 },
    { key: "D|1", entry_cents: 80, settle_cents: 100, ev_cents: 18, fee_cents: 2 },
  ];
  const b = [
    { key: "A|1", entry_cents: 80, settle_cents: 100, ev_cents: 18, fee_cents: 2 },
    { key: "B|1", entry_cents: 81, settle_cents: 0, ev_cents: -83, fee_cents: 2 },
    { key: "C|1", entry_cents: 80, settle_cents: 100, ev_cents: 18, fee_cents: 2 },
    { key: "E|1", entry_cents: 80, settle_cents: 100, ev_cents: 19, fee_cents: 1 },
    { key: "D|1", entry_cents: 80, settle_cents: 100, ev_cents: 19, fee_cents: 1 },
  ];
  const d = diffSurfaces(a, b);
  assert.deepEqual(d.extra_in_b, ["E|1"]);
  assert.deepEqual(d.duplicate_in_a, ["D|1"]);
  assert.deepEqual(d.pending_in_one, ["C|1"]);
  assert.deepEqual(d.differently_graded, ["B|1"]);
  assert.deepEqual(d.differently_priced, ["B|1"]);
  assert.deepEqual(d.differently_fee_treated, ["D|1"]);
});
