/** Inactive research adapter. Never imported by the engine or a booking path. */
import { runChair } from "./chair";
import { SPEAK_CONF } from "./math";
import { RETIRED_SEATS, NON_VOTERS } from "./crew";
import type { Learner, Settings, Snapshot, Vote, Lean } from "./types";

export const VOICE_PROTOCOL = Object.freeze({
  id: "COUNCIL_VOICE_V1_INACTIVE", authority: "NONE", days: 21,
  intervention: "remove selected-card confidence gag only",
  floor_cents: 80, automatic_promotion: false,
  integrity_kill: "any input mutation, unauthorized admission, changed production output or future receipt",
  capture_pause: "more than 5 percent invalid complete windows after 20 windows",
  economics_kill: "paired after-fee delta <= -100 cents after at least 20 valid paired windows",
  final_gate: "at least 50 paired windows with changed candidate decision; positive paired net and separate frozen confirmation; explicit owner word",
});

/** Frozen research-only kill decision, with no actuator or promotion path. */
export function voiceKillDecision(s:{validWindows:number;invalidWindows:number;pairedDelta:number;integrityViolations:number}) {
  if(!Object.values(s).every(Number.isFinite) || Object.entries(s).some(([key,value])=>key!=="pairedDelta" && value<0))
    return "PAUSE_INVALID_SUMMARY" as const;
  if(s.integrityViolations>0) return "KILL_INTEGRITY" as const;
  if(s.validWindows+s.invalidWindows>=20 && s.invalidWindows/(s.validWindows+s.invalidWindows)>.05)
    return "PAUSE_CAPTURE" as const;
  if(s.validWindows>=20 && s.pairedDelta<=-100) return "KILL_ECONOMICS" as const;
  return "CONTINUE_SHADOW" as const;
}

/** Restore only the selected raw read lost to the numeric confidence bar.
 * No paper-candidate promotion, status changes, stale recovery or bench bypass. */
export function withoutConfidenceGag(votes: readonly Vote[], snap: Snapshot, learner: Learner) {
  return votes.map(original => {
    const v = structuredClone(original);
    const raw = v.raw_lean;
    const conf = v.raw_conf;
    const k = learner.knobs?.[v.seat];
    const restore = v.lean === "WAIT" && v.forced_sit === true &&
      (raw === "UP" || raw === "DOWN") && Number.isFinite(conf) && conf! > 0 && conf! < SPEAK_CONF+(k?.speak_offset??0) &&
      v.skill_used !== "SIT" && v.skill_status === "LIVE" &&
      !NON_VOTERS.includes(v.seat) && !RETIRED_SEATS[v.seat] &&
      v.health === "LIVE" && Number.isFinite(v.feed_age_s) && v.feed_age_s >= 0 &&
      !(k && k.benched_until > snap.as_of);
    if (restore) { v.lean=raw!; v.confidence=conf!; v.forced_sit=false; }
    return { vote:v, restored:restore };
  });
}

export function evaluateCouncilVoice(input: {
  snap: Snapshot; votes: readonly Vote[]; learner: Learner; settings: Settings; lastLean: Lean; now: number;
}) {
  if (!Number.isFinite(input.now) || input.snap.demo || !Number.isFinite(input.snap.as_of) ||
      input.snap.as_of>input.now || input.now-input.snap.as_of>8_000 || input.now>=input.snap.close_time ||
      input.snap.as_of<input.snap.close_time-900_000) throw Error("invalid prospective voice frame");
  const before=JSON.stringify(input);
  const transformed=withoutConfidenceGag(input.votes,input.snap,input.learner);
  const control=runChair(structuredClone([...input.votes]),structuredClone(input.snap),structuredClone(input.learner),structuredClone(input.settings),input.lastLean);
  const candidate=runChair(transformed.map(r=>r.vote),structuredClone(input.snap),structuredClone(input.learner),structuredClone(input.settings),input.lastLean);
  if (before!==JSON.stringify(input)) throw Error("voice isolation violation");
  return { protocol:VOICE_PROTOCOL.id,authority:"NONE" as const,at:input.snap.as_of,
    ticker:input.snap.ticker,close:input.snap.close_time,control,candidate,
    restored:transformed.filter(r=>r.restored).map(r=>r.vote.seat),
    voices:input.votes.map(v=>({seat:v.seat,card:v.skill_used,lean:v.raw_lean??v.lean,confidence:v.raw_conf??v.confidence})),
    booked:false as const };
}
