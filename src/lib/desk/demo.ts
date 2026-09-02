import { enrichSnapshot } from "./features";
import { clamp, last, round, seeded } from "./math";
import type { Candle, Snapshot, WindowMemory } from "./types";

function candle(
  t: number,
  open: number,
  close: number,
  vol: number,
  wickBias = 0,
  closed = true,
): Candle {
  const bodyHi = Math.max(open, close);
  const bodyLo = Math.min(open, close);
  const range = Math.max(8, Math.abs(close - open) * 1.8 + 12);
  const upW = wickBias > 0 ? range * 0.7 : range * 0.18;
  const dnW = wickBias < 0 ? range * 0.7 : range * 0.18;
  return {
    t,
    open,
    close,
    high: bodyHi + upW,
    low: bodyLo - dnW,
    volume: vol,
    closed,
  };
}

export type DemoState = {
  seed: number;
  open_spot: number;
  strike: number;
  close_time: number;
  start_time: number;
  candles: Candle[];
  funding: number;
  oi: number;
  fng: number;
  yes_path: number[];
  imbalance_hist: number[];
  oi_hist: number[];
  funding_hist: number[];
  fng_hist: number[];
  scenario: "grind" | "rip" | "quiet";
  vol_med: number;
};

function pickScenario(rng: () => number): DemoState["scenario"] {
  const r = rng();
  if (r < 0.45) return "grind";
  if (r < 0.75) return "rip";
  return "quiet";
}

export function newDemoWindow(memory: WindowMemory, remainingMs?: number): DemoState {
  const seed = (Math.floor(Date.now() / 1000) ^ 0x9e3779b9) >>> 0;
  const rng = seeded(seed);
  const now = Date.now();
  const remain =
    remainingMs ??
    (memory.prior_settles.length === 0 ? 7 * 60_000 + 20_000 : 15 * 60_000);
  const close_time = now + remain;
  const start_time = close_time - 15 * 60_000;
  const open_spot = 108_000 + Math.round(rng() * 800);
  const strike = Math.round(open_spot / 25) * 25 - 25 + Math.round(rng() * 2) * 25;
  const scenario = pickScenario(rng);
  const vol_med = scenario === "quiet" ? 18 : 42;
  const candles: Candle[] = [];
  let px = open_spot - (rng() - 0.5) * 180;
  const drift =
    scenario === "grind" ? 0.00007 : scenario === "rip" ? 0.00002 : 0.000005;
  for (let i = 90; i >= 1; i--) {
    const t = now - i * 60_000;
    const shock = (rng() + rng() + rng() - 1.5) * (scenario === "quiet" ? 0.00045 : 0.00115);
    const next = px * (1 + drift + shock);
    const vol = vol_med * (0.5 + rng() * 1.4);
    let wick = 0;
    if (i === 1 && scenario === "grind") wick = 1;
    candles.push(candle(t, px, next, vol, wick, true));
    px = next;
  }
  const lastT = candles.at(-1)?.t ?? now - 60_000;
  candles.push(candle(lastT + 60_000, px, px, vol_med, 0, false));

  const dist = px - strike;
  const pYes = 1 / (1 + Math.exp(-dist / 90));
  const yes0 = clamp(Math.round(pYes * 100), 18, 82);
  const yes_path: number[] = [];
  let y = yes0 - 6;
  for (let i = 0; i < 40; i++) {
    y = clamp(y + (rng() - 0.45) * (scenario === "rip" ? 3.2 : 1.1), 12, 88);
    yes_path.push(round(y, 1));
  }
  if (scenario === "rip") {
    const last8 = yes_path.slice(-4);
    const bump = 10 + rng() * 4;
    for (let i = 0; i < last8.length; i++) {
      yes_path[yes_path.length - 4 + i] = clamp(
        yes_path[yes_path.length - 4 + i]! + bump * ((i + 1) / 4),
        8,
        92,
      );
    }
  }

  const funding =
    scenario === "grind"
      ? 0.00032 + rng() * 0.00008
      : scenario === "rip"
        ? 0.00026 + rng() * 0.00006
        : (rng() - 0.5) * 0.00008;
  const oi = 4_800_000_000 + rng() * 400_000_000;
  const oiTrend = scenario === "grind" ? 1 : scenario === "rip" ? -1 : 0.2;
  return {
    seed,
    open_spot,
    strike,
    close_time,
    start_time,
    candles,
    funding,
    oi,
    fng: 28 + Math.round(rng() * 50),
    yes_path,
    imbalance_hist: Array.from({ length: 6 }, () => (rng() - 0.4) * 0.5),
    oi_hist: Array.from({ length: 12 }, (_, i) => oi * (1 + oiTrend * i * 0.004)),
    funding_hist: Array.from({ length: 12 }, () => funding + (rng() - 0.5) * 0.00002),
    fng_hist: Array.from({ length: 7 }, () => 30 + Math.round(rng() * 40)),
    scenario,
    vol_med,
  };
}

export function demoTick(state: DemoState, memory: WindowMemory): Snapshot {
  const now = Date.now();
  const rng = seeded((state.seed + Math.floor(now / 1000)) >>> 0);
  const lastC = last(state.candles)!;
  const forming = !lastC.closed;
  const minuteStart = Math.floor(now / 60_000) * 60_000;

  if (forming && lastC.t < minuteStart - 1000) {
    lastC.closed = true;
    const shock =
      (rng() + rng() + rng() - 1.5) *
      (state.scenario === "quiet" ? 0.0004 : 0.001);
    const next = lastC.close * (1 + shock);
    const vol =
      state.vol_med *
      (state.scenario === "rip" && rng() > 0.7 ? 2.6 : 0.6 + rng());
    state.candles.push(candle(minuteStart, lastC.close, next, vol, 0, false));
    if (state.candles.length > 120) state.candles.splice(0, state.candles.length - 120);
  } else {
    const walk = lastC.close * (1 + (rng() - 0.5) * 0.00012);
    lastC.close = walk;
    lastC.high = Math.max(lastC.high, walk);
    lastC.low = Math.min(lastC.low, walk);
    lastC.volume += state.vol_med * 0.02;
  }

  const spot = last(state.candles)!.close;
  const dist = spot - state.strike;
  const tfrac = Math.max(0.04, (state.close_time - now) / (15 * 60_000));
  const p = 1 / (1 + Math.exp(-(dist / Math.max(40, 80 * Math.sqrt(tfrac)))));
  let yesAsk = Math.round(clamp(p * 100 + 1.2, 8, 88));
  let yesBid = clamp(yesAsk - 2, 1, 96);
  let leftover = 2 + Math.round(rng() * 4);
  let noAsk = clamp(100 - leftover - yesAsk, 2, 90);
  let noBid = clamp(noAsk - 2, 1, 96);
  if (rng() > 0.94) {
    yesAsk = 99;
    yesBid = 98;
    noAsk = 2;
    noBid = 1;
    leftover = 100 - yesAsk - noAsk;
  }
  const yesMid = (yesBid + yesAsk) / 2;
  state.yes_path.push(round(yesMid, 1));
  if (state.yes_path.length > 80) state.yes_path.shift();

  const imb = clamp(
    (last(state.imbalance_hist) ?? 0) * 0.7 + (rng() - 0.42) * 0.4,
    -0.85,
    0.85,
  );
  state.imbalance_hist.push(imb);
  if (state.imbalance_hist.length > 20) state.imbalance_hist.shift();

  state.funding +=
    state.scenario === "quiet" ? (rng() - 0.5) * 0.000008 : (rng() - 0.48) * 0.000006;
  const oiStep =
    state.scenario === "grind"
      ? 1_800_000 + rng() * 800_000
      : state.scenario === "rip"
        ? -2_200_000 - rng() * 900_000
        : (rng() - 0.5) * 400_000;
  state.oi += oiStep;
  state.funding_hist.push(state.funding);
  state.oi_hist.push(state.oi);
  if (state.funding_hist.length > 16) state.funding_hist.shift();
  if (state.oi_hist.length > 16) state.oi_hist.shift();

  const yesSize = 120 + imb * 80 + rng() * 20;
  const noSize = 120 - imb * 80 + rng() * 20;
  const oiHist = state.oi_hist;

  const snap: Snapshot = {
    as_of: now,
    phase: "MID",
    mins_left: 0,
    secs_left: 0,
    close_time: state.close_time,
    ticker: `KXBTC15M-DEMO-${new Date(state.close_time).toISOString().slice(11, 16).replace(":", "")}`,
    spot: round(spot, 1),
    spot_source: "demo",
    spot_age_s: 0.4,
    candles_1m: state.candles.map((c) => ({ ...c })),
    candles_5m: [],
    candles_15m: [],
    candles_1h: [],
    strike: state.strike,
    strike_source: "demo",
    yes_bid: yesBid,
    yes_ask: yesAsk,
    no_bid: noBid,
    no_ask: noAsk,
    leftover_cents: 0,
    combined_ask_cents: 0,
    spread_cents: 0,
    quote_age_s: 0.8,
    yes_mid: yesMid,
    yes_mid_path: [...state.yes_path],
    funding_rate: state.funding,
    funding_history: [...state.funding_hist],
    open_interest: state.oi,
    oi_history: [...oiHist],
    oi_delta_3m: (last(oiHist) ?? 0) - (oiHist[oiHist.length - 3] ?? last(oiHist) ?? 0),
    oi_delta_10m: (last(oiHist) ?? 0) - (oiHist[0] ?? 0),
    oi_delta_1h: (last(oiHist) ?? 0) - (oiHist[0] ?? 0),
    liq_long_usd: 0,
    liq_short_usd: 0,
    force_n: 0,
    cascade_proxy: false,
    fear_greed: state.fng,
    fear_greed_label: state.fng < 25 ? "Extreme Fear" : state.fng > 75 ? "Extreme Greed" : "Neutral",
    fng_history: state.fng_hist,
    health: {
      spot_ok: true,
      kalshi_ok: true,
      derivs_ok: true,
      derivs_source: "demo",
      spot: "LIVE",
      kalshi: "LIVE",
      derivs: "LIVE",
    },
    window_memory: memory,
    regime_key: "",
    clock_key: "",
    session: "US_AM",
    demo: true,
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
    imbalance: imb,
    imbalance_hist: [...state.imbalance_hist],
    yes_bid_size: yesSize,
    no_bid_size: noSize,
    spot_lead_bps: 0,
    chalk: false,
  };
  return enrichSnapshot(snap);
}

export function demoFinish(state: DemoState): "UP" | "DOWN" {
  const spot = last(state.candles)?.close ?? state.open_spot;
  return spot > state.strike ? "UP" : "DOWN";
}
