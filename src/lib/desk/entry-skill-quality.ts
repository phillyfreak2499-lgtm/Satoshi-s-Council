/** Official-result evaluation of immutable booked-entry reads. Research only. */
import type { EntrySkillRoster } from "./entry-skill-roster";

export const ENTRY_SKILL_QUALITY_VERSION = "ENTRY_SKILL_QUALITY_V1";

type Direction = "UP" | "DOWN";
type Observation = {
  seat: string; skill: string; role: "selected_raw" | "paper"; status: string;
  lean: Direction; signal_strength: number | null; hit: boolean;
  ask_cents: number | null; fee_cents: number | null; hypothetical_net_cents: number | null;
};

export type EntrySkillQuality = {
  version: typeof ENTRY_SKILL_QUALITY_VERSION;
  scope: "booked_paper_entry_official_result";
  ticker: string; close_time_ms: number; entry_at_ms: number;
  winner: Direction; booked_side: Direction; booked_net_cents: number;
  confidence_kind: "signal_strength_not_calibrated_probability";
  complete: boolean; missing: string[]; observations: Observation[];
};

const valid = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0 && v < 100;
const validFee = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const strength = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const round = (v: number): number => Math.round(v * 10) / 10;

/** V1 lacks the opposite-side book and is deliberately left unmeasured. */
export function evaluateEntrySkillQuality(
  roster: EntrySkillRoster | null | undefined, winner: Direction, source: string,
): EntrySkillQuality | null {
  if (!roster || roster.version !== "ENTRY_SKILL_ROSTER_V2" ||
      roster.scope !== "booked_paper_entry" || source !== "kalshi-result" ||
      !valid(roster.ask_cents) || !validFee(roster.fee_cents)) return null;
  const book = roster.book;
  if (!book || !Array.isArray(roster.seat_reads)) return null;
  const ask = (side: Direction): number | null => side === "UP" ? book.yes_ask_cents : book.no_ask_cents;
  const fee = (side: Direction): number | null => side === "UP" ? book.yes_fee_cents : book.no_fee_cents;
  if (ask(roster.side) !== roster.ask_cents || fee(roster.side) !== roster.fee_cents) return null;
  const missing: string[] = [];
  if (!valid(book.yes_ask_cents) || !validFee(book.yes_fee_cents)) missing.push("yes_quote_or_fee");
  if (!valid(book.no_ask_cents) || !validFee(book.no_fee_cents)) missing.push("no_quote_or_fee");
  const observations: Observation[] = [];
  const add = (seat: string, skill: string, role: Observation["role"], status: string, lean: string, signal: unknown) => {
    if (lean !== "UP" && lean !== "DOWN") return;
    const side = lean as Direction;
    const a = ask(side), f = fee(side);
    observations.push({ seat, skill, role, status, lean: side, signal_strength: strength(signal),
      hit: side === winner, ask_cents: valid(a) ? a : null,
      fee_cents: validFee(f) ? f : null,
      hypothetical_net_cents: valid(a) && validFee(f)
        ? round((side === winner ? 100 : 0) - a - f) : null });
  };
  for (const read of roster.seat_reads) {
    // A forced SIT still retains its raw selected read for research.
    add(read.seat, read.selected_skill, "selected_raw", read.selected_status,
      read.raw_lean, read.raw_confidence);
    const seen = new Set<string>();
    for (const paper of read.paper ?? []) {
      if (paper.id === read.selected_skill || seen.has(paper.id)) continue;
      seen.add(paper.id);
      add(read.seat, paper.id, "paper", paper.status, paper.lean, paper.confidence);
    }
  }
  return { version: ENTRY_SKILL_QUALITY_VERSION, scope: "booked_paper_entry_official_result",
    ticker: roster.ticker, close_time_ms: roster.close_time_ms, entry_at_ms: roster.entry_at_ms,
    winner, booked_side: roster.side,
    booked_net_cents: round((roster.side === winner ? 100 : 0) - roster.ask_cents - roster.fee_cents),
    confidence_kind: "signal_strength_not_calibrated_probability",
    complete: missing.length === 0, missing, observations };
}

/** Preexisting queued rows never gain a reconstructed quality receipt. */
export function withEntrySkillQualityColumn(values: unknown[]): unknown[] {
  return values.length === 43 ? [...values, null] : values;
}

