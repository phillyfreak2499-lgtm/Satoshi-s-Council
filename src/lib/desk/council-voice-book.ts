/** Private paired paper books. Observed asks, not a claim of executable fills. */
import { runChair } from "./chair";
import { softenTimeGates } from "./time-gates";
import { stickLean, type Stick } from "./stick";
import { withoutConfidenceGag } from "./council-voice-shadow";
import { bookable, paperBookEdgeOk, paperBookTeamOk } from "./book-floor.ts";
import { selectiveChair, selectiveBookOk, settleRiskCalls, restoreRiskCalls, chicagoDay, type EntryWatch } from "./selective-entry.ts";
import { takerFeeCents } from "./clock.ts";
import { onGrid, tickerAgrees } from "./window-identity.ts";
import type { CallLogRow, Learner, Lean, Settings, Snapshot, Vote } from "./types";

export type VoiceBookArm = { calls: CallLogRow[]; lastLean: Lean; entryLean: Lean | null; stick?: Stick; watch: EntryWatch | null };
export type VoiceBookState = { start: number; end: number; key: string | null; last: number; unknownDays: string[]; control: VoiceBookArm; candidate: VoiceBookArm };
export type VoiceBookInput = { snap: Snapshot; votes: Vote[]; learner: Learner; settings: Settings; now: number; ready: boolean };
const arm = (): VoiceBookArm => ({calls:[],lastLean:"WAIT",entryLean:null,watch:null});
export function freshVoiceBooks(start: number): VoiceBookState {
  if(!Number.isFinite(start) || !onGrid(start)) throw Error("invalid voice start");
  return {start,end:start+21*86400000,key:null,last:0,unknownDays:[],control:arm(),candidate:arm()};
}
export function stepVoiceBooks(saved: VoiceBookState, input: VoiceBookInput) {
  const {snap,now}=input, open=snap.close_time-900000;
  if(!input.ready || snap.demo || !Number.isFinite(now) || !Number.isFinite(snap.as_of) ||
      !onGrid(snap.close_time) || !tickerAgrees(snap.ticker,snap.close_time) || snap.as_of>now ||
      now-snap.as_of>8000 || now>=snap.close_time || snap.as_of<open || open<saved.start || open>=saved.end)
    throw Error("invalid prospective book input");
  const out=structuredClone(saved), key=JSON.stringify([snap.ticker,snap.close_time]);
  if(out.key===key && snap.as_of<=out.last) throw Error("duplicate or backward voice frame");
  if(out.key!==key) {
    if(out.last && snap.as_of<=out.last) throw Error("backward voice window");
    for(const name of ["control","candidate"] as const) out[name]={...arm(),calls:out[name].calls};
    out.key=key;out.last=0;
  }
  let reason=out.last ? snap.as_of-out.last>10000 ? "frame gap exceeds 10 seconds" : null
    : snap.as_of-open>8000 ? "opening frame missed" : null;
  if(reason) out.unknownDays=[...new Set([...out.unknownDays,chicagoDay(open),chicagoDay(snap.close_time)])];
  if(out.unknownDays.includes(chicagoDay(snap.as_of))) reason??="daily risk history has capture gaps";
  out.last=snap.as_of;
  const raw=withoutConfidenceGag(input.votes,snap,input.learner);
  const evaluate=(name:"control"|"candidate")=>{
    const a=out[name], learner=structuredClone(input.learner);
    learner.window_memory.entry_lean=a.entryLean;
    const votes=name==="control"?structuredClone(input.votes):raw.map(r=>structuredClone(r.vote));
    const chair=softenTimeGates(runChair(votes,structuredClone(snap),learner,structuredClone(input.settings),a.lastLean),snap);
    const sticky=stickLean(a.stick,chair.lean,snap.as_of);a.stick=sticky.st;chair.lean=sticky.lean;
    const ctx={calls:a.calls,ready:true,start:out.start,watch:a.watch};
    const selected=selectiveChair(snap,chair,ctx);a.watch=selected.watch;a.lastLean=selected.chair.lean;
    if(a.entryLean==null && a.lastLean!=="WAIT") a.entryLean=a.lastLean;
    const existing=a.calls.find(c=>c.ticker===snap.ticker && c.close_time===snap.close_time);
    const side=selected.chair.lean;
    let fill: CallLogRow | null=null;
    if(!reason && !existing && (side==="UP"||side==="DOWN") && paperBookEdgeOk(snap,side) &&
        paperBookTeamOk(selected.chair,side) && selectiveBookOk(snap,selected.chair,{...ctx,watch:a.watch})) {
      const ask=side==="UP"?snap.yes_ask:snap.no_ask;
      if(bookable(ask)) {
        fill={id:`voice|${name}|${key}|${snap.as_of}`,t:snap.as_of,ticker:snap.ticker,close_time:snap.close_time,
          lean:side,cents:Math.round(ask*10)/10,settle:null,flipped:false};
        a.calls=restoreRiskCalls(a.calls,[fill]).calls;
      }
    }
    return {chair:selected.chair,fill};
  };
  const control=evaluate("control"), candidate=evaluate("candidate");
  return {state:out,control,candidate,invalid:reason,restored:raw.filter(r=>r.restored).map(r=>r.vote.seat)};
}

/** Exact official outcome only. Receipt clock is preserved, never backdated. */
export function gradeVoiceBooks(saved: VoiceBookState, grade: {ticker:string;close:number;winner:"UP"|"DOWN";source:string;at:number}) {
  if(grade.source!=="kalshi-result" || !(grade.winner==="UP"||grade.winner==="DOWN") ||
      !Number.isFinite(grade.at) || grade.at<grade.close || !onGrid(grade.close) || !tickerAgrees(grade.ticker,grade.close))
    throw Error("invalid official voice grade");
  const state=structuredClone(saved);
  for(const name of ["control","candidate"] as const) state[name].calls=settleRiskCalls(state[name].calls,grade.ticker,grade.close,grade.winner);
  const net=(name:"control"|"candidate")=>{
    const c=state[name].calls.find(r=>r.ticker===grade.ticker && r.close_time===grade.close);
    return c ? c.settle!-c.cents-takerFeeCents(c.cents) : 0;
  };
  return {state,control:net("control"),candidate:net("candidate"),delta:net("candidate")-net("control")};
}
