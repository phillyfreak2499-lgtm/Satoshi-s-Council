/**
 * Liquidation pack: existing selection behavior, plus a parallel measurement clock.
 *
 * BEHAVIOR CLOCK (`t` / `now()`):
 *   valid e.t  → t = e.t
 *   else       → t = now()     // same Date.now() call sites as the old packLiq
 * Used for dedup, sort, 15-minute cutoff, last-8 fallback, USD sums, n.
 *
 * MEASUREMENT CLOCK (`provider_t`):
 *   finite e.t > 0 → provider_t = e.t
 *   else           → provider_t = 0
 * Never filled from now() / receipt / HTTP Date / as_of.
 *
 * Pack `last_t` after this module:
 *   0  = freshness unknown (empty set, or any selected contributor lacks provider_t)
 *   >0 = max original provider event time of the selected set (may be old, or future)
 *
 * MEASUREMENT ONLY. Do not feed last_t into CASCADE / seats / Chair.
 */

export type LiqEvent = { t: number; usd: number; side: "long" | "short"; venue: string };

export type LiqPack = {
  longUsd: number;
  shortUsd: number;
  n: number;
  source: string;
  last_t: number;
};

type Clock = () => number;

function providerT(raw: number): number {
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/**
 * @param now injected clock FUNCTION, default Date.now. Invoked at the same
 *   logical places the old inlined pack invoked Date.now(): cutoff first,
 *   then once per undated event. Do not sample once and reuse.
 */
export function packLiq(
  events: LiqEvent[],
  source: string,
  windowMs = 15 * 60_000,
  now: Clock = Date.now,
): LiqPack | null {
  if (!events.length) return null;
  const cutoff = now() - windowMs;
  const seen = new Set<string>();
  const uniq: Array<LiqEvent & { provider_t: number }> = [];
  for (const e of events) {
    const provider_t = providerT(e.t);
    const t = e.t > 0 ? e.t : now();
    if (!Number.isFinite(e.usd) || e.usd <= 0) continue;
    const key = `${e.venue ?? ""}|${t}|${e.side}|${Math.round(e.usd)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push({ ...e, t, provider_t });
  }
  uniq.sort((a, b) => a.t - b.t);
  const recent = uniq.filter((e) => e.t >= cutoff);
  const use = recent.length ? recent : uniq.slice(-8);
  if (!use.length) return null;
  let longUsd = 0;
  let shortUsd = 0;
  for (const e of use) {
    if (e.side === "long") longUsd += e.usd;
    else shortUsd += e.usd;
  }
  const last_t = use.every((e) => e.provider_t > 0) ? Math.max(...use.map((e) => e.provider_t)) : 0;
  return { longUsd, shortUsd, n: use.length, source, last_t };
}

/** Serialize-time age. Unknown → null. Future provider t → negative. No 999, no clamp. */
export function liqAgeS(last_t: number, as_of: number): number | null {
  if (!(last_t > 0)) return null;
  return (as_of - last_t) / 1000;
}

/**
 * Empty-poll hold: when the new pack has n===0, keep previous USD/n/source/last_t.
 * last_t is never replaced with as_of.
 */
export function holdLiqFields(
  incoming: { liq_long_usd: number; liq_short_usd: number; liq_n: number; liq_source: string; liq_last_t: number },
  prev: { liq_long_usd: number; liq_short_usd: number; liq_n: number; liq_source: string; liq_last_t: number } | null,
): { liq_long_usd: number; liq_short_usd: number; liq_n: number; liq_source: string; liq_last_t: number } {
  if (incoming.liq_n > 0) {
    return {
      liq_long_usd: incoming.liq_long_usd,
      liq_short_usd: incoming.liq_short_usd,
      liq_n: incoming.liq_n,
      liq_source: incoming.liq_source,
      liq_last_t: incoming.liq_last_t,
    };
  }
  if (prev && prev.liq_n > 0) {
    return {
      liq_long_usd: prev.liq_long_usd,
      liq_short_usd: prev.liq_short_usd,
      liq_n: prev.liq_n,
      liq_source: prev.liq_source,
      liq_last_t: prev.liq_last_t,
    };
  }
  return {
    liq_long_usd: incoming.liq_long_usd,
    liq_short_usd: incoming.liq_short_usd,
    liq_n: incoming.liq_n,
    liq_source: incoming.liq_source && incoming.liq_source !== "DOWN" ? incoming.liq_source : "DOWN",
    liq_last_t: incoming.liq_last_t,
  };
}
