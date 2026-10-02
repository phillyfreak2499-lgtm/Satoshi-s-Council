/** EXECUTION_LAB_V1: pure, one-contract research; no production authority. */
import { takerFeeCents } from "./clock.ts";
import { sellableBid, type Entry, type PricePoint, type Side } from "./exit-arena.ts";

export const EXECUTION_LAB_ID = "EXECUTION_LAB_V1";
export const EXECUTION_ARMS = Object.freeze([
  { id: "GAIN10", label: "Sell at +10¢ price gain", rule: "bid >= entry + 10" },
  { id: "BELOW50", label: "Sell below 50¢ market midpoint", rule: "held midpoint < 50; sell at bid" },
  { id: "CLOSE120", label: "Exit at two minutes left", rule: "entry before T−120; first valid bid at/after T−120" },
  { id: "CLOSE60", label: "Exit at one minute left", rule: "entry before T−60; first valid bid at/after T−60" },
  { id: "LATE120", label: "Fresh entry in final two minutes", rule: "independent revalidation; HOLD; no early entry" },
  { id: "TRAIL5", label: "After +10¢, trail by 5¢", rule: "arm at entry + 10; exit 5 below highest observed bid" },
  { id: "NET10", label: "Sell at +10¢ after both fees", rule: "bid − entry − entry fee − exit fee >= 10" },
] as const);
export type ExecutionArm = typeof EXECUTION_ARMS[number]["id"];
export type ExecutionResult = {
  arm: ExecutionArm | "HOLD"; status: "SOLD" | "SETTLED" | "DATA_INVALID" | "NO_ENTRY";
  exit_t: number | null; exit_cents: number | null; net_cents: number | null;
  hold_cents: number | null; delta_cents: number | null; reason: string;
};
const round = (v: number) => Math.round(v * 10) / 10;

/** Bounded capture gaps are exclusions, never interpolated fills. A later gap
 * cannot invalidate a sale already witnessed on a complete prefix. */
export function evaluateExecution(
  arm: ExecutionArm | "HOLD", entry: Entry | null, closeMs: number,
  path: readonly PricePoint[], winner: Side,
): ExecutionResult {
  const empty = (status: ExecutionResult["status"], reason: string): ExecutionResult =>
    ({ arm, status, exit_t: null, exit_cents: null, net_cents: null, hold_cents: null, delta_cents: null, reason });
  if (!entry) return empty("NO_ENTRY", "no position; no exit");
  if (![entry.t, entry.cents, closeMs].every(Number.isFinite) ||
      entry.t < closeMs - 900_000 || entry.t >= closeMs || entry.cents < 80 || entry.cents >= 99 ||
      (entry.side !== "UP" && entry.side !== "DOWN") || (winner !== "UP" && winner !== "DOWN")) {
    return empty("DATA_INVALID", "invalid entry, floor, clock or official winner");
  }
  if (arm === "LATE120" && closeMs - entry.t > 120_000) return empty("DATA_INVALID", "late arm received early entry");
  const hold = round((entry.side === winner ? 100 : 0) - entry.cents - takerFeeCents(entry.cents));
  const settled = (): ExecutionResult => ({ arm, status: "SETTLED", exit_t: null, exit_cents: null,
    net_cents: hold, hold_cents: hold, delta_cents: 0, reason: "official settlement" });
  if (arm === "HOLD" || arm === "LATE120") return settled();
  // Sort a copy; duplicate timestamps must agree. Never inspect post-close data.
  const raw = path.filter(p => p.t >= entry.t && p.t < closeMs).slice().sort((a,b) => a.t-b.t);
  let last = entry.t, high = -Infinity, armed = false;
  let previous: PricePoint | null = null;
  for (const p of raw) {
    if (!Number.isFinite(p.t) || p.t - last > 10_000) return empty("DATA_INVALID", "capture gap exceeds 10 seconds");
    if (previous?.t === p.t) {
      if (previous.yes_bid !== p.yes_bid || previous.yes_ask !== p.yes_ask) return empty("DATA_INVALID", "conflicting same-time quotes");
      continue;
    }
    const bid = sellableBid(entry.side, p.yes_bid, p.yes_ask);
    if (bid == null) return empty("DATA_INVALID", "unusable observed book");
    last = p.t; previous = p;
    high = Math.max(high, bid);
    if (bid >= entry.cents + 10) armed = true;
    const mid = entry.side === "UP" ? (p.yes_bid + p.yes_ask)/2 : 100-(p.yes_bid+p.yes_ask)/2;
    const net = round(bid - entry.cents - takerFeeCents(entry.cents) - takerFeeCents(bid));
    const triggered = arm === "GAIN10" ? bid >= entry.cents + 10
      : arm === "BELOW50" ? mid < 50
      : arm === "CLOSE120" ? entry.t < closeMs - 120_000 && p.t >= closeMs - 120_000
      : arm === "CLOSE60" ? entry.t < closeMs - 60_000 && p.t >= closeMs - 60_000
      : arm === "TRAIL5" ? armed && bid <= high - 5
      : arm === "NET10" ? net >= 10 : false;
    if (triggered) return { arm, status: "SOLD", exit_t: p.t, exit_cents: bid,
      net_cents: net, hold_cents: hold, delta_cents: round(net-hold), reason: "first observed trigger; sellable bid; both fees" };
  }
  if (!raw.length || closeMs - last > 10_000) return empty("DATA_INVALID", "missing pre-close coverage");
  return settled();
}

/** Pure registration has no actuator; never promotes on a winning backtest. */
export const EXECUTION_PROTOCOL = Object.freeze({
  id: EXECUTION_LAB_ID, authority: "NONE", paper_only: true, contracts: 1,
  days: 21, floor_cents: 80, max_gap_ms: 10_000,
  no_reentry: true, no_auto_promotion: true, price_lane: "observed_bid",
  odds_proxy: "held_side_book_midpoint_not_calibrated_probability",
  rules_fingerprint: EXECUTION_ARMS.map(a=>`${a.id}:${a.rule}`).join("|"),
});
