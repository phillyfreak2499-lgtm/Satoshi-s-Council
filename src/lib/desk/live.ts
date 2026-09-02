import { enrichSnapshot } from "./features";
import type { FeedHealth, LiveBundle, Snapshot, WindowMemory } from "./types";

function ageHealth(age: number, liveMax: number): FeedHealth {
  if (!Number.isFinite(age) || age > liveMax * 20) return "DOWN";
  if (age <= liveMax) return "LIVE";
  return "STALE";
}

export function bundleToSnapshot(
  b: LiveBundle,
  memory: WindowMemory,
  prev: Snapshot | null,
): Snapshot {
  const now = b.as_of;
  const kalshi = b.kalshi;
  const close =
    kalshi?.close_time && kalshi.close_time > now
      ? kalshi.close_time
      : Math.ceil(now / (15 * 60_000)) * 15 * 60_000;
  const spot = b.spot ?? prev?.spot ?? 0;
  const strike =
    kalshi && kalshi.strike > 1000
      ? kalshi.strike
      : (prev?.strike && prev.close_time === close ? prev.strike : Math.round(spot / 25) * 25);

  const yes_bid = kalshi?.yes_bid ?? 0;
  const yes_ask = kalshi?.yes_ask ?? 0;
  const no_bid = kalshi?.no_bid ?? 0;
  const no_ask = kalshi?.no_ask ?? 0;
  const yes_mid = yes_bid && yes_ask ? (yes_bid + yes_ask) / 2 : prev?.yes_mid ?? 50;
  const yes_mid_path = [...(prev?.yes_mid_path ?? []), yes_mid].slice(-80);
  const imbDen = (kalshi?.yes_bid_size ?? 0) + (kalshi?.no_bid_size ?? 0);
  const imbalance = imbDen > 0 ? ((kalshi!.yes_bid_size - kalshi!.no_bid_size) / imbDen) : 0;
  const imbalance_hist = [...(prev?.imbalance_hist ?? []), imbalance].slice(-20);

  const funding_history = [
    ...(prev?.funding_history ?? []),
    ...(b.funding_rate != null ? [b.funding_rate] : []),
  ].slice(-16);
  const oi_history = [
    ...(prev?.oi_history ?? []),
    ...(b.open_interest != null ? [b.open_interest] : []),
  ].slice(-16);

  const spotHealth: FeedHealth =
    b.spot == null ? "DOWN" : ageHealth(b.spot_age_s, 8);
  const kalshiHealth: FeedHealth = !kalshi?.ok
    ? "DOWN"
    : ageHealth(kalshi.quote_age_s, 25);
  const derivsHealth: FeedHealth =
    b.funding_rate == null && b.open_interest == null ? "DOWN" : "LIVE";

  const strikeSource =
    kalshi && kalshi.strike > 1000 ? "kalshi" : "PROXY round(spot)";

  const snap: Snapshot = {
    as_of: now,
    phase: "MID",
    mins_left: 0,
    secs_left: 0,
    close_time: close,
    ticker: kalshi?.ticker ?? "KXBTC15M-—",
    spot,
    spot_source: b.spot_source,
    spot_age_s: b.spot_age_s,
    candles_1m: b.klines_1m,
    candles_5m: b.klines_5m,
    candles_15m: b.klines_15m,
    candles_1h: b.klines_1h,
    strike,
    strike_source: strikeSource,
    yes_bid,
    yes_ask,
    no_bid,
    no_ask,
    leftover_cents: 0,
    combined_ask_cents: 0,
    spread_cents: 0,
    quote_age_s: kalshi?.quote_age_s ?? 999,
    yes_mid,
    yes_mid_path,
    funding_rate: b.funding_rate ?? prev?.funding_rate ?? 0,
    funding_history,
    open_interest: b.open_interest ?? prev?.open_interest ?? 0,
    oi_history,
    oi_delta_3m: (oi_history.at(-1) ?? 0) - (oi_history.at(-3) ?? oi_history.at(-1) ?? 0),
    oi_delta_10m: (oi_history.at(-1) ?? 0) - (oi_history[0] ?? 0),
    oi_delta_1h: (oi_history.at(-1) ?? 0) - (oi_history[0] ?? 0),
    liq_long_usd: 0,
    liq_short_usd: 0,
    force_n: 0,
    cascade_proxy: false,
    fear_greed: b.fear_greed ?? prev?.fear_greed ?? 50,
    fear_greed_label: b.fear_greed_label || prev?.fear_greed_label || "",
    fng_history: b.fng_history.length ? b.fng_history : (prev?.fng_history ?? []),
    health: {
      spot_ok: spotHealth === "LIVE",
      kalshi_ok: kalshiHealth === "LIVE",
      derivs_ok: derivsHealth === "LIVE",
      derivs_source: derivsHealth === "DOWN" ? "DOWN" : "okx",
      spot: spotHealth,
      kalshi: kalshiHealth,
      derivs: derivsHealth,
    },
    window_memory: memory,
    regime_key: "",
    clock_key: "",
    session: "US_AM",
    demo: false,
    ret5: 0,
    ret15: 0,
    ret30: 0,
    ret1h: 0,
    atr: 0,
    atr_pct: 0,
    vol_median: 0,
    vol_last: 0,
    vol_percentile: 0,
    location: "MID",
    range_pos: 0.5,
    imbalance,
    imbalance_hist,
    yes_bid_size: kalshi?.yes_bid_size ?? 0,
    no_bid_size: kalshi?.no_bid_size ?? 0,
    spot_lead_bps: 0,
    chalk: false,
  };
  return enrichSnapshot(snap);
}
