/** Prospective collector beside the desk, never in its decision path.
 * Default OFF. On activation the NEXT complete window starts a durable 21-day
 * batch. Restart skips the open window, preserves prior receipts and end time.
 * Primary exit arms share actual entries and the same observed bid path.
 * LATE120 has its own risk history and fresh entry revalidation. */
import { getSql, dbPoolStats } from "@/lib/db";
import { EXECUTION_ARMS, EXECUTION_LAB_ID, EXECUTION_PROTOCOL, evaluateExecution, type ExecutionResult } from "./execution-lab.ts";
import { lateEntry } from "./execution-lab-entry";
import { readResourceGovernorWitness } from "./resource-governor-witness.ts";
import { governorDecision } from "./resource-governor.ts";
import { onGrid, tickerAgrees } from "./window-identity.ts";
import type { Entry, PricePoint, Side } from "./exit-arena.ts";
import type { CallLogRow, Lean, Settings } from "./types";
import type { EntryWatch } from "./selective-entry.ts";
import type { Stick } from "./stick";

type Capture = { entry: Entry | null; late: Entry | null; path: PricePoint[]; invalid: string | null };
type Window = { ticker: string; close: number; capture: Capture; watch: EntryWatch | null; lastLean: Lean; last: number; stick?:Stick };
type State = { timer: ReturnType<typeof setInterval> | null; busy: boolean; boot: number;
  start: number | null; end: number | null; active: Window | null; error: string | null;
  lastCapture: number | null; skips: number; lastGrade: number; };
const root = globalThis as typeof globalThis & { __executionLabV1?: State };
const state = (): State => root.__executionLabV1 ??= { timer: null, busy: false, boot: Date.now(),
  start: null, end: null, active: null, error: null, lastCapture: null, skips: 0, lastGrade: 0 };
export const executionLabEnabled = (env: Record<string,string|undefined> = process.env) => env.EXECUTION_LAB_V1_ENABLED === "true";
const nextWindow = (t: number) => (Math.floor(t/900_000)+1)*900_000;

function resourcesPermit(): boolean {
  const witness = readResourceGovernorWitness();
  if (!witness || !Number.isFinite(witness.measured_at_ms) || Date.now()-witness.measured_at_ms>60_000)
    return false;
  const pool=dbPoolStats();
  return governorDecision({...witness.sample,rss_mb:process.memoryUsage().rss/1_048_576,
    db_waiting:pool?pool.waiting:witness.sample.db_waiting,
    db_in_use:pool?pool.total-pool.idle:witness.sample.db_in_use},witness.thresholds).run;
}

async function initialize(st: State) {
  const sql = await getSql();
  const start = nextWindow(st.boot), end = start+EXECUTION_PROTOCOL.days*86_400_000;
  await sql`insert into desk_execution_lab_meta (experiment,start_ms,end_ms,protocol)
    values (${EXECUTION_LAB_ID},${start},${end},${JSON.stringify(EXECUTION_PROTOCOL)}::jsonb)
    on conflict (experiment) do nothing`;
  const [r] = await sql<{ start_ms: string; end_ms: string; protocol: typeof EXECUTION_PROTOCOL }>`
    select start_ms,end_ms,protocol from desk_execution_lab_meta where experiment=${EXECUTION_LAB_ID}`;
    if (!r || !r.protocol || Object.entries(EXECUTION_PROTOCOL).some(([key,value]) =>
      r.protocol[key as keyof typeof EXECUTION_PROTOCOL] !== value))
    throw Error("execution protocol identity mismatch");
  st.start = Number(r.start_ms); st.end = Number(r.end_ms);
}

async function excludeWindow(st: State, reason: string) {
  st.skips++;
  if (st.active) st.active.capture.invalid = reason;
  if (st.start == null || st.end == null) return;
  // The UTC close identifies even a fully skipped window with no captured ticker.
  const closes = [...new Set([nextWindow(Date.now()), ...(st.active ? [st.active.close] : [])])]
    .filter(close => close-900_000 >= st.start! && close-900_000 < st.end!);
  const sql = await getSql();
  for (const close of closes) {
    await sql`with excluded as (
      insert into desk_execution_lab_exclusions (experiment,close_ms,reason)
      values (${EXECUTION_LAB_ID},${close},${reason})
      on conflict (experiment,close_ms) do update set reason=desk_execution_lab_exclusions.reason
      returning experiment,close_ms,reason
    ) update desk_execution_lab_windows w set results=null,exclusion_reason=x.reason from excluded x
      where w.experiment=x.experiment and w.close_ms=x.close_ms`;
  }
  // A concurrent grade is retried as invalid; capture upserts never clear exclusions.
}

/** Only our own captures, joined on BOTH exact window keys to the existing
 * research-qualified official winner. No spot-derived grades or history edits. */
async function gradePending() {
  const sql = await getSql();
  const rows = await sql<{ ticker: string; close_ms: string; capture: Capture; winner: Side; exclusion_reason: string | null; capture_exclusion: string | null }>`
    select e.ticker,e.close_ms,e.capture,x.reason as exclusion_reason,e.exclusion_reason as capture_exclusion,l.winner from desk_execution_lab_windows e
    left join desk_execution_lab_exclusions x on x.experiment=e.experiment and x.close_ms=e.close_ms
    join desk_ledger_research l on l.ticker=e.ticker and l.close_time=to_timestamp(e.close_ms/1000.0)
    where e.experiment=${EXECUTION_LAB_ID} and e.results is null and l.winner in ('UP','DOWN') and l.source='kalshi-result'
    order by e.close_ms limit 24`;
  for (const r of rows) {
    const close = Number(r.close_ms), c = r.capture;
    const wholeWindowInvalid=r.exclusion_reason || r.capture_exclusion || c.invalid || (!c.path.length || c.path[0]!.t>close-900_000+8_000 ||
      c.path[c.path.length-1]!.t<close-10_000 ? "incomplete window capture" : null);
    const results = ["HOLD", ...EXECUTION_ARMS.map(a=>a.id)].map(arm => {
      const a = arm as ExecutionResult["arm"];
      const entry = a === "LATE120" ? c.late : c.entry;
      const result = evaluateExecution(a, entry, close, c.path, r.winner);
      // Keep NO_ENTRY separate; missing capture is never zero-return evidence.
      return wholeWindowInvalid ? { ...result, status: "DATA_INVALID", net_cents: null,
        hold_cents: null, delta_cents: null, reason: wholeWindowInvalid } : result;
    });
    // Late-only changes entry, so its control is the actual primary HOLD on
    // every fully observed window, including honest no-entry windows at 0.
    const primary=results.find(a=>a.arm==="HOLD")!;
    const late=results.find(a=>a.arm==="LATE120")!;
    if(primary.status!=="DATA_INVALID" && late.status!=="DATA_INVALID") {
      const baseline=primary.net_cents??0;
      late.net_cents=late.net_cents??0; late.hold_cents=baseline;
      late.delta_cents=Math.round((late.net_cents-baseline)*10)/10;
    }
    await sql`update desk_execution_lab_windows set results=${JSON.stringify(results)}::jsonb
      where experiment=${EXECUTION_LAB_ID} and ticker=${r.ticker} and close_ms=${close} and results is null
        and exclusion_reason is not distinct from ${r.capture_exclusion}
        and (select reason from desk_execution_lab_exclusions
          where experiment=${EXECUTION_LAB_ID} and close_ms=${close}) is not distinct from ${r.exclusion_reason}`;
  }
}

async function ownLateCalls(): Promise<CallLogRow[]> {
  const sql = await getSql();
  const rows = await sql<{ticker:string;close_ms:string;capture:Capture;results:ExecutionResult[]|null}>`
    select ticker,close_ms,capture,results from desk_execution_lab_windows
    where experiment=${EXECUTION_LAB_ID} and capture->'late' <> 'null'::jsonb order by close_ms desc limit 160`;
  return rows.flatMap(r => {
    const entry = r.capture.late;
    if (!entry) return [];
    const result = r.results?.find(a=>a.arm === "LATE120");
    // Invalid observations remain unresolved risk, not invented winners.
    const settled = result?.status === "SETTLED" && result.net_cents != null;
    return [{ id: `${EXECUTION_LAB_ID}|LATE120|${r.ticker}|${r.close_ms}`, ticker:r.ticker,
      close_time:Number(r.close_ms), t:entry.t, lean:entry.side, cents:entry.cents,
      settle:settled ? result.net_cents! > 0 ? 100 : 0 : null, flipped:false }];
  });
}

export async function executionLabTick(): Promise<void> {
  if (!executionLabEnabled()) return;
  const st = state();
  if (st.busy) {
    try { await excludeWindow(st, "busy observation skip"); }
    catch(error) { st.error=error instanceof Error?error.message:String(error); }
    return;
  }
  st.busy = true;
  try {
    if (!resourcesPermit()) {
      await excludeWindow(st, "resource governor skip"); return;
    }
    if (st.start == null) await initialize(st);
    if (Date.now()-st.lastGrade >= 30_000) { await gradePending(); st.lastGrade=Date.now(); }
    if (Date.now() >= st.end!) { st.active=null; return; }
    const { getServerFrame } = await import("./server-engine");
    const frame = await getServerFrame();
    const snap = frame.snap;
    const now = Date.now();
    if (!snap || snap.demo || !frame.chair || !frame.selective.ready || frame.selective.policy!=="ENTRY_OWNER_ROLLBACK_V1" || snap.as_of>now ||
        now-snap.as_of>8_000 || !onGrid(snap.close_time) || !tickerAgrees(snap.ticker,snap.close_time) ||
        snap.as_of >= snap.close_time || snap.as_of < snap.close_time-900_000) return;
    const open=snap.close_time-900_000;
    if (open<st.start! || open<st.boot || open>=st.end!) return;
    if (!st.active || st.active.ticker!==snap.ticker || st.active.close!==snap.close_time)
      st.active={ticker:snap.ticker,close:snap.close_time,capture:{entry:null,late:null,path:[],invalid:null},watch:null,lastLean:"WAIT",last:0};
    const w=st.active;
    if(snap.as_of <= w.last) return;
    if(w.last && snap.as_of-w.last>10_000) w.capture.invalid="observation gap exceeds 10 seconds";
    w.last=snap.as_of;
    if(w.capture.path.length===0 && snap.as_of-open>8_000) w.capture.invalid="opening capture missed";
    const primary=frame.call_log.find(c=>!c.source && c.ticker===snap.ticker && c.close_time===snap.close_time && c.t>=open);
    if(primary && !w.capture.entry) {
      w.capture.entry={side:primary.lean,cents:primary.cents,t:primary.t};
      if(snap.as_of-primary.t>8_000) w.capture.invalid="primary entry was not witnessed promptly";
    }
    if(!w.capture.late && snap.close_time-snap.as_of<=120_000) {
      const calls=await ownLateCalls();
      const settings:Settings={...frame.settings,poll_ms:4_000,source:"live",show_faded:false,show_shadow:false,tz:"America/Chicago"};
      const candidate=lateEntry({snap,votes:frame.votes,learner:frame.learner,settings,calls,
        start:st.start!,ready:frame.selective.ready,watch:w.watch,lastLean:w.lastLean,stick:w.stick});
      w.watch=candidate.watch; w.lastLean=candidate.lean; w.stick=candidate.stick;
      // Recheck wall time after work: no booked-at-an-expired-frame invention.
      if(candidate.entry && Date.now()-snap.as_of<=8_000 && Date.now()<snap.close_time) w.capture.late=candidate.entry;
    }
    // Store the quote spine once for all arms, bounded to 226 samples/window.
    w.capture.path.push({t:snap.as_of,yes_bid:snap.yes_bid,yes_ask:snap.yes_ask});
    if(w.capture.path.length>226) { w.capture.invalid="window sample cap exceeded"; w.capture.path=w.capture.path.slice(-226); }
    const sql=await getSql();
    const build=String(process.env.RENDER_GIT_COMMIT??"unknown");
    await sql`insert into desk_execution_lab_windows (experiment,ticker,close_ms,build_sha,capture)
      values (${EXECUTION_LAB_ID},${w.ticker},${w.close},${build},${JSON.stringify(w.capture)}::jsonb)
      on conflict (experiment,ticker,close_ms) do update set capture=excluded.capture
      where desk_execution_lab_windows.results is null and desk_execution_lab_windows.build_sha=excluded.build_sha`;
    st.lastCapture=snap.as_of; st.error=null;
  } catch(error) { st.error=error instanceof Error?error.message:String(error); if(st.active) st.active.capture.invalid="capture or persistence failure"; }
  finally { st.busy=false; }
}

export function ensureExecutionLab(): "disabled" | "started" | "already" {
  if(!executionLabEnabled()) return "disabled";
  const st=state(); if(st.timer) return "already";
  st.timer=setInterval(()=>void executionLabTick(),4_000);
  void executionLabTick(); return "started";
}
export async function executionLabReport() {
  const sql=await getSql();
  const [meta]=await sql<{start_ms:string;end_ms:string}>`select start_ms,end_ms from desk_execution_lab_meta where experiment=${EXECUTION_LAB_ID}`;
  const [coverage]=await sql<{captured:number;pending:number}>`select count(*)::int as captured,
    count(*) filter(where results is null)::int as pending from desk_execution_lab_windows where experiment=${EXECUTION_LAB_ID}`;
  const raw=await sql<{arm:string;n:number;invalid:number;no_entry:number;net:number|null;delta:number|null;hold:number|null}>`
    select r->>'arm' as arm,count(*) filter(where r->>'status' in ('SOLD','SETTLED'))::int as n,
      count(*) filter(where r->>'status'='DATA_INVALID')::int as invalid,
      count(*) filter(where r->>'status'='NO_ENTRY')::int as no_entry,
      sum((r->>'net_cents')::numeric) as net,sum((r->>'delta_cents')::numeric) as delta,
      sum((r->>'hold_cents')::numeric) as hold
    from desk_execution_lab_windows e cross join lateral jsonb_array_elements(e.results) r
    where e.experiment=${EXECUTION_LAB_ID} group by r->>'arm'`;
  return { id:EXECUTION_LAB_ID,authority:"NONE" as const,enabled:executionLabEnabled(),
    start:meta?Number(meta.start_ms):null,end:meta?Number(meta.end_ms):null,
    captured:coverage?.captured??0,pending:coverage?.pending??0,
    health:{last_capture:root.__executionLabV1?.lastCapture??null,error:root.__executionLabV1?.error??null,skips:root.__executionLabV1?.skips??0},
    rows:EXECUTION_ARMS.map(a=>({ ...a,...(raw.find(r=>r.arm===a.id)??{n:0,invalid:0,no_entry:0,net:null,delta:null,hold:null}) })) };
}
