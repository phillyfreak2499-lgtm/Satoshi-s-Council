import { last, median, signOf } from "./math";
import { candleFeat } from "./patterns";
import type { Lean, Snapshot } from "./types";

export type PulseRead = {
  ratio: number;
  pct: number;
  pxDir: Lean | "FLAT";
  spike: boolean;
  dry: boolean;
  climax: boolean;
  absorb: boolean;
  lag5: boolean;
  lean: Lean;
};

export type TapeRead = {
  imb: number;
  persist: Lean | "FLAT";
  flip: Lean | "FLAT";
  thin: boolean;
  wipe: boolean;
  yesSz: number;
  noSz: number;
};

export type WhaleRead = {
  ratio: number;
  usd: number;
  proxy: boolean;
  cluster: boolean;
  absorb: boolean;
  lean: Lean;
};

export type VelRead = {
  lead: number;
  need: number;
  meaningful: boolean;
  catching: boolean;
  fading: boolean;
  lean: Lean;
};

function persist(hist: number[], n: number): Lean | "FLAT" {
  if (hist.length < n) return "FLAT";
  const slice = hist.slice(-n);
  if (slice.every((x) => x > 0.04)) return "UP";
  if (slice.every((x) => x < -0.04)) return "DOWN";
  return "FLAT";
}

export function readPulse(snap: Snapshot): PulseRead {
  const ratio = snap.vol_median > 0 ? snap.vol_last / snap.vol_median : 1;
  const lastC = last(snap.candles_1m.filter((c) => c.closed)) ?? last(snap.candles_1m);
  const pxDir: Lean | "FLAT" = lastC ? signOf(lastC.close - lastC.open) : "FLAT";
  const f = lastC ? candleFeat(lastC) : null;
  const spike = ratio > 2.2 && pxDir !== "FLAT";
  const dry = ratio < 0.45 && Math.abs(snap.ret5) > 0.001;
  const climax = Boolean(
    spike &&
      f &&
      ((snap.location === "HIGH" && pxDir === "UP" && f.upperPct >= 0.4) ||
        (snap.location === "LOW" && pxDir === "DOWN" && f.lowerPct >= 0.4)),
  );
  const absorb = spike && Boolean(f && f.bodyPct < 0.28);
  const c5 = snap.candles_5m;
  const last5 = last(c5);
  const med5 = median(c5.slice(-12).map((c) => c.volume));
  const vol5x = last5 && med5 > 0 ? last5.volume / med5 : 1;
  const lag5 =
    vol5x >= 1.8 &&
    ratio < 0.9 &&
    signOf(snap.ret15) !== "FLAT" &&
    signOf(snap.ret15) === signOf(last5 ? last5.close - last5.open : 0);
  let lean: Lean = "WAIT";
  if (spike && (pxDir === "UP" || pxDir === "DOWN")) lean = pxDir;
  else if (lag5 && (signOf(snap.ret15) === "UP" || signOf(snap.ret15) === "DOWN")) {
    lean = signOf(snap.ret15) as "UP" | "DOWN";
  }
  return { ratio, pct: snap.vol_percentile, pxDir, spike, dry, climax, absorb, lag5, lean };
}

export function readTape(snap: Snapshot): TapeRead {
  const hist = snap.imbalance_hist;
  const persist4 = persist(hist, 4);
  let flip: Lean | "FLAT" = "FLAT";
  if (hist.length >= 6) {
    const older = persist(hist.slice(0, -2), 4);
    const last2 = hist.slice(-2);
    if (older === "UP" && last2.every((x) => x < -0.04)) flip = "DOWN";
    if (older === "DOWN" && last2.every((x) => x > 0.04)) flip = "UP";
  }
  const yesSz = snap.yes_bid_size;
  const noSz = snap.no_bid_size;
  const tot = yesSz + noSz;
  const thin = (tot > 0 && tot < 2.5) || snap.spread_cents > 5;
  const heavy = Math.max(yesSz, noSz);
  const light = Math.min(yesSz, noSz);
  const wipe = heavy > 0 && light / heavy < 0.18 && persist4 !== "FLAT";
  return { imb: snap.imbalance, persist: persist4, flip, thin, wipe, yesSz, noSz };
}

export function readWhale(snap: Snapshot): WhaleRead {
  const bars = snap.candles_1m.filter((c) => c.closed).slice(-6);
  const lastC = last(bars) ?? last(snap.candles_1m);
  const ratio = snap.vol_median > 0 ? snap.vol_last / snap.vol_median : 1;
  const usd = lastC ? lastC.volume : 0;
  const proxy = ratio > 2.5 && Boolean(lastC);
  const big = bars.filter((c) => snap.vol_median > 0 && c.volume / snap.vol_median >= 1.8);
  const cluster =
    big.length >= 2 &&
    big.every((c) => signOf(c.close - c.open) === signOf(big[0]!.close - big[0]!.open)) &&
    signOf(big[0]!.close - big[0]!.open) !== "FLAT";
  const f = lastC ? candleFeat(lastC) : null;
  const absorb = Boolean(
    proxy &&
      f &&
      lastC &&
      ((lastC.close >= lastC.open && f.closePos < 0.35) ||
        (lastC.close < lastC.open && f.closePos > 0.65)),
  );
  let lean: Lean = "WAIT";
  if (cluster) {
    const d = signOf(big[0]!.close - big[0]!.open);
    if (d !== "FLAT") lean = d;
  } else if (proxy && lastC) {
    lean = lastC.close >= lastC.open ? "UP" : "DOWN";
  }
  if (absorb) lean = lastC && lastC.close >= lastC.open ? "DOWN" : "UP";
  return { ratio, usd, proxy, cluster, absorb, lean };
}

export function readVel(snap: Snapshot): VelRead {
  const need = 4 * (snap.session === "ASIA" ? 2 : 1);
  const lead = snap.spot_lead_bps;
  const path = snap.yes_mid_path;
  const d60 = path.length >= 6 ? path[path.length - 1]! - path[path.length - 6]! : 0;
  const meaningful = Math.abs(lead) >= need;
  const catching =
    meaningful && Math.abs(d60) >= 5 && Math.sign(d60) === Math.sign(lead) && lead !== 0;
  const lastC = last(snap.candles_1m.filter((c) => c.closed));
  const bar = lastC ? signOf(lastC.close - lastC.open) : "FLAT";
  const fading =
    meaningful && bar !== "FLAT" && ((lead > 0 && bar === "DOWN") || (lead < 0 && bar === "UP"));
  const lean: Lean = meaningful && !catching && !fading ? (lead > 0 ? "UP" : "DOWN") : "WAIT";
  return { lead, need, meaningful, catching, fading, lean };
}
