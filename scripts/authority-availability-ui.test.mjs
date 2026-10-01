import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require=createRequire(import.meta.url);
let frame;
const noop=()=>null;
const passthrough=({children})=>React.createElement('div',null,children);
const overrides={
 './SeatLeanMeter.css':{},
 '@/lib/desk/store':{useDesk:()=>frame},
 '@/lib/desk/hooks':{useCountdownText:()=> '6m'},
 '@/lib/desk/chamber-speech':{listChamberSpeech:async()=>[]},
 '@/lib/desk/beacon':{beacon:()=>{}},
 '@/lib/desk/book-floor':{bookState:()=>({})},
 '@/lib/desk/chair-words':{plainLine:()=>''},
 '@/lib/desk/guided-read':{guidedRead:()=>({label:'WAIT',tone:'',why:'fixture',note:''})},
 '@/lib/desk/guided-continuity':{whatHappened:()=>null,whatWouldChange:()=>({stance:'WAIT',supports:[],conditions:[],multiple:false}),MULTI_BLOCKER_LINE:''},
 './Tip':{Tip:passthrough},'./Eyes':{Eyes:noop},
 './LastCallPanel':{LastCallPanel:noop},'./AlertsPanel':{AlertsPanel:noop},'./WaitResearchNote':{WaitResearchNote:noop},
 './RosterEvidence':{RosterEvidence:noop},'./PaperDisclaimer':{PaperDisclaimer:noop},'./GlobalHeader':{GlobalHeader:noop},'./Crest':{Crest:noop},'./CouncilVoiceButton':{CouncilVoiceButton:noop},
};
const cache=new Map();
function load(path){
 const file=resolve(path);if(cache.has(file))return cache.get(file);
 const out=ts.transpileModule(readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const mod={exports:{}};cache.set(file,mod.exports);
 const req=id=>{
   if(id in overrides)return overrides[id];
   if(!id.startsWith('.')&&!id.startsWith('@/'))return require(id);
   const base=id.startsWith('@/')?join(process.cwd(),'src',id.slice(2)):resolve(dirname(file),id);
   const found=[base,base+'.ts',base+'.tsx',base+'/index.ts'].find(p=>existsSync(p));if(!found)throw Error('unresolved '+id+' from '+file);
   return load(found);
 };
 new Function('require','module','exports',out)(req,mod,mod.exports);return mod.exports;
}
const publicModel=load('src/lib/desk/council-public.ts');
const models=load('src/lib/desk/pro-floor.ts');
const leans=load('src/lib/desk/seat-lean.ts');
const {SeatLeanSummary}=load('src/components/desk/SeatLeanMeter.tsx');
const {BotCard}=load('src/components/desk/BotCard.tsx');
const {ChamberRoster}=load('src/components/desk/ChamberRoom.tsx');
const {GuidedFloor}=load('src/components/desk/GuidedFloorView.tsx');
const {EvidenceFamilies}=load('src/components/desk/ProFloor/EvidenceFamilies.tsx');
const {PaperPositionCard}=load('src/components/desk/ProFloor/PaperPositionCard.tsx');
const {DecisionLayerMark}=load('src/components/desk/DecisionLayerMark.tsx');
const render=(C,props)=>renderToStaticMarkup(React.createElement(C,props));
const text=html=>html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const window={ticker:'KXBTC15M-26SEP301900-00',close_time:Date.parse('2026-10-01T00:00:00Z'),as_of:Date.parse('2026-09-30T23:54:00Z')};
function fixture(){
 const snap={...window,phase:'MID',spot:80000,strike:79900,health:{spot:'LIVE',kalshi:'LIVE'},mins_left:6,secs_left:360};
 const row=(seat,selectable,ready,reason='')=>({seat,callsign:seat,lean:'WAIT',conf:0,skill_used:'SIT',status:'LIVE',health:'LIVE',weight:0.1,contribution:0,forced_sit:false,folded:false,selectable_live_cards:selectable,authority_ready_cards:ready,authority_hold_reason:reason,abstention_eligible:ready>0});
 const rows=[row('STRIKE',1,1),row('CHAIN',1,1),row('DRIFT',1,0,'COACH bench active'),row('WICK',0,0)];
 const votes=rows.map(r=>({...r,confidence:0,skill_status:'SIT',reasoning:'research',hypothesis:'research',raw_lean:'WAIT',raw_conf:0,feed_age_s:1}));
 const chair={rows,quorum:{up:0,down:0,wait:2},lean:'WAIT',gates:[],confidence:0};
 const learner={knobs:{DRIFT:{benched_until:window.as_of+60000}},skills:{},seat_n:{},seat_hits:{}};
 frame={chair,learner,snap,votes};return {snap,chair,votes,learner};
}
test('rendering: Chamber cards, seat-page summaries and compact cards distinguish quarantine from COACH hold',()=>{
 const {chair,votes,snap,learner}=fixture();
 const room=render(ChamberRoster,{rows:chair.rows});
 assert.match(text(room),/Research quarantine — no selectable LIVE card/);assert.match(text(room),/Held — COACH bench active/);
 assert.doesNotMatch(room,/>voting</);
 for(const seat of ['WICK','DRIFT']){
  const r=chair.rows.find(r=>r.seat===seat);const vote=votes.find(v=>v.seat===seat);
  const lean=leans.seatDirectionalLean(models.seatFactFor(seat,vote,r,learner.knobs,snap.as_of),window);
  const expected=publicModel.seatAvailabilityLabel(r);
  assert.ok(text(render(SeatLeanSummary,{lean})).includes(expected),seat+' summary');
  assert.ok(text(render(BotCard,{seat,snap,vote,compact:true})).includes(expected),seat+' compact card');
 }
});
test('rendering: Guided and Pro dynamic authority counts exclude an active COACH bench',()=>{
 const {chair,votes,snap,learner}=fixture();
 const guided=text(render(GuidedFloor,{chair,votes,snap,knobs:learner.knobs,callLog:[],demo:false,onPro:()=>{}}));
 const facts=models.seatFacts(chair,votes,learner.knobs,snap.as_of);
 const families=models.familyFacts(facts);const balance=models.balanceFacts(chair,facts,families);
 const pro=text(render(EvidenceFamilies,{facts:{seats:facts,families,balance},onJump:()=>{}}));
 for(const html of [guided,pro]){
  assert.match(html,/3 sources with selectable LIVE cards · 2 with seat authority available now/);
  assert.match(html,/Held — COACH bench active/);
  assert.doesNotMatch(html,/15 currently voting/);
 }
 const drift=facts.find(f=>f.seat==='DRIFT');assert.equal(drift.authority_ready_cards,0);assert.equal(drift.abstention_eligible,false);
 assert.equal(families.reduce((n,f)=>n+f.wait,0),2);
});
test('rendering: absent authority metadata stays unverified rather than voting',()=>{
 fixture();const room=text(render(ChamberRoster,{rows:[]}));
 assert.match(room,/Authority unverified/);assert.doesNotMatch(room,/LIVE authority available/);
});
test('CONTEXT availability labels have separate wrapping rows, including pit crew and non-voters',()=>{
 const {chair,votes,snap}=fixture();
 for(const seat of ['ORBIT','CLOCK','WIRE']) {
  chair.rows.push({...chair.rows[3],seat,callsign:seat});
  votes.push({...votes[3],seat});
 }
 const seats=models.seatFacts(chair,votes,{},snap.as_of);
 const families=models.familyFacts(seats);
 const html=render(EvidenceFamilies,{facts:{seats,families,balance:models.balanceFacts(chair,seats,families)},onJump:()=>{}});
 for(const seat of ['ORBIT','CLOCK','WIRE'])assert.match(html,new RegExp('>'+seat+'<'));
 assert.match(html,/flex min-w-0 flex-1 flex-col gap-1 py-2/);
 assert.doesNotMatch(html,/w-\[5\.25rem\].*whitespace-nowrap/);
 assert.match(html,/break-words font-sans/);
});

test('three decision layers keep distinct permanent labels and surface ownership',()=>{
 const marks=['research','decision','position'].map(layer=>render(DecisionLayerMark,{layer}));
 assert.match(marks[0],/data-decision-layer="research"[^>]*>.*Research lean/);
 assert.match(marks[1],/data-decision-layer="decision"[^>]*>.*SATOSHI decision/);
 assert.match(marks[2],/data-decision-layer="position"[^>]*>.*Paper position/);
 assert.equal(new Set(marks).size,3);
 const {chair,votes,snap,learner}=fixture();
 const compact=render(BotCard,{seat:'WICK',snap,vote:votes.find(v=>v.seat==='WICK'),compact:true});
 assert.match(compact,/data-decision-layer="research"/);
 const guided=render(GuidedFloor,{chair,votes,snap,knobs:learner.knobs,callLog:[],demo:false,onPro:()=>{}});
 assert.match(guided,/data-decision-layer="decision"/);assert.match(guided,/data-decision-layer="research"/);
 const paper=render(PaperPositionCard,{facts:{conclusion:{lean:'WAIT'},paper:{held:false,no_position_why:'No paper position',entry_source:null,entry_side:null,entry_cents:null,entry_at:null,ask_now:null,floor_cents:80,state:{kind:'none'}}},full:false});
 assert.match(paper,/data-decision-layer="decision"/);assert.match(paper,/data-decision-layer="position"/);
});

test('compact Pro status keeps a directional opinion separate from the actual book',()=>{
 const {StickyDecisionHeader}=load('src/components/desk/ProFloor/StickyDecisionHeader.tsx');
 const facts={market:{close_time:window.close_time,secs_left:360},conclusion:{lean:'UP'},paper:{held:false}};
 const empty=text(render(StickyDecisionHeader,{facts}));
 assert.match(empty,/SATOSHI decision UP/);assert.match(empty,/Paper position NONE/);
 const held=text(render(StickyDecisionHeader,{facts:{...facts,paper:{held:true}}}));
 assert.match(held,/Paper position HELD/);assert.match(held,/Window closes in/);
});
