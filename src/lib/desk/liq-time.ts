/**
 * Liquidation freshness — measurement clock only.
 *
 * packLiq in server-feeds.ts still selects events with the behavioral t
 * (`e.t > 0 ? e.t : Date.now()`). These helpers never participate in that
 * selection. They answer: "do we have a trustworthy vendor event time for
 * every contributor that made the pack?"
 */

export type LiqTiming = { provider_t?: number };

/**
 * Trustworthy provider event time of the newest selected contributor.
 *
 * 0 when the set is empty OR any selected contributor lacks a valid
 * original vendor stamp. Never Date.now(), receipt, or as_of.
 */
export function trustedLiqLastT(selected: readonly LiqTiming[]): number {
  if (!selected.length) return 0;
  let max = 0;
  for (const e of selected) {
    const t = e.provider_t;
    if (!(typeof t === "number") || !Number.isFinite(t) || t <= 0) return 0;
    if (t > max) max = t;
  }
  return max;
}

/**
 * Age in seconds of a trusted last_t against as_of.
 * 0 last_t → null (unknown). Future last_t → negative. No 999. No clamp.
 */
export function liqAgeSeconds(liq_last_t: number, as_of: number): number | null {
  if (!(liq_last_t > 0) || !Number.isFinite(liq_last_t) || !Number.isFinite(as_of)) return null;
  return (as_of - liq_last_t) / 1000;
}

/** Empty-poll hold: keep previous last_t with previous USD/n/source. */
export function holdLiqLastT(liveN: number, liveLastT: number, prevLastT: number): number {
  return liveN > 0 ? liveLastT : prevLastT;
}
