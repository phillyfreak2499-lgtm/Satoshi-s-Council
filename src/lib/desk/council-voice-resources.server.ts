/** Measurements only. Called by the enabled voice observer; no factory jobs. */
import { availableParallelism } from "node:os";
import { readFileSync } from "node:fs";
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";
import { dbPoolStats, type Sql } from "@/lib/db";
import { thresholdsFromEnv } from "./resource-governor.ts";
import type { ResourceGovernorWitness } from "./resource-governor-witness.ts";

type Meter={at:number;used:number};
type State={cpu:Meter|null;delay:IntervalHistogram};
const root=globalThis as typeof globalThis & {__voiceResources?:State};
export function voiceCpuRatio(previous:Meter|null,current:Meter,cpus:number) {
  if(!previous || ![previous.at,previous.used,current.at,current.used,cpus].every(Number.isFinite) ||
      !(current.at>previous.at) || !(current.used>=previous.used) || !(cpus>0)) return NaN;
  return (current.used-previous.used)/((current.at-previous.at)*1000*cpus);
}
export function voiceMemoryLimit(read:(path:string)=>string=(path)=>readFileSync(path,"utf8")) {
  for(const path of ["/sys/fs/cgroup/memory.max","/sys/fs/cgroup/memory/memory.limit_in_bytes"]) {
    try {const n=Number(read(path).trim());if(Number.isFinite(n)&&n>0&&n<2**50)return Math.round(n/1048576);} catch { /* other cgroup version */ }
  }
  return null;
}
export async function sampleVoiceResources(sql:Sql):Promise<ResourceGovernorWitness> {
  if(!root.__voiceResources) {
    const delay=monitorEventLoopDelay({resolution:20});delay.enable();
    root.__voiceResources={cpu:null,delay};
  }
  const st=root.__voiceResources, p99=st.delay.percentile(99)/1e6;st.delay.reset();
  const started=performance.now();await sql`select 1`;const ping=performance.now()-started;
  const usage=process.cpuUsage(), current={at:performance.now(),used:usage.user+usage.system};
  const cpu=voiceCpuRatio(st.cpu,current,availableParallelism());st.cpu=current;
  const pool=dbPoolStats();
  return {measured_at_ms:Date.now(),thresholds:thresholdsFromEnv(process.env,voiceMemoryLimit()),sample:{
    rss_mb:process.memoryUsage().rss/1048576,load_per_cpu:cpu,event_loop_p99_ms:p99,
    db_waiting:pool?.waiting??null,db_in_use:pool?pool.total-pool.idle:null,db_ping_ms:ping,
  }};
}
