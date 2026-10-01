import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
let vite;
let m;
async function setup() {
  if (m) return m;
  vite = await createServer({envDir:false, logLevel:'silent',server:{middlewareMode:true},appType:'custom'});
  const [skills,bots,chair,demo,authority]=await Promise.all(['skills','bots','chair','demo','council-authority'].map(n=>vite.ssrLoadModule(`/src/lib/desk/${n}.ts`)));
  return m={skills,bots,chair,demo,authority};
}
test.after(async()=>{await vite?.close()});
const settings={adaptive_bar:true,bar_override:null,mutes:[],beast:false};
const crew=new Set(['WARDEN','ORBIT','WIRE']);
function fixture(m) {
 const L=m.skills.freshLearner();
 for(const c of Object.values(L.skills))if(!crew.has(c.owner))c.status='SHADOW';
 const snap=m.demo.demoTick(m.demo.newDemoWindow(L.window_memory,360000),L.window_memory);
 snap.demo=false;
 return {L,snap};
}
test('real producer all-SHADOW ordinary waits cannot add sit tax or WAIT quorum',async()=>{
 const m=await setup();const {L,snap}=fixture(m);const votes=m.bots.runBots(snap,L);
 assert.ok(votes.some(v=>v.skill_used==='SIT'&&!v.forced_sit));
 const full=m.chair.runChair(votes,snap,L,settings);
 const removed=m.chair.runChair(votes.filter(v=>crew.has(v.seat)),snap,L,settings);
 assert.equal(full.sit_mass,0);assert.equal(full.bar,removed.bar);assert.equal(full.quorum.wait,0);
 for(const r of full.rows){assert.equal(r.selectable_live_cards,0);assert.equal(r.authority_ready_cards,0)}
});
test('a genuine authorized WAIT still contributes sit tax; holding its card removes only that authority',async()=>{
 const m=await setup();const {L,snap}=fixture(m);
 Object.assign(L.skills['DRIFT.aligned_3h'],{status:'LIVE',n:100,ev_n:100,wilson:0.9,ev:5,manual_hold:false,min_walkforward_n:undefined,min_regime_n:undefined});
 const votes=m.bots.runBots(snap,L).map(v=>v.seat==='DRIFT'?{...v,lean:'WAIT',forced_sit:false,skill_used:'SIT',skill_status:'SIT'}:v);
 const live=m.chair.runChair(votes,snap,L,settings);
 assert.equal(live.sit_mass,1);assert.equal(live.quorum.wait,1);
 L.skills['DRIFT.aligned_3h'].manual_hold=true;
 const held=m.chair.runChair(votes,snap,L,settings);
 assert.equal(held.sit_mass,0);assert.equal(held.quorum.wait,0);
 assert.ok(Math.abs(live.bar-held.bar-0.2)<1e-9);
});
test('availability distinguishes selectable cards from mature directional authority without mutating them',async()=>{
 const m=await setup();const {L,snap}=fixture(m);
 const c=L.skills['DRIFT.aligned_3h'];Object.assign(c,{status:'LIVE',n:30,ev_n:30,manual_hold:false,min_walkforward_n:undefined,min_regime_n:undefined});
 const before=JSON.stringify(L);
 assert.deepEqual(m.authority.seatCardAvailability('DRIFT',L,snap.regime_key),{selectable_live_cards:1,authority_ready_cards:0});
 assert.equal(JSON.stringify(L),before);
});
test('mixed roster: quarantined ordinary WAITs cannot suppress two admitted directions',async()=>{
 const m=await setup();const {L,snap}=fixture(m);
 for(const id of ['STRIKE.itm_time','CHAIN.oi_with_price'])Object.assign(L.skills[id],{status:'LIVE',n:100,ev_n:100,wilson:0.9,ev:5,manual_hold:false,min_walkforward_n:undefined,min_regime_n:undefined});
 const ids={STRIKE:'STRIKE.itm_time',CHAIN:'CHAIN.oi_with_price'};
 const votes=m.bots.runBots(snap,L).map(v=>ids[v.seat]?{...v,lean:'UP',confidence:80,skill_used:ids[v.seat],skill_status:'LIVE',forced_sit:false}:v);
 const full=m.chair.runChair(votes,snap,L,settings);
 const active=m.chair.runChair(votes.filter(v=>crew.has(v.seat)||ids[v.seat]),snap,L,settings);
 assert.equal(full.sit_mass,0);assert.equal(full.bar,active.bar);assert.equal(full.score,active.score);
 assert.deepEqual(full.quorum,active.quorum);
});
test('public availability uses verified inventory and does not invent a fixed active count',async()=>{
 const {availabilityLine}=await import('../src/lib/desk/council-public.ts');
 assert.match(availabilityLine([{selectable_live_cards:1,authority_ready_cards:1},{selectable_live_cards:2,authority_ready_cards:0},{selectable_live_cards:0,authority_ready_cards:0}]),/^2 sources with selectable LIVE cards · 1 with card authority/);
 assert.match(availabilityLine([{}]),/unverified/);
 assert.match(availabilityLine([]),/unverified/);
});
