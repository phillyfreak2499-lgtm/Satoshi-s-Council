import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
const require = createRequire(import.meta.url);
function loader(overrides = {}) {
  const cache = new Map();
  return function load(file) {
    file = resolve(file);
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const req = (id) => {
      if (id in overrides) return overrides[id];
      if (id.startsWith(".")) {
        const path = resolve(dirname(file), id);
        return load(existsSync(path) ? path : path + ".ts");
      }
      return require(id);
    };
    new Function("require", "exports", code)(req, exports);
    return exports;
  };
}
const load = loader();
const lib = load("src/lib/desk/discord-posts.ts");
const { DiscordOutbox } = load("src/lib/desk/discord-outbox.server.ts");
const build = "a".repeat(40);
// Synthetic, non-functional endpoints only. No test makes a network request.
const url = (id) => `https://discord.com/api/webhooks/${id}/${"fake-token-".repeat(4)}`;
const paper = lib.webhookTarget(url("111111111111111111"));
const read = lib.webhookTarget(url("222222222222222222"));
const accepted = { ok: true, status: 200, retryMs: 0, terminal: false, message: "fake-message", code: "accepted" };
const migration = readFileSync("migrations/0070_discord_outbox.sql", "utf8");
async function fixture(t) {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec(migration);
  await pg.exec(`create table desk_alert_rollout(build_sha text primary key,released_at timestamptz);
    create table desk_ledger(ticker text,close_time timestamptz,entry_lean text,entry_source text,winner text,ev_cents double precision,graded_at timestamptz,research_quality text,entry_cents double precision default 83);
    create view desk_ledger_research as select * from desk_ledger where research_quality='valid';`);
  let now = Date.now() + 10000;
  await pg.query("insert into desk_alert_rollout values ($1,$2)", [build, new Date(now-1000)]);
  const db = async (parts, ...args) => (await pg.query(parts.reduce((s,p,i) => s+p+(i<args.length ? `$${i+1}` : ""), ""), args)).rows;
  db.query = async (sql,args=[]) => (await pg.query(sql,args)).rows;
  let released = true;
  const calls = [], logs = [];
  const config = { build, paper, read };
  const outbox = new DiscordOutbox(db, config, async () => released, () => now, async (u,p,a) => { calls.push({u,p,a}); return accepted; }, (code) => logs.push(code));
  const event = () => lib.paperEvent("UP",83,now+60000,now,"WINDOW-TEST",null,build,paper.hash);
  return { pg,db,outbox,event,calls,logs,config,time:()=>now,advance:(ms)=>now+=ms,release:(v)=>released=v,
    rows:()=>db.query("select * from desk_discord_outbox order by event_key") };
}
test("secrets stay in server config, URLs are allowlisted, wait=true and no redirects", async () => {
  assert.ok(paper.url.endsWith("?wait=true"));
  assert.equal(paper.hash.includes("fake-token"),false);
  for (const u of ["http://discord.com/api/webhooks/111111111111111111/"+"x".repeat(30),
    url("111111111111111111").replace("discord.com","discord.com.evil.test"),
    url("111111111111111111")+"?thread_id=secret",url("111111111111111111")+"#secret"]) assert.equal(lib.webhookTarget(u),null);
  let request;
  const r=await lib.postDiscord(paper.url,lib.paperEvent("UP",83,Date.now()+60000,Date.now(),"X",null,build,paper.hash).payload,0,async(u,o)=>{
    request={u,o};return new Response(JSON.stringify({id:"receipt"}),{status:200});
  });
  assert.equal(request.o.method,"POST"); assert.equal(request.o.redirect,"error"); assert.equal(r.message,"receipt");
  assert.deepEqual(JSON.parse(request.o.body).allowed_mentions,{parse:[]});
});
test("embeds keep booked position, research lean, and after-fee settlement distinct", () => {
  const now=Date.now(); const p=lib.paperEvent("DOWN",81,now+60000,now,"X",null,build,paper.hash);
  const l={seat:"DRIFT",score:35,direction:"BEARISH",window:{ticker:"X",close_time:now+60000,as_of:now},statusPlain:"Research only — SATOSHI did not hear this vote."};
  const r=lib.readEvent(l,build,read.hash), s=lib.settlementEvent(p,"DOWN",17,now+60000,build);
  assert.match(p.payload.embeds[0].title,/■ PAPER POSITION BOOKED/);
  assert.match(r.payload.embeds[0].title,/◇ RESEARCH LEAN · DRIFT · DOWN/);
  assert.match(r.payload.embeds[0].description,/Research only.*Not a SATOSHI call or a paper position/);
  assert.notEqual(p.payload.embeds[0].color,r.payload.embeds[0].color);
  assert.ok(r.payload.embeds[0].fields.some(f=>f.value==="35 · Bearish"));
  assert.ok(s.payload.embeds[0].fields.some(f=>f.value==="+17.0¢"));
  assert.match(s.payload.embeds[0].title,/WIN/);
  assert.match(lib.settlementEvent(p,"UP",-83,now,build).payload.embeds[0].title,/LOSS/);
  assert.equal(lib.readEvent({...l,direction:"NEUTRAL",score:50},build,read.hash),null);
});
test("hold suppresses all posts, no late held replay, missing build fails closed", async(t)=>{
  const f=await fixture(t); f.release(false);await f.outbox.enqueue(f.event());await f.outbox.drain();
  assert.equal(f.calls.length,0); assert.equal((await f.rows())[0].state,"held");
  f.release(true); await f.outbox.drain();assert.equal(f.calls.length,0);
  const later={...f.event(),key:"captured-before-release",observed:f.time()-5000};await f.outbox.enqueue(later);
  assert.equal((await f.rows()).find(r=>r.event_key===later.key).state,"held");
  const invalid=new DiscordOutbox(f.db,{...f.config,build:""},async()=>true, f.time,async()=>{throw Error("must not send")});
  await invalid.enqueue({...f.event(),key:"invalid",build:""});await invalid.drain();assert.equal(f.calls.length,0);
});
test("paper queue is idempotent across restart and routes to paper endpoint",async(t)=>{
  const f=await fixture(t);const e=f.event();await f.outbox.enqueue(e);await f.outbox.enqueue(e);
  await f.outbox.drain();assert.equal(f.calls.length,1);assert.equal(f.calls[0].u,paper.url);
  const restarted=new DiscordOutbox(f.db,f.config,async()=>true,f.time,async()=>{throw Error("duplicate")});
  await restarted.enqueue(e);await restarted.drain();assert.equal((await f.rows()).length,1);
  assert.equal((await f.rows())[0].state,"sent");
});
test("read cursor survives restart, neutral reset permits a new lean, timestamp is retained",async(t)=>{
  const f=await fixture(t),n=f.time();
  const lean=(at)=>({seat:"DRIFT",score:35,direction:"BEARISH",window:{ticker:"X",close_time:n+60000,as_of:at},statusPlain:"Research only"});
  const e=lib.readEvent(lean(n),build,read.hash);await f.outbox.enqueue(e);await f.outbox.drain();
  await f.outbox.enqueue(lib.readEvent(lean(n+1000),build,read.hash));await f.outbox.drain();assert.equal(f.calls.length,1);
  await f.outbox.enqueue({...e,key:"quiet",quiet:true,signature:"NEUTRAL|50",observed:n+2000});
  await f.outbox.enqueue(lib.readEvent(lean(n+3000),build,read.hash));await f.outbox.drain();
  assert.equal(f.calls.length,2); assert.ok(f.calls.every(c=>c.u===read.url));
  assert.equal(f.calls[1].p.embeds[0].timestamp,new Date(n+3000).toISOString());
  // A delayed earlier journal observation cannot rewind the cursor.
  await f.outbox.enqueue({...e,key:"late-quiet",quiet:true,signature:"NEUTRAL|50",observed:n+1500});
  assert.equal((await f.db.query("select signature from desk_discord_read_state"))[0].signature,"BEARISH|35");
});
test("settlement follows a delivered fill only, exact window/source and stored after-fee P&L",async(t)=>{
  const f=await fixture(t);const e=f.event();await f.outbox.enqueue(e);await f.outbox.drain();
  await f.db.query("insert into desk_ledger(ticker,close_time,entry_lean,entry_source,winner,ev_cents,graded_at,research_quality) values ($1,$2,'UP',null,'UP',17,$3,'valid')",[e.ticker,new Date(e.close),new Date(f.time())]);
  await f.outbox.drain();await f.outbox.drain();assert.equal(f.calls.length,2);
  assert.match(f.calls[1].p.embeds[0].title,/SETTLED · WIN/);
  assert.ok(f.calls[1].p.embeds[0].fields.some(x=>x.value==="+17.0¢"));
  assert.equal((await f.rows()).filter(r=>r.kind==='settle').length,1);
  const wrong={...e,key:"other-window",close:e.close+900000};await f.outbox.enqueue(wrong);await f.outbox.drain();
  assert.equal((await f.rows()).filter(r=>r.kind==='settle').length,1);
});
test("429 and network/5xx back off; invalid endpoints stop; errors never expose URL/token",async()=>{
  const p=lib.paperEvent("UP",83,Date.now()+60000,Date.now(),"X",null,build,paper.hash).payload;
  const limited=await lib.postDiscord(paper.url,p,0,async()=>new Response(JSON.stringify({retry_after:12.25}),{status:429,headers:{"Retry-After":"8"}}));
  assert.equal(limited.retryMs,12250);assert.equal(limited.terminal,false);
  assert.equal((await lib.postDiscord(paper.url,p,2,async()=>new Response("{}",{status:503}))).retryMs,4000);
  assert.equal((await lib.postDiscord(paper.url,p,0,async()=>new Response("{}",{status:404}))).terminal,true);
  const result=await lib.postDiscord(paper.url,p,0,async()=>{throw Error(paper.url)});
  assert.equal(result.code,"transport_failure");assert.ok(!JSON.stringify(result).includes("fake-token"));
  const ok=await lib.postDiscord(paper.url,p,0,async()=>new Response('{"id":"1"}',{status:200,headers:{"X-RateLimit-Remaining":"0","X-RateLimit-Reset-After":"0.5"}}));
  assert.equal(ok.retryMs,500);
});
test("durable cooldown, retry, expiry, rekey and build hold are enforced by real SQL",async(t)=>{
  const f=await fixture(t);let attempts=0;
  const retry=new DiscordOutbox(f.db,f.config,async()=>true,f.time,async()=>++attempts===1?{...accepted,ok:false,status:429,code:"rate_limited",retryMs:12000}:accepted);
  await retry.enqueue(f.event());await retry.drain();await retry.drain();assert.equal(attempts,1);
  f.advance(13000);await retry.drain();assert.equal(attempts,2);
  const expired={...f.event(),key:"expired",expires:f.time()-1};await retry.enqueue(expired);await retry.drain();
  assert.equal((await f.rows()).find(r=>r.event_key==='expired').state,'expired');
  await retry.enqueue({...f.event(),key:"oldbuild"});
  const next=new DiscordOutbox(f.db,{...f.config,build:'b'.repeat(40)},async()=>true,f.time,async()=>{throw Error('must hold')});await next.drain();
  assert.equal((await f.rows()).find(r=>r.event_key==='oldbuild').state,'held');
});
test("0070 is new tables only; failure rolls back and repeated apply preserves existing rows",async(t)=>{
  assert.doesNotMatch(migration,/\balter\b|\bdrop\b|\bupdate\b|\bdelete\b|\binsert\b/i);
  const pg=new PGlite();t.after(()=>pg.close());await pg.exec("create table sentinel(id int); insert into sentinel values(7)");
  await assert.rejects(pg.exec("begin;"+migration+";select missing_column;commit;"));await pg.exec("rollback");
  assert.equal((await pg.query("select to_regclass('desk_discord_outbox') t")).rows[0].t,null);
  await pg.exec(migration);await pg.exec(migration);assert.deepEqual((await pg.query("select * from sentinel")).rows,[{id:7}]);
});
test("event wiring changes no decision behavior and outage path remains untouched",()=>{
  const push=readFileSync('src/lib/desk/push.server.ts','utf8');
  const call=push.slice(push.indexOf('export function notifyCall'),push.indexOf('export function notifySettle'));
  assert.match(call,/publishDiscordPaper\(lean, cents, ticker, closeTime, source\)/);
  assert.ok(call.indexOf('publishDiscordPaper')<call.indexOf('subsFor'));
  const engine=readFileSync('src/lib/desk/server-engine.ts','utf8');
  const hook=engine.indexOf('publishDiscordLeans(snap, votes, chair, e.learner.knobs)');
  assert.ok(hook>engine.indexOf('e.lastChair = chair;'));
  assert.ok(hook>engine.indexOf('e.prevSnap = snap;'));
  assert.ok(hook>engine.indexOf('e.lastVotes = votes;'));
  const server=readFileSync('src/lib/desk/discord-posts.server.ts','utf8');
  assert.match(server,/seatDirectionalLeans\(seatFacts\(chair, votes, knobs/);
  assert.doesNotMatch(server,/runChair\(|noteCall\(|notifyWatchdog\(|\.lean\s*=|\.score\s*=/);
});

test("two workers lease a paper event once and gate revocation just before POST holds it",async(t)=>{
  const f=await fixture(t);await f.outbox.enqueue(f.event());let sent=0;
  const provider=async()=>{sent++;await new Promise(r=>setTimeout(r,20));return accepted;};
  const a=new DiscordOutbox(f.db,f.config,async()=>true,f.time,provider),b=new DiscordOutbox(f.db,f.config,async()=>true,f.time,provider);
  await Promise.all([a.drain(),b.drain()]);assert.equal(sent,1);
  await f.outbox.enqueue({...f.event(),key:"revoke"});let readyChecks=0;
  const revoke=new DiscordOutbox(f.db,f.config,async()=>++readyChecks<2,f.time,async()=>{throw Error('should be held')});
  await revoke.drain();assert.equal((await f.rows()).find(r=>r.event_key==='revoke').state,'held');
});

test("permanent 404 disables only its destination and DB failure never rejects the desk worker",async(t)=>{
  const f=await fixture(t);const dead=new DiscordOutbox(f.db,f.config,async()=>true,f.time,async()=>({...accepted,ok:false,status:404,terminal:true,code:'rejected'}));
  await dead.enqueue(f.event());await dead.drain();
  assert.equal((await f.rows())[0].state,'failed');
  const targets=await f.db.query('select * from desk_discord_destinations');
  assert.equal(targets.find(t=>t.target_hash===paper.hash).disabled,true);
  assert.equal(targets.find(t=>t.target_hash===read.hash).disabled,false);
  const errors=[];const broken=new DiscordOutbox(async()=>{throw Error(url('111111111111111111'))},f.config,async()=>{throw Error('db')},f.time,undefined,code=>errors.push(code));
  await assert.doesNotReject(broken.drain());assert.deepEqual(errors,['queue_failure']);
});


test("engine and push source differ only by publication hooks and the reviewed settlement release guard",()=>{
  const settlementGate="      if (!(await subscriberAlertsReleased())) {\n        lastLog = \"settlement alert held: owner two-tier verification required for this build\";\n        return;\n      }\n";
  assert.equal(readFileSync('src/lib/desk/push.server.ts','utf8').split(settlementGate).length,2);
  const crypto=require('node:crypto');
  const engine=readFileSync('src/lib/desk/server-engine.ts','utf8')
    .replace('import { publishDiscordLeans } from "./discord-events.server";\n','')
    .replace('    // Outbound publication only: this frame is now the public getServerFrame result.\n    publishDiscordLeans(snap, votes, chair, e.learner.knobs);\n','');
  const push=readFileSync('src/lib/desk/push.server.ts','utf8')
    .replace('import { publishDiscordPaper } from "./discord-events.server";\n','')
    .replace('  publishDiscordPaper(lean, cents, ticker, closeTime, source);\n','')
    .replace(settlementGate,'');
  assert.equal(crypto.createHash('sha256').update(engine).digest('hex'),'ac58ed7e3d21f99198457f0327a8d1978222f44112c6c290f77581d81e90317b');
  assert.equal(crypto.createHash('sha256').update(push).digest('hex'),'80615c0209a2a0435329ac934849df2d206d0238e9d7486145b49a766ddc0be2');
});

 test("settlement scoreboard excludes pending and breakeven calls, matches Books, and survives retry", async(t)=>{
  const f=await fixture(t), e=f.event(); await f.outbox.enqueue(e); await f.outbox.drain();
  await f.db.query("insert into desk_ledger(ticker,close_time,entry_lean,entry_source,winner,ev_cents,graded_at,research_quality) values ($1,$2,'UP',null,'UP',17,$3,'valid')",[e.ticker,new Date(e.close),new Date(f.time())]);
  await f.pg.exec("insert into desk_ledger(ticker,ev_cents,research_quality) values ('older-win',14,'valid'),('older-loss',-85,'valid'),('pending',null,'valid'),('breakeven',0,'valid'),('excluded',999,'excluded'); insert into desk_ledger(ticker,ev_cents,research_quality,entry_cents) values ('wait',null,'valid',null)");
  let attempts=0;const posted=[];
  const retry=new DiscordOutbox(f.db,f.config,async()=>true,f.time,async(u,p)=>{
    posted.push(p);return ++attempts===1?{...accepted,ok:false,status:503,retryMs:1000,code:'provider_or_receipt_failure'}:accepted;
  });
  await retry.drain();f.advance(1001);await retry.drain();await retry.drain();
  assert.equal(posted.length,2);assert.deepEqual(posted[0],posted[1]);
  const embed=posted[1].embeds[0];
  assert.equal(embed.fields.find(x=>x.name==='Paper scoreboard · all-time').value,'2W–1L · -54.0¢ net after fees');
  assert.equal((await f.rows()).filter(r=>r.kind==='settle').length,1);
  // Pin arithmetic against the actual site's query, including its historical
  // positive-net definition of wins (not an invented alternate win measure).
  const books=readFileSync('src/lib/desk/books.server.ts','utf8');
  assert.ok(books.includes('(count(*) filter (where ev_cents < 0))::int as losses'));
  assert.ok(readFileSync('src/lib/desk/discord-outbox.server.ts','utf8').includes('(count(*) filter (where entry_cents is not null and ev_cents < 0))::int as scoreboard_losses'));
  for(const expression of ['(count(*) filter (where entry_cents is not null and ev_cents > 0))::int','coalesce(sum(ev_cents), 0)::float','from desk_ledger_research']) {
    assert.ok(books.includes(expression));assert.ok(readFileSync('src/lib/desk/discord-outbox.server.ts','utf8').includes(expression));
  }
});

test("losing settlement scoreboard includes the current loss and stored fees",async(t)=>{
  const f=await fixture(t),e=f.event();await f.outbox.enqueue(e);await f.outbox.drain();
  await f.db.query("insert into desk_ledger(ticker,close_time,entry_lean,entry_source,winner,ev_cents,graded_at,research_quality) values ($1,$2,'UP',null,'DOWN',-85,$3,'valid')",[e.ticker,new Date(e.close),new Date(f.time())]);
  await f.outbox.drain();
  assert.equal(f.calls[1].p.embeds[0].fields.find(x=>x.name==='Paper scoreboard · all-time').value,'0W–1L · -85.0¢ net after fees');
});

