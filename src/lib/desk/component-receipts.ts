/** Inactive semantic observations; no confidence, tuning or booking authority. */
import { readWick } from "./patterns";
import { readDrift } from "./structure";
import type { Candle, Snapshot } from "./types";

export type ComponentReceipt = {
  seat: "WICK" | "DRIFT"; kind: string; version: "v1";
  side: "UP" | "DOWN"; at: number; ticker: string; close: number;
  evidence: Record<string, number | string | boolean>;
};

/** Feature reads use only closed candles received before the observed frame.
 * Receipt time is the frame time, never retrospectively the pattern's bar time.
 * These directions are observations, not calibrated component probabilities. */
export function componentReceipts(snap: Snapshot, now: number): ComponentReceipt[] {
  if (snap.demo || !snap.ticker || !Number.isFinite(now) || !Number.isFinite(snap.as_of) ||
      !Number.isFinite(snap.close_time) || snap.as_of > now || now - snap.as_of > 8000 ||
      snap.as_of < snap.close_time - 900000 || now >= snap.close_time ||
      !snap.health.spot_ok || snap.health.spot !== "LIVE" || snap.health.spot_divergent || !Number.isFinite(snap.spot_age_s) || snap.spot_age_s < 0 || snap.spot_age_s > 8 ||
      ![snap.ret5, snap.ret15, snap.ret30, snap.ret1h].every(Number.isFinite)) return [];
  const closed = (bars: Candle[], duration: number) => bars.filter(c => c.closed &&
    Number.isFinite(c.t) && c.t + duration <= snap.as_of &&
    Number.isFinite(c.receipt_ts) && c.receipt_ts <= snap.as_of &&
    [c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite));
  const one = closed(snap.candles_1m,60000), five = closed(snap.candles_5m,300000);
  const safe = {...snap,candles_1m:one,candles_5m:five};
  const out: ComponentReceipt[] = [];
  const add = (seat:ComponentReceipt["seat"],kind:string,side:unknown,evidence:ComponentReceipt["evidence"]) => {
    if(side === "UP" || side === "DOWN") out.push({seat,kind,version:"v1",side,at:snap.as_of,ticker:snap.ticker,close:snap.close_time,evidence});
  };
  const d = readDrift(safe);
  if(d.aligned) add("DRIFT","aligned_returns",d.sign5,{ret5:snap.ret5,ret15:snap.ret15,ret30:snap.ret30});
  if(d.accel && d.strong15) add("DRIFT","acceleration",d.sign15,{ret5:snap.ret5,ret15:snap.ret15,ratio_threshold:.42,strong15_threshold:.0025});
  // Pullback and structure require actual closed candle evidence.
  if(one.length >= 3 && d.pullback) add("DRIFT","pullback",d.sign15,{ret5:snap.ret5,ret15:snap.ret15,ret30:snap.ret30,trend:d.trend});
  if(one.length >= 3) add("DRIFT","structure",d.trend,{closed_bars:one.length});
  if(one.length >= 3) {
    const w = readWick(one,readWick(five).structure.trend);
    for(const mark of w.marks) {
      // Match the existing lastMark recency rule; older marks are not new signals.
      if(mark.i < w.slice.length - 6 || !mark.confirmed || !mark.contextOk) continue;
      add("WICK",mark.kind,mark.lean,{pattern_at:w.slice[mark.i].t,confirmed:mark.confirmed,location:mark.loc,confluence:mark.confluence});
    }
  }
  return out;
}
