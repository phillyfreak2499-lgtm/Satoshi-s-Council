import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { bookable, bookableShadow, paperBookEdgeOk, paperBookTeamOk } from "./book-floor.ts";
import { takerFeeCents } from "./clock.ts";
import { markSide } from "./scalp.ts";
import { captureEntrySkillRoster } from "./entry-skill-roster.ts";
import {
  chicagoDay, dailyAdmission, hasPaperPosition, restoreRiskCalls, selectiveBlock, selectiveBookOk,
  selectiveChair, settleRiskCalls, SELECTIVE_PARAMS, type SelectiveContext,
  profitRiskBlock,
} from "./selective-entry.ts";
import type { CallLogRow, ChairResult, SeatId, Snapshot, Vote } from "./types";

const now = Date.parse("2026-09-16T15:05:00Z");
const snap = (extra: Partial<Snapshot> = {}): Snapshot => ({
  as_of: now, close_time: now + 600_000, ticker: "KXBTC15M-26SEP161015-15", mins_left: 10, secs_left: 600,
  yes_ask: 82, yes_bid: 81, no_ask: 19, no_bid: 18, no_bid_size: 5, yes_bid_size: 7,
  edge_up: 6, edge_down: -8, fair_yes: 90, fee_yes: 2, fee_no: 2,
  spread_cents: 1, leftover_cents: -1, spot_age_s: 1, lab_fair_yes: 90, lab_age_s: 1,
  obs: { receipt_ts: now - 1000, gap: "ok" },
  health: { spot_ok: true, kalshi_ok: true, spot: "LIVE", kalshi: "LIVE", spot_divergent: false, basis_wide: false },
  ...extra,
} as Snapshot);
const chair = (extra: Partial<ChairResult> = {}): ChairResult => ({
  lean: "UP", score: 0.8, bar: 0.5, hard_fail: false, confidence: 80, calc: "test", gates: [],
  quorum: { up: 3, down: 0, wait: 15 },
  rows: (["STREAK", "STRIKE", "CARRY"] as SeatId[]).map(seat => ({ seat, lean: "UP", health: "LIVE", status: "LIVE", folded: false })),
  ...extra,
} as ChairResult);
const ctx = (extra: Partial<SelectiveContext> = {}): SelectiveContext => ({ calls: [], ready: true, start: now - 86_400_000, watch: null, ...extra });
const row = (t = now - 3_600_000, settle: number | null = 100): CallLogRow => ({
  id: `id-${t}`, ticker: `window-${t}`, t, close_time: t + 900_000, lean: "UP", cents: 82, settle, flipped: false,
});
const confirmed = (s = snap()): SelectiveContext => ctx({ watch: {
  key: `${s.ticker}|${s.close_time}`, side: "UP", since: s.as_of - 8000, last: s.as_of, frames: 3, mode: "normal",
} });
