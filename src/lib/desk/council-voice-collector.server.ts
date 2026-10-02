/** Default-OFF observer. Separate books/tables; no notifications or production writes. */
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { getSql, type Sql } from "@/lib/db";
import { freshVoiceBooks, stepVoiceBooks, gradeVoiceBooks, type VoiceBookState, type VoiceBookInput } from "./council-voice-book";
import { VOICE_PROTOCOL, voiceKillDecision } from "./council-voice-shadow";
import { SELECTIVE_ENTRY_ID, SELECTIVE_PARAMS, chicagoDay } from "./selective-entry.ts";
import { sampleVoiceResources } from "./council-voice-resources.server";
import { governorDecision } from "./resource-governor.ts";
import { voiceReplayDelta } from "./council-voice-replay";

export const VOICE_CAPTURE_PROTOCOL = Object.freeze({
  ...VOICE_PROTOCOL, sampler_ms:4000, freshness_ms:8000, gap_ms:10000,
  max_compressed_input_bytes:65536, risk_seed:"both shadow books empty at study start",
  max_window_replay_bytes:2097152, max_study_replay_bytes:4294967296,
  learner:"identical contemporaneous production calibration, privately copied each frame",
  fills:"observed ask model; no claim of IOC fillability", policy:SELECTIVE_ENTRY_ID, selective:SELECTIVE_PARAMS,
  incomplete_risk:"exclude capture and settlement Chicago days; no guessed daily risk",
  replay:"exact JSON deltas against immutable per-window baseline; full pre-frame book included",
  governor:"own process CPU, event-loop delay, RSS, cgroup limit and DB sample; warm up before initialization",
});
type Meta = {fingerprint:string;build_sha:string;start_ms:string;end_ms:string;revision:string;bytes_used:string;state:VoiceBookState;status:string};
const next=(t:number)=>(Math.floor(t/900000)+1)*900000;
const id=VOICE_PROTOCOL.id;
export const voiceCollectorEnabled=(env:Record<string,string|undefined>=process.env)=>env.COUNCIL_VOICE_V1_ENABLED==="true";
export async function initializeVoiceCapture(sql:Sql, now:number, build:string) {
  if(!Number.isFinite(now) || !/^[0-9a-f]{7,40}$/.test(build)) throw Error("voice capture requires a clock and pinned build");
  const fingerprint=createHash("sha256").update(JSON.stringify({protocol:VOICE_CAPTURE_PROTOCOL,build})).digest("hex");
  const state=freshVoiceBooks(next(now));
  await sql`insert into desk_voice_meta(experiment,fingerprint,build_sha,start_ms,end_ms,state)
    values(${id},${fingerprint},${build},${state.start},${state.end},${JSON.stringify(state)}::jsonb)
    on conflict(experiment) do nothing`;
  const [meta]=await sql<Meta>`select * from desk_voice_meta where experiment=${id}`;
  if(!meta || meta.fingerprint!==fingerprint || meta.build_sha!==build) {
    await sql`update desk_voice_meta set status='KILL_INTEGRITY',reason='protocol/build mismatch' where experiment=${id}`;
    throw Error("voice protocol/build mismatch");
  }
  // Enumerate prospective windows once: completely absent capture stays visible.
  await sql`insert into desk_voice_windows(experiment,close_ms)
    select ${id},generate_series(${Number(meta.start_ms)+900000}::bigint,${Number(meta.end_ms)}::bigint,900000)
    on conflict do nothing`;
  return meta;
}
export async function excludeVoiceWindow(sql:Sql, close:number, reason:string) {
  // Lost observations can hide entries/losses. Never let later same-day books
  // treat an incomplete daily risk path as known or reset it to zero.
  await sql.query(`with excluded as (
    update desk_voice_windows set invalid=coalesce(invalid,$1),result=null
    where experiment=$2 and close_ms=$3 returning experiment
  ), affected as (
    update desk_voice_windows w set invalid=coalesce(invalid,'daily risk history has capture gaps'),result=null
    where w.experiment=$2 and w.close_ms>$3 and exists(select 1 from excluded)
      and (to_char(to_timestamp((w.close_ms-900000)/1000.0) at time zone 'America/Chicago','YYYY-MM-DD') in
        (select jsonb_array_elements_text($4::jsonb))
        or to_char(to_timestamp(w.close_ms/1000.0) at time zone 'America/Chicago','YYYY-MM-DD') in
        (select jsonb_array_elements_text($4::jsonb))) returning experiment
  ) update desk_voice_meta m set revision=revision+1,state=jsonb_set(state,'{unknownDays}',
    (select jsonb_agg(distinct x) from jsonb_array_elements(coalesce(state->'unknownDays','[]'::jsonb)||$4::jsonb) as t(x)))
    where m.experiment=$2 and exists(select 1 from excluded)`,
    [reason,id,close,JSON.stringify([chicagoDay(close-900000),chicagoDay(close)])]);
}
/** Optimistic revision plus a single statement commits book, window and replay
 * receipt atomically. A failed write never advances local state or exposes a fill. */
export async function captureVoiceFrame(sql:Sql,input:VoiceBookInput, clock?:()=>number) {
  const [meta]=await sql<Meta>`select * from desk_voice_meta where experiment=${id}`;
  if(!meta || meta.status!=="SHADOW") return null;
  if(input.snap.as_of>input.now) {
    await sql`update desk_voice_meta set status='KILL_INTEGRITY',reason='future frame receipt' where experiment=${id}`;
    throw Error("future voice frame receipt");
  }
  const [window]=await sql<{replay_base:string|null}>`select replay_base from desk_voice_windows
    where experiment=${id} and close_ms=${input.snap.close_time}`;
  const material={input,state_before:meta.state};
  const baseline=window?.replay_base??gzipSync(JSON.stringify(material)).toString("base64");
  const base=JSON.parse(gunzipSync(Buffer.from(baseline,"base64")).toString());
  const bytes=gzipSync(JSON.stringify(voiceReplayDelta(base,material)));
  if(bytes.length>VOICE_CAPTURE_PROTOCOL.max_compressed_input_bytes || Buffer.from(baseline,"base64").length>VOICE_CAPTURE_PROTOCOL.max_compressed_input_bytes) {
    await excludeVoiceWindow(sql,input.snap.close_time,"replay input exceeds frozen byte budget");return null;
  }
  const result=stepVoiceBooks(meta.state,input);
  const payload={control:result.control,candidate:result.candidate,restored:result.restored};
  const encoded=JSON.stringify({gzip:gzipSync(JSON.stringify(payload)).toString("base64")});
  const replayBytes=bytes.toString("base64").length+encoded.length+(window?.replay_base?0:baseline.length);
  if(Number(meta.bytes_used)+replayBytes>VOICE_CAPTURE_PROTOCOL.max_study_replay_bytes) {
    await sql`update desk_voice_meta set status='PAUSE_STORAGE_BUDGET',reason='replay budget reached' where experiment=${id}`;
    return null;
  }
  const [used]=await sql<{n:string}>`select coalesce(sum(length(input_gzip)+length(output::text)),0)::bigint as n
    from desk_voice_frames where experiment=${id} and close_ms=${input.snap.close_time}`;
  if(Number(used?.n??0)+replayBytes+(window?.replay_base?.length??0)>VOICE_CAPTURE_PROTOCOL.max_window_replay_bytes) {
    await excludeVoiceWindow(sql,input.snap.close_time,"window replay budget reached");return null;
  }
  const acceptedAt=clock?.()??input.now;
  if(acceptedAt>=input.snap.close_time || acceptedAt-input.snap.as_of>VOICE_CAPTURE_PROTOCOL.freshness_ms) {
    await excludeVoiceWindow(sql,input.snap.close_time,"capture expired before commit");return null;
  }
  const rows=await sql.query(`with changed as (
    update desk_voice_meta set state=$1::jsonb,revision=revision+1,bytes_used=bytes_used+$10
    where experiment=$2 and revision=$3 and status='SHADOW'
      and bytes_used+$10<=$11
      and exists(select 1 from desk_voice_windows w where w.experiment=$2 and w.close_ms=$7
        and w.result is null and (w.ticker is null or w.ticker=$4)) returning experiment
  ), window_write as (
    update desk_voice_windows w set ticker=coalesce(w.ticker,$4),first_ms=coalesce(w.first_ms,$5),last_ms=$5,
      checkpoint=$1::jsonb,invalid=coalesce(w.invalid,$6),changed=w.changed or $12,replay_base=coalesce(w.replay_base,$13)
    from changed c where w.experiment=c.experiment and w.close_ms=$7 and w.result is null
      and (w.ticker is null or w.ticker=$4) returning w.experiment,w.close_ms
  ) insert into desk_voice_frames(experiment,close_ms,as_of,input_gzip,output)
    select experiment,close_ms,$5,$8,$9::jsonb from window_write returning as_of`,
    [JSON.stringify(result.state),id,Number(meta.revision),input.snap.ticker,input.snap.as_of,result.invalid,
      input.snap.close_time,bytes.toString("base64"),encoded,replayBytes,VOICE_CAPTURE_PROTOCOL.max_study_replay_bytes,
      result.control.chair.lean!==result.candidate.chair.lean,baseline]);
  if(rows.length!==1) throw Error("voice atomic capture conflict");
  return result;
}
export async function gradeVoiceCapture(sql:Sql,now:number) {
  // Final completeness is independent of whether a favorable outcome arrived.
  const incomplete=await sql<{close_ms:string}>`select close_ms from desk_voice_windows
    where experiment=${id} and close_ms<=${now} and result is null and invalid is null
      and (checkpoint is null or first_ms>close_ms-892000 or last_ms<close_ms-8000)`;
  for(const r of incomplete) await excludeVoiceWindow(sql,Number(r.close_ms),"incomplete full-window capture");
  const rows=await sql<{ticker:string;close_ms:string;checkpoint:VoiceBookState;winner:"UP"|"DOWN";invalid:string|null}>`
    select w.ticker,w.close_ms,w.checkpoint,w.invalid,l.winner from desk_voice_windows w
    join lateral (select min(winner) as winner from desk_ledger_research l
      where l.ticker=w.ticker and extract(epoch from l.close_time)*1000=w.close_ms
      and l.source='kalshi-result' and l.winner in ('UP','DOWN') having count(distinct winner)=1) l on true
    where w.experiment=${id} and w.close_ms<=${now} and w.result is null
      and w.checkpoint is not null order by w.close_ms limit 10`;
  for(const r of rows) {
    const [meta]=await sql<Meta>`select * from desk_voice_meta where experiment=${id}`;
    if(!meta) throw Error("missing voice manifest");
    const grade={ticker:r.ticker,close:Number(r.close_ms),winner:r.winner,source:"kalshi-result",at:now};
    const economics=gradeVoiceBooks(r.checkpoint,grade);
    const current=gradeVoiceBooks(meta.state,grade).state;
    const outcome={valid:!r.invalid,graded_at:now,source:grade.source,winner:r.winner,
      control:r.invalid?null:economics.control,candidate:r.invalid?null:economics.candidate,delta:r.invalid?null:economics.delta};
    const wrote=await sql.query(`with changed as (
      update desk_voice_meta set state=$1::jsonb,revision=revision+1 where experiment=$2 and revision=$3
        and exists(select 1 from desk_voice_windows w where w.experiment=$2 and w.close_ms=$5
          and w.result is null and w.invalid is not distinct from $6) returning experiment
    ) update desk_voice_windows w set result=$4::jsonb from changed c
      where w.experiment=c.experiment and w.close_ms=$5 and w.result is null
      and w.invalid is not distinct from $6 returning close_ms`,
      [JSON.stringify(current),id,Number(meta.revision),JSON.stringify(outcome),grade.close,r.invalid]);
    if(wrote.length!==1) throw Error("voice grade conflict");
  }
  const [summary]=await sql<{valid:number;invalid:number;observed:number;delta:number}>`
    select count(*)::int as observed,
      count(*) filter(where invalid is null and result->>'valid'='true')::int as valid,
      count(*) filter(where invalid is not null)::int as invalid,
      coalesce(sum((result->>'delta')::numeric) filter(where invalid is null and result->>'valid'='true'),0)::float8 as delta
    from desk_voice_windows where experiment=${id} and close_ms<=${now}`;
  const verdict=voiceKillDecision({validWindows:Number(summary?.valid??0),invalidWindows:Number(summary?.invalid??0),
    observedWindows:Number(summary?.observed??0),pairedDelta:Number(summary?.delta??0),integrityViolations:0});
  if(verdict!=="CONTINUE_SHADOW") await sql`update desk_voice_meta set status=${verdict},reason=${verdict} where experiment=${id} and status='SHADOW'`;
  return verdict;
}
type Runtime={timer:ReturnType<typeof setInterval>|null;busy:boolean;busySkips?:number[];boot:number;initialized:boolean;lastGrade:number;error:string|null};
const root=globalThis as typeof globalThis & {__voiceCapture?:Runtime};
const runtime=()=>root.__voiceCapture??={timer:null,busy:false,boot:Date.now(),initialized:false,lastGrade:0,error:null};
export async function voiceCaptureTick() {
  if(!voiceCollectorEnabled()) return;
  const st=runtime(), now=Date.now();
  if(st.busy) {st.busySkips=[...new Set([...(st.busySkips??[]),next(now)])];return;}
  st.busy=true;
  let failedClose=next(now);
  try {
    const sql=await getSql();
    const witness=await sampleVoiceResources(sql), measuredNow=Date.now();
    if(!witness || witness.measured_at_ms>measuredNow || measuredNow-witness.measured_at_ms>60000 ||
        !governorDecision(witness.sample,witness.thresholds).run) {
      await excludeVoiceWindow(sql,next(measuredNow),"resource governor skip");return;
    }
    if(!st.initialized) {
      const meta=await initializeVoiceCapture(sql,measuredNow,String(process.env.RENDER_GIT_COMMIT??""));
      if(Number(meta.start_ms)<next(st.boot)) await excludeVoiceWindow(sql,next(st.boot),"restart in open window");
      st.initialized=true;
    }
    if(now-st.lastGrade>=30000) {await gradeVoiceCapture(sql,now);st.lastGrade=now;}
    const [meta]=await sql<Meta>`select * from desk_voice_meta where experiment=${id}`;
    if(!meta || meta.status!=="SHADOW" || now<Number(meta.start_ms) || now>=Number(meta.end_ms)) return;
    const {getServerFrame}=await import("./server-engine");
    const frame=await getServerFrame();
    if(frame.selective.policy!==SELECTIVE_ENTRY_ID || JSON.stringify(frame.selective.params)!==JSON.stringify(SELECTIVE_PARAMS)) {
      await sql`update desk_voice_meta set status='KILL_INTEGRITY',reason='production policy mismatch' where experiment=${id}`;
      return;
    }
    if(!frame.snap || frame.snap.as_of===meta.state.last) return;
    failedClose=frame.snap.close_time;
    if(Date.now()>=frame.snap.close_time) return; // Prior-window rollover is not a new-window failure.
    const input:VoiceBookInput={snap:structuredClone(frame.snap),votes:structuredClone(frame.votes),learner:structuredClone(frame.learner),
      settings:{...frame.settings,poll_ms:4000,source:"live",show_faded:false,show_shadow:false,tz:"America/Chicago"},now:Date.now(),ready:frame.selective.ready};
    if(input.snap.close_time-900000<next(st.boot)) return;
    await captureVoiceFrame(sql,input,Date.now);
  } catch(error) {
    st.error=error instanceof Error?error.message:String(error);
    try {await excludeVoiceWindow(await getSql(),failedClose,st.error);} catch { /* No local advance on a failed durable write. */ }
  } finally {
    try {
      while(st.busySkips?.length) {
        const close=st.busySkips[0];
        const sql=await getSql();
        await excludeVoiceWindow(sql,close,"busy sampler skip");
        st.busySkips=st.busySkips.filter(value=>value!==close);
      }
    } catch(error) {st.error=error instanceof Error?error.message:String(error);}
    st.busy=false;
  }
}
export function ensureVoiceCapture() {
  if(!voiceCollectorEnabled()) return "disabled";
  const st=runtime();
  if(!st.timer) {st.timer=setInterval(()=>void voiceCaptureTick(),4000);st.timer.unref?.();void voiceCaptureTick();}
  return "shadow-only";
}
export async function voiceCaptureReport() {
  const sql=await getSql();
  const [meta]=await sql<Meta>`select * from desk_voice_meta where experiment=${id}`;
  const [counts]=await sql`select count(*)::int as expected_windows,
    count(*) filter(where close_ms<=${Date.now()})::int as observed_windows,
    count(*) filter(where close_ms<=${Date.now()} and invalid is null and checkpoint is not null
      and first_ms<=close_ms-892000 and last_ms>=close_ms-8000)::int as complete_valid_captures,
    count(*) filter(where first_ms is not null)::int as captured_windows,
    count(*) filter(where invalid is not null)::int as invalid_windows,
    count(*) filter(where result->>'valid'='true' and invalid is null)::int as valid_paired_windows,
    count(*) filter(where close_ms<=${Date.now()} and invalid is null and result is null)::int as pending_official,
    count(*) filter(where result->>'valid'='true' and invalid is null and changed)::int as changed_decision_windows,
    coalesce(sum((result->>'delta')::numeric) filter(where result->>'valid'='true' and invalid is null),0)::float8 as paired_delta_cents
    from desk_voice_windows where experiment=${id}`;
  return {experiment:id,authority:"NONE",enabled:voiceCollectorEnabled(),status:meta?.status??"UNSTARTED",
    start:meta?Number(meta.start_ms):null,end:meta?Number(meta.end_ms):null,build:meta?.build_sha??null,
    replay_bytes:meta?Number(meta.bytes_used):0,...counts,runtime_error:root.__voiceCapture?.error??null,
    limitation:"Observed-ask paper model, not executable IOC fills; no automatic promotion."};
}
