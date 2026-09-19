import {drawMomentumChart,drawPractice} from "./chart.js";

let frame=null;
let frozen=null;
let voice=false;
const byId=id=>document.getElementById(id);
const dialogs={
  why:byId("observation-dialog"),
  challenge:byId("challenge-dialog"),
  "open-chat":byId("chat-dialog"),
  focus:byId("screen-dialog"),
  notes:byId("notes-dialog"),
  practice:byId("practice-dialog")
};
const pct=n=>Number.isFinite(Number(n))?(Number(n)*100):null;
const fmt=n=>{const v=pct(n);return v==null?"—":(v>=0?"+":"")+v.toFixed(2)+"%";};
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

function isFresh(f){
  if(!f||!f.snap||!f.momentum||!f.drift)return false;
  const now=Date.now(),as=Number(f.as_of),age=Number(f.tick_age_s),seatAge=Number(f.drift.feed_age_s);
  if(!Number.isFinite(as)||as<now-20000||as>now+5000)return false;
  if(!Number.isFinite(age)||age<0||age>15)return false;
  if(Number.isFinite(seatAge)&&seatAge>20)return false;
  if(f.drift.health==="DOWN"||f.drift.health==="STALE")return false;
  if(Number(f.snap.close_time)<now-5000)return false;
  return [f.snap.ret5,f.snap.ret15,f.snap.ret30].every(Number.isFinite);
}
function structureLabel(f){
  const m=f?.momentum;if(!m)return "WAIT";
  if(m.aligned&&m.strong15)return "ALIGNED "+m.sign15;
  if(m.pullback)return "PULLBACK "+m.sign15;
  if(m.accel)return "ACCEL "+m.sign15;
  if(m.decay)return "DECAY "+m.sign15;
  return "NO CLEAN DRIFT";
}
function paceLabel(f){
  const m=f?.momentum;if(!m)return "—";
  if(m.accel)return "ACCEL";
  if(m.decay)return "DECAY";
  if(m.pullback)return "PULLBACK";
  if(m.chop)return "MIXED";
  return m.aligned?"ALIGNED":"WATCH";
}
function readCopy(f){
  if(!f?.momentum)return "No usable momentum frame.";
  const m=f.momentum;
  const values="5m "+fmt(f.snap.ret5)+" · 15m "+fmt(f.snap.ret15)+" · 30m "+fmt(f.snap.ret30)+". ";
  if(m.aligned&&m.strong15)return values+"All three clocks point "+m.sign15+" and the 15m move clears DRIFT’s strength check.";
  if(m.aligned)return values+"The clocks agree, but the 15m leg is still light. Alignment can exist without enough strength to earn conviction.";
  if(m.pullback)return values+"15m and 30m agree while 5m pulls against them. That is a pullback structure, not clean three-clock alignment.";
  if(m.decay)return values+"The short leg is fading relative to the 15m move. Momentum can persist while pace decays.";
  return values+"The clocks disagree. Mixed horizons are information; DRIFT does not have to force a direction.";
}
function setCoach(line){
  byId("coach-line").textContent=line;
  byId("chat-preview").textContent="“"+line+"”";
  if(voice&&"speechSynthesis" in window){speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(line);u.rate=.96;u.pitch=.92;speechSynthesis.speak(u);}
}
function update(f){
  frame=f;
  const fresh=isFresh(f);
  byId("feed-tag").classList.toggle("offline",!fresh);
  byId("feed-label").textContent=fresh?"LIVE FLOOR CONNECTED":"LIVE LESSON PAUSED";
  byId("feed-age").textContent=Number.isFinite(Number(f?.tick_age_s))?" · "+Number(f.tick_age_s).toFixed(0)+"s":"";
  byId("read-status").textContent=fresh?"FRESH MOMENTUM FRAME":"WAITING FOR FRESH EVIDENCE";
  byId("try-status").textContent=fresh?"READY TO FREEZE":"WAITING FOR THE FEED";
  byId("challenge").disabled=!fresh;
  byId("chart-preview-status").textContent=fresh?"LIVE PATH":"PAUSED";
  byId("notes-preview-status").textContent=fresh?"CURRENT":"PAUSED";
  byId("read-preview").textContent=fresh?readCopy(f):"Live teaching pauses when the DRIFT evidence is stale or unavailable.";
  byId("note-decision").textContent=fresh?structureLabel(f):"—";
  byId("note-location").textContent=fresh?paceLabel(f):"—";
  byId("note-excerpt").textContent=fresh?(f.drift.reasoning||readCopy(f)):"Alignment, disagreement, acceleration, and what would break the read.";
  byId("obs-5").textContent=fmt(f?.snap?.ret5);byId("obs-15").textContent=fmt(f?.snap?.ret15);byId("obs-30").textContent=fmt(f?.snap?.ret30);
  byId("observation-copy").textContent=fresh?readCopy(f):"Waiting for a fresh momentum frame.";
  byId("observation-seat").textContent=f?.drift?"DRIFT seat · "+f.drift.lean+" · conf "+Math.round(Number(f.drift.confidence)||0):"DRIFT seat —";
  byId("notes-structure").textContent=fresh?structureLabel(f)+" · 5m "+fmt(f.snap.ret5)+" · 15m "+fmt(f.snap.ret15)+" · 30m "+fmt(f.snap.ret30):"Waiting for a fresh frame.";
  byId("notes-reason").textContent=fresh?(f.drift.reasoning||readCopy(f)):"DRIFT compares 5m, 15m, and 30m before trusting a directional move.";
  byId("notes-invalidate").textContent=fresh?(f.drift.invalidate_if||"A larger-timeframe disagreement can break the setup."):"A larger-timeframe disagreement can turn clean carry into WAIT.";
  drawMomentumChart(byId("chart-preview"),f);
  drawMomentumChart(byId("detail-chart"),f);
}
async function poll(){
  try{
    const r=await fetch("/training-drift-frame",{cache:"no-store"});if(!r.ok)throw new Error("feed");
    update(await r.json());
  }catch{update(null);}
}
function openDialog(id){
  const d=dialogs[id];if(!d)return;
  if(id==="challenge"&&isFresh(frame)){
    frozen=structuredClone(frame);
    byId("challenge-5").textContent=fmt(frozen.snap.ret5);byId("challenge-15").textContent=fmt(frozen.snap.ret15);byId("challenge-30").textContent=fmt(frozen.snap.ret30);
    byId("challenge-evidence").textContent="Read all three horizons. The exercise is frozen; the live floor can keep moving.";
    byId("challenge-result").hidden=true;
    document.querySelectorAll("[data-call]").forEach(b=>b.classList.remove("selected"));
  }
  d.showModal();
}
document.querySelectorAll(".monitor").forEach(b=>b.addEventListener("click",()=>openDialog(b.id)));
document.querySelectorAll("dialog .close,[data-close]").forEach(b=>b.addEventListener("click",()=>b.closest("dialog").close()));
document.querySelectorAll("dialog").forEach(d=>d.addEventListener("click",e=>{if(e.target===d)d.close();}));

document.querySelectorAll("[data-call]").forEach(btn=>btn.addEventListener("click",()=>{
  if(!frozen)return;
  document.querySelectorAll("[data-call]").forEach(b=>b.classList.toggle("selected",b===btn));
  const expected=frozen.momentum?.lean==="UP"?"UP":frozen.momentum?.lean==="DOWN"?"DOWN":"WAIT";
  const chosen=btn.dataset.call;
  const ok=chosen===expected;
  const result=byId("challenge-result");result.hidden=false;
  result.innerHTML="<strong>"+(ok?"Good structure read.":"Look at the three clocks again.")+"</strong><br>"+esc(readCopy(frozen))+"<br><small>This grades the momentum structure, not the future settlement.</small>";
  setCoach(ok?"Good. You read the structure instead of chasing the last candle.":"Start with 15m and 30m, then ask what the 5m leg is doing inside them.");
}));

function answer(q){
  const x=q.toLowerCase();
  if(x.includes("align"))return "Alignment means 5m, 15m, and 30m point the same way. I still separate agreement from strength; three arrows alone do not promise the next result.";
  if(x.includes("5m")||x.includes("five"))return "The 5-minute leg reacts first, so it can lead or fake you out. I use 15m as the anchor and 30m as context before I call that impulse carry.";
  if(x.includes("wait")||x.includes("mixed"))return "When the horizons disagree, WAIT is information. I would rather name the conflict than turn one noisy move into a story.";
  if(x.includes("chase")||x.includes("late"))return "Chase risk is a teaching caution: a fast short leg can be real momentum and still be a poor place to become emotionally certain. It is not a reversal guarantee and it is not a Council rule.";
  if(x.includes("pullback"))return "A pullback is when 15m and 30m still agree but 5m temporarily leans against them. That is different from three-clock alignment and different from random chop.";
  return frame&&isFresh(frame)?readCopy(frame):"Start with the three clocks: direction, agreement, then pace. If the live feed is stale, we stop the live lesson and use the illustrated practice instead.";
}
function postQuestion(q){
  if(!q.trim())return;
  const h=byId("chat-history");
  h.insertAdjacentHTML("beforeend","<div class='message user'><small>YOU</small>"+esc(q)+"</div>");
  const a=answer(q);
  h.insertAdjacentHTML("beforeend","<div class='message'><small>DRIFT</small>"+esc(a)+"</div>");
  h.scrollTop=h.scrollHeight;setCoach(a);
}
document.querySelectorAll("[data-question]").forEach(b=>b.addEventListener("click",()=>postQuestion(b.dataset.question||"")));
byId("chat-form").addEventListener("submit",e=>{e.preventDefault();const i=byId("chat-input");postQuestion(i.value);i.value="";});
byId("sound").addEventListener("click",()=>{
  voice=!voice;byId("sound").setAttribute("aria-pressed",String(voice));byId("sound").textContent=voice?"VOICE ON":"VOICE OFF";
  if(!voice&&"speechSynthesis" in window)speechSynthesis.cancel();
});
drawPractice(byId("practice-preview"));
for(let i=0;i<60;i++){const k=document.createElement("i");byId("keyboard-keys").appendChild(k);}
poll();setInterval(poll,4000);
