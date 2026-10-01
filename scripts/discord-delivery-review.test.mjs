// Durable owner-set Discord release (0072) + one research-outlook post per 15-minute window.
// Synthetic endpoints only; no test makes a network request or writes to the repo tree.
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
const release = load("src/lib/desk/discord-release.server.ts");
const buildA = "a".repeat(40), buildB = "b".repeat(40);
const url = (id) => `https://discord.com/api/webhooks/${id}/${"fake-token-".repeat(4)}`;
const paper = lib.webhookTarget(url("111111111111111111"));
const read = lib.webhookTarget(url("222222222222222222"));
const accepted = { ok: true, status: 200, retryMs: 0, terminal: false, message: "fake-message", code: "accepted" };
const sqlOf = (pg) => {
  const db = async (parts, ...args) => (await pg.query(parts.reduce((s, p, i) => s + p + (i < args.length ? `$${i + 1}` : ""), ""), args)).rows;
  db.query = async (sql, args = []) => (await pg.query(sql, args)).rows;
  return db;
};
const releaseSql = readFileSync("migrations/0072_discord_release.sql", "utf8");
async function fixture(t, { push = false } = {}) {
  const pg = new PGlite(); t.after(() => pg.close());
  if (push) for (const m of ["0015_desk_push.sql", "0018_desk_push_owner.sql", "0066_desk_push_delivery_receipts.sql", "0069_directional_regret.sql"])
    await pg.exec(readFileSync("migrations/" + m, "utf8"));
  await pg.exec(readFileSync("migrations/0070_discord_outbox.sql", "utf8"));
  await pg.exec(releaseSql);
  await pg.exec(`create table desk_ledger(ticker text,close_time timestamptz,entry_lean text,entry_source text,winner text,ev_cents double precision,graded_at timestamptz,research_quality text,entry_cents double precision default 83);
    create view desk_ledger_research as select * from desk_ledger where research_quality='valid';`);
  const db = sqlOf(pg);
  let now = Date.now();
  const calls = [];
  const outbox = (build) => new DiscordOutbox(db, { build, paper, read }, () => release.discordReleased(db), () => now,
    async (u, p) => { calls.push({ u, p }); return accepted; }, () => {});
  return { pg, db, calls, outbox, time: () => now, advance: (ms) => (now += ms),
    rows: () => db.query("select * from desk_discord_outbox order by event_key") };
}
const leanOf = (seat, score, w, extra = {}) => ({ seat, score, direction: score == null ? "NO_READ" : score > 50 ? "BULLISH" : score < 50 ? "BEARISH" : "NEUTRAL",
  window: w, statusPlain: "Research only", stale: false, ...extra });
const paperAt = (f, build, ticker, close, side = "UP", source = null) => lib.paperEvent(side, 83, close, f.time(), ticker, source, build, paper.hash);


test("legacy SQL reads expire before a new summary; noncanonical journal keys are rejected", async(t)=>{
 const f=await fixture(t), n=f.time(); await release.discordReleaseControl(f.db,{action:"release"},n-1000);
 const w={ticker:"KX-LEGACY",close_time:n+300000,as_of:n}; const e=lib.readSummaryEvent([leanOf("DRIFT",35,w)],"WAIT",w,buildA,read.hash);
 await f.db.query("insert into desk_discord_outbox(event_key,kind,ticker,close_time,seat,side,observed_at,build_sha,target_hash,payload,state,expires_at) values ($1,'read',$2,$3,'DRIFT','DOWN',$4,$5,$6,$7::jsonb,'pending',$3)",["read|legacy",e.ticker,new Date(e.close),new Date(n-100),buildA,read.hash,JSON.stringify(e.payload)]);
 const o=f.outbox(buildA); await o.enqueue({...e,key:e.key+"|extra"});await o.enqueue(e);f.advance(1000);await o.drain();
 assert.equal(f.calls.length,1);assert.equal((await f.rows()).find(r=>r.event_key==="read|legacy").state,"expired");assert.equal((await f.rows()).length,2);
});
test("hold and release between sends uses the NEW release timestamp for late styling", async(t)=>{
 const f=await fixture(t),n=f.time();await release.discordReleaseControl(f.db,{action:"release"},n-1000);
 const posts=[];const o=new DiscordOutbox(f.db,{build:buildA,paper,read},()=>release.discordReleased(f.db),f.time,async(u,p)=>{
 posts.push(p);if(posts.length===1){await release.discordReleaseControl(f.db,{action:"hold"},f.time());await f.db.query("update desk_discord_outbox set state='held',lease_until=null where state='pending'");f.advance(2000);await release.discordReleaseControl(f.db,{action:"release"},f.time());}return accepted;},()=>{});
 await o.enqueue(paperAt(f,buildA,"KX-FIRST",n+300000));await o.enqueue(paperAt(f,buildA,"KX-SECOND",n+300000));f.advance(1000);await o.drain();
 assert.equal(posts.length,2);assert.equal(posts[1].embeds[0].title,lib.LATE_OPEN_LABEL);assert.equal(posts[1].embeds[0].color,lib.LATE_COLOR);
});
test("all paper formats and a held LEGACY payload expose three separate layers", async(t)=>{
 const f=await fixture(t),n=f.time();const e=paperAt(f,buildA,"KX-OLD",n-60000);
 const formats=[e.payload,lib.paperEvent("DOWN",85,n+300000,n,"PILOT","RECOVERY_FAV85_V1",buildA,paper.hash).payload,lib.settlementEvent(e,"UP",17,n,buildA).payload];
 for(const p of formats)for(const name of ["Research outlook","SATOSHI decision","Paper position"])assert.equal(p.embeds[0].fields.filter(x=>x.name===name).length,1);
 e.payload.embeds[0].fields=e.payload.embeds[0].fields.filter(x=>!["Research outlook","SATOSHI decision","Paper position"].includes(x.name));
 const o=f.outbox(buildA);await o.enqueue(e);f.advance(1000);await release.discordReleaseControl(f.db,{action:"release"},f.time());await o.drain();
 const p=f.calls[0].p;assert.equal(p.embeds[0].title,lib.LATE_LABEL);for(const name of ["Research outlook","SATOSHI decision","Paper position"])assert.equal(p.embeds[0].fields.filter(x=>x.name===name).length,1);
});
test("ambiguous provider acceptance cannot repost a read or paper call after restart/release",async(t)=>{
 const f=await fixture(t),n=f.time();await release.discordReleaseControl(f.db,{action:"release"},n-1000);let sent=0;
 const o=new DiscordOutbox(f.db,{build:buildA,paper,read},()=>release.discordReleased(f.db),f.time,async()=>{sent++;return {...accepted,ok:false,status:503,retryMs:1000,code:"provider_or_receipt_failure",message:null};},()=>{});
 const w={ticker:"KX-UNCERTAIN",close_time:n+300000,as_of:n};await o.enqueue(lib.readSummaryEvent([leanOf("DRIFT",35,w)],"WAIT",w,buildA,read.hash));await o.enqueue(paperAt(f,buildA,"KX-PAPER",n+300000));f.advance(1000);await o.drain();f.advance(1001);await o.drain();
 assert.equal(sent,2);assert.ok((await f.rows()).every(r=>r.state==="failed"&&r.error_code==="delivery_unconfirmed"));f.advance(61000);await release.discordReleaseControl(f.db,{action:"release"},f.time());await f.outbox(buildB).drain();assert.equal(f.calls.length,0);assert.equal(sent,2);
});
test("lost SQL receipt after provider acceptance cannot cause a second post",async(t)=>{
 const f=await fixture(t),n=f.time();await release.discordReleaseControl(f.db,{action:"release"},n-1000);let posted=0;
 const broken=async(parts,...args)=>{if(parts.join("").includes("message_id="))throw Error("receipt unavailable");return f.db(parts,...args);};
 const o=new DiscordOutbox(broken,{build:buildA,paper,read},()=>release.discordReleased(f.db),f.time,async()=>{posted++;return accepted;},()=>{});
 await o.enqueue(paperAt(f,buildA,"KX-RECEIPT",n+300000));f.advance(1000);await o.drain();assert.equal(posted,1);assert.equal((await f.rows())[0].error_code,"delivery_unconfirmed");f.advance(61000);await f.outbox(buildB).drain();assert.equal(f.calls.length,0);assert.equal(posted,1);
});

test("re-release while already released durably marks held calls late without changing release time",async(t)=>{
 const f=await fixture(t),n=f.time();await release.discordReleaseControl(f.db,{action:"release"},n-1000);const o=f.outbox(buildA);await o.enqueue(paperAt(f,buildA,"KX-REQUEUED",n+300000));await f.db.query("update desk_discord_outbox set state='held' where kind='paper'");f.advance(1000);const before=(await f.db.query("select released_at from desk_discord_release"))[0].released_at;await release.discordReleaseControl(f.db,{action:"release"},f.time());await o.drain();assert.equal(f.calls.length,1);assert.equal(f.calls[0].p.embeds[0].color,lib.LATE_COLOR);assert.equal(f.calls[0].p.embeds[0].title,lib.LATE_OPEN_LABEL);assert.equal(f.calls[0].p.heldBeforeRelease,undefined);assert.deepEqual((await f.db.query("select released_at from desk_discord_release"))[0].released_at,before);
});

test("an already-delivered legacy read suppresses the new summary in the upgrade window",async(t)=>{
 const f=await fixture(t),n=f.time();await release.discordReleaseControl(f.db,{action:"release"},n-1000);const w={ticker:"KX-SENT-LEGACY",close_time:n+300000,as_of:n};const e=lib.readSummaryEvent([leanOf("DRIFT",35,w)],"WAIT",w,buildA,read.hash);
 await f.db.query("insert into desk_discord_outbox(event_key,kind,ticker,close_time,seat,side,observed_at,build_sha,target_hash,payload,state,expires_at) values ($1,'read',$2,$3,'DRIFT','DOWN',$4,$5,$6,$7::jsonb,'sent',$3)",["read|already-sent",e.ticker,new Date(e.close),new Date(n-100),buildA,read.hash,JSON.stringify(e.payload)]);const o=f.outbox(buildA);await o.enqueue(e);f.advance(1000);await o.drain();assert.equal(f.calls.length,0);assert.equal((await f.rows()).find(r=>r.event_key===e.key).error_code,"window_already_delivered");
});
