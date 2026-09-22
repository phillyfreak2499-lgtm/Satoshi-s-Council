import { enrichSnapshot } from "./features";
import { appendPeriod, deltaOver, FUNDING_PERIOD_MS, nativePeriodMs, OI_PERIOD_MS, valuesOf, type HistPoint } from "./hist";
import { emptyTally } from "./candle-time";
import type { PathPoint } from "./path-time";
import { basisBps, fundingApr } from "./units";
import type { FeedHealth, GapStatus, LiveBundle, Snapshot, WindowMemory } from "./types";

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
  const backup = b.spot_backup ?? prev?.spot_backup ?? 0;
  const perp = b.perp ?? prev?.perp ?? 0;
  const index_px = b.index_px ?? prev?.index_px ?? 0;
  const midPx = spot && backup ? (spot + backup) / 2 : spot;
  const divBps = midPx > 0 && backup > 0 ? (Math.abs(spot - backup) / midPx) * 10_000 : 0;
  const basis = basisBps(perp, spot);
  const strike =
    kalshi && kalshi.strike > 1000
      ? kalshi.strike
      : prev?.strike && prev.close_time === close
        ? prev.strike
        : Math.round(spot / 25) * 25;

  let yes_bid = kalshi?.yes_bid ?? 0;
  let yes_ask = kalshi?.yes_ask ?? 0;
  let no_bid = kalshi?.no_bid ?? 0;
  let no_ask = kalshi?.no_ask ?? 0;
  // Additive measurement lane; production decisions continue to use the four fields above.
  let yes_bid_exact = kalshi?.yes_bid_exact ?? yes_bid;
  let yes_ask_exact = kalshi?.yes_ask_exact ?? yes_ask;
  let no_bid_exact = kalshi?.no_bid_exact ?? no_bid;
  let no_ask_exact = kalshi?.no_ask_exact ?? no_ask;
  let yes_bid_size = kalshi?.yes_bid_size ?? 0;
  let no_bid_size = kalshi?.no_bid_size ?? 0;
  let yes_bid_size_exact = kalshi?.yes_bid_size_exact ?? yes_bid_size;
  let no_bid_size_exact = kalshi?.no_bid_size_exact ?? no_bid_size;
  let quote_ts = kalshi?.quote_ts ?? 0;
  let quote_seq = kalshi?.quote_seq ?? 0;
  let quote_age_s = kalshi?.quote_age_s ?? 999;
  let print_age_s = kalshi?.trade_ts ? Math.max(0, (now - kalshi.trade_ts) / 1000) : 999;
  const last_trade_id = kalshi?.last_trade_id ?? "";
  const held = Boolean(
    prev &&
      kalshi &&
      prev.ticker === kalshi.ticker &&
      prev.quote_seq > 0 &&
      quote_seq > 0 &&
      quote_seq < prev.quote_seq,
  );
  if (held && prev) {
    yes_bid = prev.yes_bid;
    yes_ask = prev.yes_ask;
    no_bid = prev.no_bid;
    no_ask = prev.no_ask;
    yes_bid_exact = prev.yes_bid_exact ?? prev.yes_bid;
    yes_ask_exact = prev.yes_ask_exact ?? prev.yes_ask;
    no_bid_exact = prev.no_bid_exact ?? prev.no_bid;
    no_ask_exact = prev.no_ask_exact ?? prev.no_ask;
    yes_bid_size = prev.yes_bid_size;
    no_bid_size = prev.no_bid_size;
    yes_bid_size_exact = prev.yes_bid_size_exact ?? prev.yes_bid_size;
    no_bid_size_exact = prev.no_bid_size_exact ?? prev.no_bid_size;
    quote_ts = prev.quote_ts;
    quote_seq = prev.quote_seq;
  }
  quote_age_s = quote_ts > 0 ? Math.max(0, (now - quote_ts) / 1000) : 999;
  if (held && prev) {
    print_age_s = prev.print_age_s + Math.max(0, (now - prev.as_of) / 1000);
  } else {
    print_age_s = kalshi?.trade_ts ? Math.max(0, (now - kalshi.trade_ts) / 1000) : 999;
  }

  const last_ok_ts =
    kalshi?.ok && !held ? kalshi.receipt_ts || now : (prev?.obs.last_ok_ts ?? 0);
  const last_ok_age_s = last_ok_ts > 0 ? Math.max(0, (now - last_ok_ts) / 1000) : 999;

  let gap: GapStatus = "ok";
  if (held) {
    gap = "held";
  } else if (prev && kalshi?.ok && quote_seq > 0 && prev.quote_seq > 0 && quote_seq > prev.quote_seq + 1) {
    gap = "gap";
  } else if (prev && kalshi?.ok && prev.health.kalshi === "DOWN") {
    gap = "reconnect";
  } else if (prev?.obs.last_ok_ts && kalshi?.ok && last_ok_ts - prev.obs.last_ok_ts > 15_000) {
    gap = "reconnect";
  }

  const yes_mid = yes_bid && yes_ask ? (yes_bid + yes_ask) / 2 : (prev?.yes_mid ?? 50);
  const candlePath = kalshi?.yes_path?.length ? kalshi.yes_path : [];
  const yes_mid_path = candlePath.length >= 4 ? candlePath.slice(-80) : [...(prev?.yes_mid_path ?? []), yes_mid].slice(-80);
  // The timestamped twin, branched on the SAME condition and the SAME array as the
  // line above, so the two paths are never built from different sources on one tick.
  // Deliberately keyed on `candlePath.length`, not on the timestamped array's length:
  // if candles arrived priced but unreadable for time, production still took the
  // candle branch, and the honest record of that is a thin timestamped path plus a
  // `candle_ts` tally explaining why - not a quietly substituted tick path.
  const candlePts = kalshi?.yes_path_pts ?? [];
  const yes_mid_path_pts: PathPoint[] =
    candlePath.length >= 4
      ? candlePts.slice(-80)
      : [...(prev?.yes_mid_path_pts ?? []), { t: now, px: yes_mid, source: "tick" as const }].slice(-80);
  const candle_ts = kalshi?.candle_ts ?? emptyTally();
  const imbDen = yes_bid_size + no_bid_size;
  const imbalance = imbDen > 0 ? (yes_bid_size - no_bid_size) / imbDen : 0;
  const imbalance_hist = [...(prev?.imbalance_hist ?? []), imbalance].slice(-20);

  const funding_series: HistPoint[] = b.funding_series?.length
    ? b.funding_series
    : appendPeriod(
        prev?.funding_series ?? [],
        b.funding_time || 0,
        b.funding_rate ?? prev?.funding_rate ?? 0,
        nativePeriodMs(prev?.funding_series ?? [], FUNDING_PERIOD_MS),
      );
  const oi_series: HistPoint[] = b.oi_series?.length
    ? b.oi_series
    : appendPeriod(
        prev?.oi_series ?? [],
        now,
        b.open_interest ?? prev?.open_interest ?? 0,
        OI_PERIOD_MS,
      );
  const oi_usd_series: HistPoint[] = b.oi_usd_series?.length
    ? b.oi_usd_series
    : appendPeriod(
        prev?.oi_usd_series ?? [],
        now,
        b.oi_usd ?? prev?.oi_usd ?? 0,
        OI_PERIOD_MS,
      );
  const funding_history = valuesOf(funding_series);
  const oi_history = valuesOf(oi_series);

  const last1m = b.klines_1m.length ? b.klines_1m[b.klines_1m.length - 1] : null;
  const printTs = last1m?.receipt_ts || b.receipt_ts || now;
  const printAge = Math.max(0, (now - printTs) / 1000);
  const spotAge = Number.isFinite(b.spot_age_s) ? Math.min(b.spot_age_s, printAge) : printAge;

  const spotHealth: FeedHealth =
    b.spot == null ? "DOWN" : divBps >= 80 ? "STALE" : ageHealth(spotAge, 8);
  const kalshiHealth: FeedHealth =
    gap === "gap" || gap === "held"
      ? "STALE"
      : !kalshi?.ok && last_ok_age_s > 25
        ? "DOWN"
        : ageHealth(last_ok_age_s, 25);
  const derivsHealth: FeedHealth =
    b.funding_rate == null && b.open_interest == null ? "DOWN" : "LIVE";

  const strikeSource = kalshi && kalshi.strike > 1000 ? "kalshi" : "PROXY round(spot)";

  const snap: Snapshot = {
    as_of: now,
    phase: "MID",
    mins_left: 0,
    secs_left: 0,
    close_time: close,
    ticker: kalshi?.ticker ?? prev?.ticker ?? "KXBTC15M-—",
    kalshi_host: kalshi?.host ?? prev?.kalshi_host ?? "",
    kalshi_trade_n: kalshi?.trade_n ?? prev?.kalshi_trade_n ?? 0,
    kalshi_taker_yes: kalshi?.taker_yes ?? prev?.kalshi_taker_yes ?? 0.5,
    official_settles: kalshi?.settles?.length ? kalshi.settles : (prev?.official_settles ?? []),
    spot,
    spot_source: b.spot_source,
    spot_age_s: spotAge,
    spot_backup: backup,
    spot_backup_source: b.spot_backup_source,
    spot_div_bps: divBps,
    perp,
    perp_source: b.perp_source || prev?.perp_source || "",
    index_px,
    basis_bps: basis,
    candles_1m: b.klines_1m.length ? b.klines_1m : (prev?.candles_1m ?? []),
    candles_5m: b.klines_5m,
    candles_15m: b.klines_15m,
    candles_1h: b.klines_1h,
    strike,
    strike_source: strikeSource,
    yes_bid,
    yes_ask,
    no_bid,
    no_ask,
    yes_bid_exact,
    yes_ask_exact,
    no_bid_exact,
    no_ask_exact,
    yes_bid_size_exact,
    no_bid_size_exact,
    leftover_cents: 0,
    combined_ask_cents: 0,
    spread_cents: 0,
    quote_age_s,
    quote_ts,
    quote_seq,
    print_age_s,
    last_trade_id,
    obs: {
      // quote_ts is the last-CHANGE clock, not a provider event time — named truthfully.
      quote_last_change_at: quote_ts,
      receipt_ts: kalshi?.receipt_ts || b.receipt_ts || now,
      last_ok_ts,
      seq: quote_seq,
      gap,
      source: kalshi?.host || b.spot_source || "none",
      ticker: kalshi?.ticker ?? prev?.ticker ?? "KXBTC15M-—",
    },
    yes_mid,
    yes_mid_path,
    yes_mid_path_pts,
    candle_ts,
    funding_rate: b.funding_rate ?? prev?.funding_rate ?? 0,
    funding_apr: fundingApr(b.funding_rate ?? prev?.funding_rate ?? 0) || 0,
    funding_time: b.funding_time ?? prev?.funding_time ?? 0,
    funding_history,
    funding_series,
    open_interest: b.open_interest ?? prev?.open_interest ?? 0,
    oi_usd: b.oi_usd ?? prev?.oi_usd ?? 0,
    oi_history,
    oi_series,
    oi_usd_series,
    oi_delta_3m: deltaOver(oi_series, 3 * 60_000, now),
    oi_delta_10m: deltaOver(oi_series, 10 * 60_000, now),
    oi_delta_1h: deltaOver(oi_series, 60 * 60_000, now),
    oi_usd_delta_10m: deltaOver(oi_usd_series, 10 * 60_000, now),
    liq_long_usd: b.liq_n > 0 ? b.liq_long_usd : (prev?.liq_long_usd ?? 0),
    liq_short_usd: b.liq_n > 0 ? b.liq_short_usd : (prev?.liq_short_usd ?? 0),
    liq_n: b.liq_n > 0 ? b.liq_n : (prev?.liq_n ?? 0),
    liq_source: b.liq_source && b.liq_source !== "DOWN" ? b.liq_source : (prev?.liq_source && prev.liq_n > 0 ? prev.liq_source : "DOWN"),
    force_n: b.liq_n > 0 ? b.liq_n : (prev?.force_n ?? 0),
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
      spot_divergent: divBps >= 25,
      basis_wide: Math.abs(basis) >= 25,
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
    yes_bid_size,
    no_bid_size,
    spot_lead_bps: 0,
    chalk: false,
    fair_yes: 50,
    edge_up: 0,
    edge_down: 0,
    fee_yes: 2,
    fee_no: 2,
    lab_fair_yes: null,
    lab_locked: 0,
    lab_age_s: 999,
  };
  return enrichSnapshot(snap);
}
