/**
 * Counterfactual telemetry: what a rule WOULD have done, recorded beside what
 * the desk did. Nothing here decides; the production gate is untouched.
 *
 *   capCounterfactual   — a 92¢ hard cap on every actual or hypothetical opportunity
 *   gateVariants        — the flat 3¢ edge gate vs a price-aware threshold
 *   oracleCeiling       — EVALUATION ONLY: the net a perfect side-picker would have
 *                          made on the same opportunities. It reads the official
 *                          result and must never be imported by a live decision path;
 *                          a rail asserts that.
 *
 * Pure module.
 */
import { DEFAULT_FEE_ENGINE, feeCents, holdNetCents, realAskCents, type FeeEngineId } from "./fee-engine.ts";

export type Opportunity = {
  ticker: string;
  close_ms: number;
  side: "UP" | "DOWN";
  ask: number;
  /** Main-model edge after fee at decision time, cents; null when not recorded. */
  edge_cents: number | null;
  /** Was this an actual booked fill (true) or a hypothetical Chair opportunity (false)? */
  booked: boolean;
  official_winner: "UP" | "DOWN" | null;
};

export type CapResult = { cap_cents: number; considered: number; blocked: number; kept: number; net_without_cap: number; net_with_cap: number; net_change: number; blocked_net: number; blocked_wins: number; dd_without_cap: number; dd_with_cap: number; fee_engine: FeeEngineId };

function dd(nets: readonly number[]): number {
  let cum = 0, peak = 0, worst = 0;
  for (const n of nets) { cum += n; peak = Math.max(peak, cum); worst = Math.min(worst, cum - peak); }
  return Math.round(worst * 10) / 10;
}

/** A hard price cap: opportunities above `cap` are blocked; everything else is unchanged. */
export function capCounterfactual(opps: readonly Opportunity[], cap = 92, engine: FeeEngineId = DEFAULT_FEE_ENGINE): CapResult {
  const settled = opps.filter((o) => o.official_winner != null && realAskCents(o.ask));
  const netOf = (o: Opportunity) => holdNetCents(o.ask, o.side === o.official_winner, engine);
  const kept = settled.filter((o) => o.ask <= cap), blocked = settled.filter((o) => o.ask > cap);
  const all = settled.map(netOf), keptNets = kept.map(netOf), blockedNets = blocked.map(netOf);
  const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 10) / 10;
  return {
    cap_cents: cap, considered: settled.length, blocked: blocked.length, kept: kept.length,
    net_without_cap: sum(all), net_with_cap: sum(keptNets), net_change: Math.round((sum(keptNets) - sum(all)) * 10) / 10,
    blocked_net: sum(blockedNets), blocked_wins: blocked.filter((o) => o.side === o.official_winner).length,
    dd_without_cap: dd(all), dd_with_cap: dd(keptNets), fee_engine: engine,
  };
}

export type GateVariant = { id: string; label: string; threshold: (ask: number) => number };

/** The production rule and two price-aware alternatives. Shadow-computed only. */
export const GATE_VARIANTS: readonly GateVariant[] = Object.freeze([
  { id: "FLAT_3C", label: "production: edge ≥ 3¢ after fee at every price", threshold: () => 3 },
  { id: "QUARTER_OF_WIN", label: "edge ≥ 25% of the win payout (100 − ask − fee)", threshold: (ask: number) => 0.25 * (100 - ask - feeCents(ask)) },
  { id: "FEE_PLUS_2", label: "edge ≥ fee + 2¢", threshold: (ask: number) => feeCents(ask) + 2 },
]);

export type GateVariantResult = { id: string; admitted: number; net: number; wins: number; blocked_net: number; blocked: number };

/** Apply each variant to opportunities that carry a recorded edge. */
export function gateVariants(opps: readonly Opportunity[], engine: FeeEngineId = DEFAULT_FEE_ENGINE): GateVariantResult[] {
  const usable = opps.filter((o) => o.edge_cents != null && o.official_winner != null && realAskCents(o.ask));
  return GATE_VARIANTS.map((v) => {
    let admitted = 0, net = 0, wins = 0, blocked = 0, blockedNet = 0;
    for (const o of usable) {
      const n = holdNetCents(o.ask, o.side === o.official_winner, engine);
      if (o.edge_cents! >= v.threshold(o.ask)) { admitted += 1; net += n; if (n > 0) wins += 1; } else { blocked += 1; blockedNet += n; }
    }
    return { id: v.id, admitted, net: Math.round(net * 10) / 10, wins, blocked, blocked_net: Math.round(blockedNet * 10) / 10 };
  });
}

/**
 * EVALUATION ONLY. The net a rule would make with perfect side knowledge on the
 * same asks: the ceiling any gate can reach. Uses official results; never a
 * live-time feature. The rail `oracle-isolation` asserts no decision module
 * imports this file.
 */
export function oracleCeiling(opps: readonly Opportunity[], engine: FeeEngineId = DEFAULT_FEE_ENGINE): { n: number; ceiling_net: number; actual_net: number; pct_of_ceiling: number | null } {
  const settled = opps.filter((o) => o.official_winner != null && realAskCents(o.ask));
  let ceiling = 0, actual = 0;
  for (const o of settled) {
    const win = holdNetCents(o.ask, true, engine);
    ceiling += Math.max(0, win);
    actual += holdNetCents(o.ask, o.side === o.official_winner, engine);
  }
  return { n: settled.length, ceiling_net: Math.round(ceiling * 10) / 10, actual_net: Math.round(actual * 10) / 10, pct_of_ceiling: ceiling > 0 ? Math.round((1000 * actual) / ceiling) / 10 : null };
}
