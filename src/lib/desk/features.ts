import type { Snapshot } from "./types";
import {
  aggregate,
  atr,
  locationOf,
  median,
  phaseOf,
  ret,
  sessionOf,
  volPercentile,
} from "./math";

export function enrichSnapshot(s: Snapshot): Snapshot {
  const c1 = s.candles_1m;
  s.candles_5m = s.candles_5m.length ? s.candles_5m : aggregate(c1, 5 * 60_000);
  s.candles_15m = s.candles_15m.length ? s.candles_15m : aggregate(c1, 15 * 60_000);
  s.candles_1h = s.candles_1h.length ? s.candles_1h : aggregate(c1, 60 * 60_000);

  s.ret5 = ret(c1, 5);
  s.ret15 = ret(c1, 15);
  s.ret30 = ret(c1, 30);
  s.ret1h = ret(c1, 60);
  s.atr = atr(c1, 14);
  s.atr_pct = s.spot > 0 ? (s.atr / s.spot) * 100 : 0;
  const vols = c1.slice(-30).map((c) => c.volume);
  s.vol_last = vols.at(-1) ?? 0;
  s.vol_median = median(vols);
  s.vol_percentile = volPercentile(vols, s.vol_last);
  const loc = locationOf(c1);
  s.location = loc.location;
  s.range_pos = loc.range_pos;

  const den = s.yes_bid_size + s.no_bid_size;
  s.imbalance = den > 0 ? (s.yes_bid_size - s.no_bid_size) / den : 0;

  s.secs_left = Math.max(0, (s.close_time - s.as_of) / 1000);
  s.mins_left = s.secs_left / 60;
  s.phase = phaseOf(s.mins_left);
  s.session = sessionOf(s.as_of);
  s.regime_key = `${s.session}_${s.phase}`;
  s.clock_key = `${s.session}_${new Date(s.as_of).getUTCDay()}`;
  s.chalk = s.yes_ask >= 99 || s.no_ask >= 99;
  s.combined_ask_cents = s.yes_ask + s.no_ask;
  s.leftover_cents = 100 - s.combined_ask_cents;
  s.spread_cents = Math.max(0, s.yes_ask - s.yes_bid);
  s.yes_mid = (s.yes_bid + s.yes_ask) / 2;

  const spotLeadRet = ret(c1, 1);
  const path = s.yes_mid_path;
  const yesDelta =
    path.length >= 2 ? path[path.length - 1]! - path[Math.max(0, path.length - 4)]! : 0;
  s.spot_lead_bps = spotLeadRet * 10_000 - yesDelta * 2;

  const volRatio = s.vol_median > 0 ? s.vol_last / s.vol_median : 1;
  s.cascade_proxy = volRatio > 2.2 && Math.abs(s.ret5) > 0.002 && s.oi_delta_10m < 0;
  const closed1m = c1.filter((c) => c.closed).slice(-6);
  s.force_n = closed1m.filter((c) => s.vol_median > 0 && c.volume / s.vol_median >= 1.8).length;

  return s;
}
