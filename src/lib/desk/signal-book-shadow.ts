/** Generic within-bot component ledger, completely separate from Learner.
 * Components must be emitted with their OWN side; feature values or parent
 * card sides cannot be relabelled as component forecasts. */
import { creditPattern, patternTrust } from "./ledger";
import { SEAT_IDS, type SeatId, type PatternStat } from "./types";
export type Signal = { seat:SeatId; kind:string; version:string; side:"UP"|"DOWN"; confidence:number; at:number; ticker:string; close:number };
export type SignalBook = { stats:Record<string,PatternStat>; credits:Record<string,true>; through:number|null };
export const blankSignalBook = ():SignalBook => ({stats:{},credits:{},through:null});
const key=(s:Signal)=>JSON.stringify([s.seat,s.kind,s.version,s.side]);
function valid(s:Signal,open:number,close:number) {
  return SEAT_IDS.includes(s.seat) && !!s.kind.trim() && !!s.version.trim() &&
    (s.side==="UP"||s.side==="DOWN") && Number.isFinite(s.at) && s.at>=open && s.at<close &&
    Number.isFinite(s.confidence) && s.confidence>0 && s.confidence<=100 &&
    !!s.ticker && Number.isFinite(s.close) && s.at>=s.close-900_000 && s.at<s.close;
}
/** One pre-outcome component/side per exact window; first receipt wins.
 * Ask+entry fee must be frozen at that receipt. Official grades only. */
export function gradeSignals(book:SignalBook,window:{ticker:string;close:number;winner:"UP"|"DOWN";source:string;gradedAt:number},
  receipts:readonly {signal:Signal;ask:number;fee:number}[]):SignalBook {
  const out=structuredClone(book);
  if(window.source!=="kalshi-result" || !(window.winner==="UP"||window.winner==="DOWN") || !Number.isFinite(window.close) || !Number.isFinite(window.gradedAt) || window.gradedAt<window.close || !window.ticker) return out;
  const ordered=[...receipts].sort((a,b)=>a.signal.at-b.signal.at);
  for(const r of ordered) {
    if(r.signal.ticker!==window.ticker || r.signal.close!==window.close || !valid(r.signal,window.close-900_000,window.close) || !Number.isFinite(r.ask) || r.ask<=0 || r.ask>=100 || !Number.isFinite(r.fee) || r.fee<0) continue;
    const id=JSON.stringify([window.ticker,window.close,key(r.signal)]);
    if(out.credits[id]) continue;
    out.credits[id]=true;
    // A delayed official grade is available only at gradedAt, not at close.
    out.through=Math.max(out.through??0,window.gradedAt);
    creditPattern(out.stats,key(r.signal),r.signal.side,window.winner,(r.signal.side===window.winner?100:0)-r.ask-r.fee);
  }
  return out;
}
/** Apply trust to components, never fold an entire bot because one signal lost.
 * Keep opposition separate; a downstream bot adapter owns its combination rule. */
export function tuneSignals(book:SignalBook,signals:readonly Signal[],at:number) {
  if(!Number.isFinite(at) || (book.through!=null && book.through>=at)) throw Error("signal book includes future or current outcome");
  return signals.map(s=>{
    if(!valid(s,at-900_000,at+1) || s.at>at) throw Error("invalid signal receipt");
    const trust=patternTrust(book.stats[key(s)]);
    return {...s,trust,shadow_confidence:trust.fold?0:Math.min(trust.cap??100,s.confidence*trust.mul)};
  });
}
