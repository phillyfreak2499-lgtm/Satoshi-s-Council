import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
let vite, modules;
async function setup() {
  if(modules) return modules;
  vite=await createServer({configFile:false,envDir:false,resolve:{alias:{'@':`${process.cwd()}/src`}},logLevel:'silent',server:{middlewareMode:true,hmr:false},appType:'custom'});
  const names=['execution-lab','execution-lab-entry','skills','demo','bots','chair','time-gates','selective-entry'];
  const values=await Promise.all(names.map(n=>vite.ssrLoadModule(`/src/lib/desk/${n}.ts`)));
  modules=Object.fromEntries(names.map((n,i)=>[n,values[i]])); return modules;
}
test.after(async()=>{await vite?.close()});
const close=Date.parse('2026-10-02T12:15:00Z');
const entry={side:'UP',cents:82,t:close-300_000};
const point=(t,bid,ask=bid+1)=>({t,yes_bid:bid,yes_ask:ask});
function pathUntil(end,bid=81) { const out=[];for(let t=entry.t;t<=end;t+=4_000)out.push(point(t,bid));return out; }
async function sim(arm,path,e=entry,winner='UP') { return (await setup())['execution-lab'].evaluateExecution(arm,e,close,path,winner); }
test('relative +10 sells exactly once at bid and charges both fees',async()=>{
  const p=[point(entry.t,81),point(entry.t+4_000,92),point(entry.t+8_000,98)];
  const r=await sim('GAIN10',p);assert.equal(r.status,'SOLD');assert.equal(r.exit_cents,92);assert.equal(r.net_cents,7);assert.equal(r.exit_t,entry.t+4_000);
});

test('collector persists once per frame, fails closed on resource skips and skips a restarted open window',async()=>{
  const m=await setup(),db=new PGlite();
  try {
    await db.exec(readFileSync('migrations/0073_desk_execution_lab.sql','utf8'));
    await db.exec('create table desk_ledger_research(ticker text,close_time timestamptz,winner text,source text)');
    const sql=async(strings,...values)=>{let q=strings[0];for(let i=0;i<values.length;i++)q+=`$${i+1}`+strings[i+1];return(await db.query(q,values)).rows;};
    let now=close-901_000,allow=true,reads=0;
    class Clock extends Date { static now(){return now;} }
    const globals={},exp={};
    const frame={snap:{as_of:close-900_000,close_time:close,ticker:'test',demo:false,yes_bid:81,yes_ask:82},chair:{},selective:{ready:true,policy:'ENTRY_OWNER_ROLLBACK_V1'},call_log:[]};
    const code=ts.transpileModule(readFileSync('src/lib/desk/execution-lab.server.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(code,{exports:exp,require:key=>key==='@/lib/db'?{getSql:async()=>sql,dbPoolStats:()=>null}:key==='./execution-lab.ts'?m['execution-lab']:key==='./execution-lab-entry'?m['execution-lab-entry']:key==='./server-engine'?{getServerFrame:async()=>{reads++;return frame;}}:key==='./resource-governor-witness.ts'?{readResourceGovernorWitness:()=>({measured_at_ms:now,sample:{},thresholds:{}})}:key==='./resource-governor.ts'?{governorDecision:()=>({run:allow})}:key==='./window-identity.ts'?{onGrid:()=>true,tickerAgrees:()=>true}:assert.fail(key),process:{env:{EXECUTION_LAB_V1_ENABLED:'true',RENDER_GIT_COMMIT:'build'},memoryUsage:()=>({rss:0})},Date:Clock,JSON,Object,Number,Math,Array,Error,globalThis:globals});
    await exp.executionLabTick();now=close-900_000;await exp.executionLabTick();await exp.executionLabTick();
    let rows=(await db.query('select capture from desk_execution_lab_windows')).rows;
    assert.equal(rows.length,1);assert.equal(rows[0].capture.path.length,1);
    allow=false;const before=reads;await exp.executionLabTick();assert.equal(reads,before);
    allow=true;now+=4_000;frame.snap.as_of=now;await exp.executionLabTick();
    rows=(await db.query('select capture from desk_execution_lab_windows')).rows;
    assert.equal(rows[0].capture.invalid,'resource governor skip');assert.equal(rows[0].capture.path.length,2);
    delete globals.__executionLabV1;now+=4_000;frame.snap.as_of=now;await exp.executionLabTick();
    assert.equal((await db.query('select capture from desk_execution_lab_windows')).rows[0].capture.path.length,2);
  } finally {await db.close();}
});
test('net +10 is distinct from gross +10; an unreachable target holds',async()=>{
  const p=[point(entry.t,92),point(entry.t+4_000,95)];
  const r=await sim('NET10',p);assert.equal(r.exit_cents,95);assert.equal(r.net_cents,10);
  const expensive={...entry,cents:95};const full=pathUntil(close-4_000,98);
  const held=await sim('NET10',full,expensive);assert.equal(held.status,'SETTLED');assert.equal(held.net_cents,4);
});
test('below 50 midpoint is strict; sale uses bid, not the odds proxy',async()=>{
  const p=[point(entry.t,49,51),point(entry.t+4_000,48,50)];
  const r=await sim('BELOW50',p);assert.equal(r.exit_t,entry.t+4_000);assert.equal(r.exit_cents,48);
});
test('DOWN uses NO bid (100 minus YES ask), never NO ask',async()=>{
  const r=await sim('GAIN10',[point(entry.t,17,18),point(entry.t+4_000,7,8)],{...entry,side:'DOWN'});
  assert.equal(r.exit_cents,92);assert.equal(r.net_cents,7);
});
test('two-minute exit is close-relative and never backprices its deadline',async()=>{
  const p=pathUntil(close-116_000);p[p.length-1]=point(close-116_000,70);
  const r=await sim('CLOSE120',p);assert.equal(r.exit_t,close-120_000);assert.equal(r.exit_cents,81);
  const shifted=p.map(a=>({...a,t:a.t+1_000}));shifted.at(-2).yes_bid=70;shifted.at(-2).yes_ask=71;
  const s=await sim('CLOSE120',shifted);assert.equal(s.exit_t,close-119_000);assert.equal(s.exit_cents,70);
});
test('one-minute exit and entries at/after deadline remain correctly scoped',async()=>{
  const p=pathUntil(close-56_000);const r=await sim('CLOSE60',p);assert.equal(r.exit_t,close-60_000);
  const late={...entry,t:close-120_000};const full=Array.from({length:30},(_,i)=>point(late.t+i*4_000,81));
  const s=await sim('CLOSE120',full,late);assert.equal(s.status,'SETTLED');
});
test('trailing stop only arms at +10 and uses the observed high',async()=>{
  const p=[point(entry.t,81),point(entry.t+4_000,92),point(entry.t+8_000,96),point(entry.t+12_000,91)];
  const r=await sim('TRAIL5',p);assert.equal(r.exit_cents,91);assert.equal(r.exit_t,entry.t+12_000);
  const full=pathUntil(close-4_000,86);full[1]=point(entry.t+4_000,81);
  assert.equal((await sim('TRAIL5',full)).status,'SETTLED');
});
test('gaps, conflicting duplicates and crossed books cannot invent exits',async()=>{
  for(const p of [[point(entry.t+12_000,99)], [point(entry.t,81),point(entry.t,92)], [point(entry.t,93,92)]])
    assert.equal((await sim('GAIN10',p)).status,'DATA_INVALID');
  const p=[point(entry.t,92),point(close-1_000,95)];assert.equal((await sim('GAIN10',p)).status,'SOLD');
});
test('post-close target and pre-entry target do not create a sale',async()=>{
  const p=pathUntil(close-4_000);p.unshift(point(entry.t-4_000,95));p.push(point(close,95));
  assert.equal((await sim('GAIN10',p)).status,'SETTLED');
});
test('no entry, missing last coverage and illegal early late-arm entry are explicit',async()=>{
  const m=await setup();assert.equal(m['execution-lab'].evaluateExecution('GAIN10',null,close,[],'UP').status,'NO_ENTRY');
  assert.equal((await sim('GAIN10',[point(entry.t,81)])).status,'DATA_INVALID');
  assert.equal((await sim('LATE120',[],entry)).status,'DATA_INVALID');
});
test('seven frozen arm IDs, boundary and no-production source rail',async()=>{
  const m=await setup();assert.deepEqual(Array.from(m['execution-lab'].EXECUTION_ARMS,a=>a.id),['GAIN10','BELOW50','CLOSE120','CLOSE60','LATE120','TRAIL5','NET10']);
  assert.equal(m['execution-lab'].EXECUTION_PROTOCOL.days,21);
  const text=readFileSync('src/lib/desk/execution-lab.server.ts','utf8');
  for(const x of ['update desk_state','insert into desk_ledger','update desk_learner','sendPush','placeOrder'])assert.ok(!text.includes(x));
  assert.match(text,/env\.EXECUTION_LAB_V1_ENABLED === "true"/);
});
test('real late adapter clears alreadyIn on private copy and never mutates producer inputs',async()=>{
  const m=await setup();const L=m.skills.freshLearner();L.window_memory.entry_lean='UP';
  const snap=m.demo.demoTick(m.demo.newDemoWindow(L.window_memory,120_000),L.window_memory);
  Object.assign(snap,{demo:false,as_of:close-120_000,close_time:close,mins_left:2,secs_left:120});
  const votes=m.bots.runBots(snap,L);const settings={adaptive_bar:true,bar_override:null,mutes:[],beast:false};
  const input={snap,votes,learner:L,settings,calls:[],start:close-900_000,ready:true,watch:null,lastLean:'WAIT'};
  const before=JSON.stringify(input);m['execution-lab-entry'].lateEntry(input);assert.equal(JSON.stringify(input),before);
  for(const s of [121,0,-1])assert.equal(m['execution-lab-entry'].lateEntry({...input,snap:{...snap,as_of:close-s*1000}}).entry,null);
  assert.equal(m['execution-lab-entry'].lateEntry({...input,ready:false}).entry,null);
});

test('late-only independently admits a fresh supported frame after the primary booked early; risk tightening still blocks',async()=>{
  const m=await setup(), L=m.skills.freshLearner();
  for(const [seat,card] of [['STRIKE','STRIKE.itm_time'],['CHAIN','CHAIN.oi_with_price']]) {
    L.seat_n[seat]=100;L.seat_hits[seat]=80;L.seat_w[seat]=.2;
    Object.assign(L.skills[card],{status:'LIVE',n:100,ev_n:100,wilson:.8,ev:5,manual_hold:false,min_walkforward_n:undefined,min_regime_n:undefined});
  }
  L.window_memory.entry_lean='DOWN';
  const at=close-120_000;
  const snap={as_of:at,close_time:close,ticker:'KXBTC15M-26OCT020815-15',mins_left:2,secs_left:120,
    yes_ask:85,yes_bid:84,no_ask:16,no_bid:15,yes_bid_size:7,no_bid_size:5,edge_up:6,edge_down:-8,fair_yes:90,lab_fair_yes:92,lab_age_s:1,
    fee_yes:2,fee_no:2,spread_cents:1,leftover_cents:-1,spot:80000,strike:79000,spot_age_s:1,quote_age_s:1,print_age_s:1,quote_seq:1,
    obs:{receipt_ts:at-1000,gap:'ok'},health:{spot_ok:true,kalshi_ok:true,spot:'LIVE',kalshi:'LIVE',derivs:'LIVE',spot_divergent:false,basis_wide:false},
    phase:'FINAL',regime_key:'integration',session:'US_AM',demo:false,chalk:false,ret5:0,ret15:0,ret30:0,ret1h:0,atr:1,atr_pct:.2,
    vol_median:1,vol_last:1,vol_percentile:.5,location:'MID',range_pos:.5,imbalance:0,imbalance_hist:[],candles_1m:[],window_memory:{},clock_key:'integration',
    funding_rate:0,funding_apr:0,funding_time:at,funding_history:[],funding_series:[],open_interest:1,oi_usd:1,oi_history:[],oi_series:[],oi_usd_series:[],
    oi_delta_3m:0,oi_delta_10m:0,oi_delta_1h:0,oi_usd_delta_10m:0,liq_long_usd:0,liq_short_usd:0,liq_n:0,liq_source:'',force_n:0,cascade_proxy:false,fear_greed:50,fear_greed_label:'neutral',fng_history:[]};
  const votes=[['STRIKE','STRIKE.itm_time'],['CHAIN','CHAIN.oi_with_price']].map(([seat,skill_used])=>({seat,skill_used,lean:'UP',confidence:100,features:{},reasoning:'synthetic entry integration',skill_status:'LIVE',shadow:null,paper:[],thresh_used:[],skill_n:100,skill_hits:80,skill_wilson:.8,hypothesis:'',evidence:[],counter:'',invalidate_if:'',health:'LIVE',feed_age_s:1,eyes:'',phase:'FINAL'}));
  const input={snap,votes,learner:L,settings:{adaptive_bar:true,bar_override:.1,mutes:[],beast:false},calls:[],start:close-900_000,ready:true,watch:null,lastLean:'WAIT'};
  const r=m['execution-lab-entry'].lateEntry(input);assert.ok(r.entry);assert.equal(r.entry.t,at);assert.equal(r.entry.side,'UP');assert.equal(r.entry.cents,85);assert.equal(L.window_memory.entry_lean,'DOWN');
  const calls=[1,2].map(n=>({id:String(n),ticker:'prior'+n,t:at-n*900_000-1000,close_time:at-n*900_000+1000,lean:'UP',cents:85,settle:0,flipped:false}));
  assert.equal(m['execution-lab-entry'].lateEntry({...input,calls}).entry,null,'tightened 3–10 minute gate is not bypassed');
  assert.equal(m['execution-lab-entry'].lateEntry({...input,snap:{...snap,no_bid_size:0}}).entry,null);
  assert.equal(m['execution-lab-entry'].lateEntry({...input,snap:{...snap,edge_up:0}}).entry,null);
  assert.equal(m['execution-lab-entry'].lateEntry({...input,snap:{...snap,yes_ask:79}}).entry,null);
});

test('real migration, durable boundary, official-only grading, paired late control and no overwrite',async()=>{
  const m=await setup();const db=new PGlite();
  try {
    await db.exec(readFileSync('migrations/0073_desk_execution_lab.sql','utf8'));
    await db.exec(readFileSync('migrations/0073_desk_execution_lab.sql','utf8'));
    await db.exec('create table desk_ledger_research(ticker text,close_time timestamptz,winner text,source text)');
    const sql=async(strings,...values)=>{let q=strings[0];for(let i=0;i<values.length;i++)q+=`$${i+1}`+strings[i+1];return (await db.query(q,values)).rows;};
    const exp={};const code=ts.transpileModule(readFileSync('src/lib/desk/execution-lab.server.ts','utf8')+'\nexport const harness={initialize,gradePending,ownLateCalls};', {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(code,{exports:exp,require:key=>key==='@/lib/db'?{getSql:async()=>sql,dbPoolStats:()=>null}:key==='./execution-lab.ts'?m['execution-lab']:key==='./execution-lab-entry'?m['execution-lab-entry']:key==='./resource-governor-witness.ts'?{readResourceGovernorWitness:()=>null}:key==='./resource-governor.ts'?{governorDecision:()=>({run:false})}:key==='./window-identity.ts'?{onGrid:()=>true,tickerAgrees:()=>true}:assert.fail(key),process:{env:{}},Date,JSON,Object,Number,Math,Array,Error,globalThis:{},setInterval:()=>assert.fail('disabled observer started')});
    assert.equal(exp.ensureExecutionLab(),'disabled');
    const st={boot:close-901_000};await exp.harness.initialize(st);assert.equal(st.start,close-900_000);assert.equal(st.end-st.start,21*86_400_000);
    const restart={boot:close+1_000};await exp.harness.initialize(restart);assert.equal(restart.start,st.start);assert.equal(restart.end,st.end);
    const primary={...entry,t:close-300_000};const late={side:'UP',cents:84,t:close-120_000};
    const path=Array.from({length:225},(_,i)=>point(close-900_000+i*4_000,81));
    await db.query('insert into desk_execution_lab_windows(experiment,ticker,close_ms,build_sha,capture) values($1,$2,$3,$4,$5)', ['EXECUTION_LAB_V1','test',close,'build',JSON.stringify({entry:primary,late,path,invalid:null})]);
    await db.query('insert into desk_ledger_research values($1,$2,$3,$4)',['test',new Date(close).toISOString(),'UP','spot-derived']);
    await exp.harness.gradePending();assert.equal((await db.query('select results from desk_execution_lab_windows')).rows[0].results,null);
    await db.query("update desk_ledger_research set source='kalshi-result'");await exp.harness.gradePending();
    const results=(await db.query('select results from desk_execution_lab_windows')).rows[0].results;
    const lr=results.find(r=>r.arm==='LATE120');assert.equal(lr.net_cents,15);assert.equal(lr.hold_cents,16);assert.equal(lr.delta_cents,-1);
    assert.equal((await exp.harness.ownLateCalls())[0].settle,100);
    await db.query("update desk_ledger_research set winner='DOWN'");await exp.harness.gradePending();assert.deepEqual((await db.query('select results from desk_execution_lab_windows')).rows[0].results,results);
  } finally { await db.close(); }
});
