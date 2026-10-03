import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { signalV1, AUTHORITY, MINUTE, SIGNAL_VERSION, type Print, type SignalInput } from "./signal-v1.ts";
import { paperReturn, killCheckpoint, type PaperTrade } from "./ledger.ts";
import { snapshot, savePrint, applySignal, type LabSql } from "./sql.ts";
import { paperTick, publicTicker, spotReport, startSpotLab, TICKER_URL } from "./spot-lab.server.ts";
const base = Date.parse("2026-10-01T00:00:00Z");
const series = (n = 60, rising = true): Print[] => Array.from({ length: n }, (_, i) => ({ ts: base + i * MINUTE, price: rising ? 100 + i : 200 - i }));
const input = (prices = series(), extra: Partial<SignalInput> = {}): SignalInput => ({ prices, decisionTs: base + 60 * MINUTE, tickTs: base + 60 * MINUTE, versionStatus: "active", open: null, lastEventTs: null, newMinute: true, ...extra });
const close = (id: number, entry = 100, exit = 100, side: "long" | "short" = "long"): PaperTrade => ({ id: String(id), signalVersion: SIGNAL_VERSION, side, entryTs: base + id * 2 * MINUTE, entryPrice: entry, exitTs: base + (id * 2 + 1) * MINUTE, exitPrice: exit, exitReason: "opposite", ...paperReturn(side, entry, exit), status: "closed" });
const adapter = (db: PGlite): LabSql => ({ query: async (text, params) => (await db.query(text, params)).rows });
async function database() {
  const db = new PGlite();
  await db.exec(await readFile(new URL("../../../migrations/0077_spot_signal_lab_v1.sql", import.meta.url), "utf8"));
  return db;
}
async function insertClosed(db: PGlite, trades: PaperTrade[]) {
  for (const row of trades) await db.query("insert into paper_spot_trades(signal_version,side,entry_ts,entry_price,exit_ts,exit_price,exit_reason,gross,pnl_paper,status) values($1,$2,$3,$4,$5,$6,$7,$8,$9,'closed')", [row.signalVersion,row.side,new Date(row.entryTs).toISOString(),row.entryPrice,new Date(row.exitTs!).toISOString(),row.exitPrice,row.exitReason,row.gross,row.pnlPaper]);
}
for (const [name, side, exit, gross] of [["long win","long",110,0.1],["long loss","long",90,-0.1],["short win","short",90,0.1],["short loss","short",110,-0.1]] as const) {
  test(name + " stores gross and applies the 10 bps haircut", () => {
    const result = paperReturn(side, 100, exit);
    assert.equal(result.gross, gross);
    assert.equal(result.pnlPaper, gross - 0.001);
  });
}
test("haircut is applied once even to a zero gross return; invalid marks rejected", () => {
  assert.deepEqual(paperReturn("long",100,100),{gross:0,pnlPaper:-0.001});
  for (const price of [0,-1,NaN,Infinity]) assert.throws(()=>paperReturn("short",100,price));
});
test("49 cannot kill and open rows/other versions are excluded", () => {
  const trades = Array.from({length:49},(_,i)=>close(i+1));
  trades.push({...close(50),status:"open",exitTs:null,exitPrice:null,gross:null,pnlPaper:null,exitReason:null});
  trades.push({...close(51),signalVersion:"unregistered"});
  const verdict = killCheckpoint(trades);
  assert.equal(verdict.evaluated,false);assert.equal(verdict.killed,false);assert.equal(verdict.nClosed,49);assert.equal(verdict.bhPnl,null);
});
test("50 kills on nonpositive net and on positive net trailing the same-window baseline", () => {
  assert.equal(killCheckpoint(Array.from({length:50},(_,i)=>close(i+1))).killed,true);
  const trades = Array.from({length:50},(_,i)=>close(i+1,100,100.2));
  trades[49]=close(50,200/1.002,200);
  const verdict=killCheckpoint(trades);
  assert.ok(verdict.pnlPaper>0);assert.ok(verdict.pnlPaper<verdict.bhPnl!);assert.equal(verdict.reason,"trails_buy_hold");assert.equal(verdict.bhPnl,0.999);
});
test("50 passes when net beats baseline; fixed checkpoint ignores later windows", () => {
  const trades=Array.from({length:50},(_,i)=>close(i+1,100,110));
  const verdict=killCheckpoint(trades);assert.equal(verdict.killed,false);assert.equal(verdict.reason,null);assert.equal(verdict.bhPnl,0.099);
  assert.deepEqual(killCheckpoint([...trades,close(51,100,1)]),verdict);
});
test("exact zero net kills and equal positive baseline passes", () => {
  const zero=Array.from({length:50},(_,i)=>({...close(i+1),gross:0.001,pnlPaper:0}));
  assert.equal(killCheckpoint(zero).killed,true);
  const trades=Array.from({length:50},(_,i)=>({...close(i+1),pnlPaper:0}));
  trades[0].pnlPaper=0.099;trades[49].exitPrice=110;
  assert.equal(killCheckpoint(trades).killed,false);
});
test("contiguous warmup, SMA/ROC causality and exact freshness boundaries", () => {
  assert.equal(signalV1(input(series(59))).action,"hold");
  const result=signalV1(input());assert.equal(result.action,"enter");assert.equal(result.side,"long");assert.equal(result.smaFast,149.5);assert.equal(result.smaSlow,129.5);assert.equal(result.roc15,159/144-1);
  assert.equal(signalV1(input(series(60,false))).side,"short");
  assert.equal(signalV1(input(series(),{tickTs:base+60*MINUTE+30000})).action,"enter");
  assert.equal(signalV1(input(series(),{tickTs:base+60*MINUTE+30001})).action,"hold");
  assert.equal(signalV1(input(series().map(p=>({...p,price:100})))).action,"hold");
});
test("no lookahead from future or partial-minute prints", () => {
  const original=signalV1(input());
  const future=[...series(),{ts:base+60*MINUTE,price:1},{ts:base+61*MINUTE,price:1000000}];
  assert.deepEqual(signalV1(input(future)),original);
});
test("long and shorter gaps reset contiguous warmup; 60 new closed minutes recover", () => {
  for(const gap of [MINUTE,4*MINUTE]) {
    const prices=series().map((p,i)=>({...p,ts:p.ts+(i>=20?gap:0)}));
    const decisionTs=prices.at(-1)!.ts+MINUTE;
    const result=signalV1(input(prices,{decisionTs,tickTs:decisionTs}));assert.equal(result.warmup,40);assert.equal(result.action,"hold");
  }
  const prices=series(80).map((p,i)=>({...p,ts:p.ts+(i>=20?4*MINUTE:0)}));
  const t=prices.at(-1)!.ts+MINUTE;assert.equal(signalV1(input(prices,{decisionTs:t,tickTs:t})).warmup,60);
});
test("opposite, max hold, stale and killed flatten have the locked precedence", () => {
  const open={id:"1",side:"long" as const,entryTs:base,entryPrice:100};
  assert.equal(signalV1(input(series(60,false),{open})).exitReason,"opposite");
  assert.equal(signalV1(input(series(),{open,tickTs:base+60*MINUTE+120000,newMinute:false})).exitReason,null);
  assert.equal(signalV1(input(series(),{open,tickTs:base+60*MINUTE+120001,newMinute:false})).exitReason,"stale");
  const prices=series(240);const t=base+240*MINUTE;
  assert.equal(signalV1(input(prices,{open,decisionTs:t,tickTs:t})).exitReason,"max_hold");
  assert.equal(signalV1(input(series(),{open,versionStatus:"killed"})).exitReason,"killed_flatten");
  assert.equal(signalV1(input([], {open,versionStatus:"killed"})).action,"hold");
  assert.equal(signalV1(input(series(),{versionStatus:"killed"})).action,"hold");
  assert.equal(signalV1(input(series(),{lastEventTs:base+60*MINUTE})).action,"hold");
});
function simulate(prices: Print[]) {
  let open: SignalInput["open"]=null;let lastEventTs:number|null=null;const events:any[]=[];const returns:any[]=[];
  for(const bar of prices) {
    const t=bar.ts+MINUTE;
    const signal=signalV1({prices,decisionTs:t,tickTs:t,versionStatus:"active",open,lastEventTs,newMinute:true});
    if(signal.action==="enter") {open={id:String(events.length+1),side:signal.side!,entryTs:t,entryPrice:signal.price!};lastEventTs=t;events.push([t,"enter",signal.side,signal.price]);}
    else if(signal.action==="exit") {returns.push(paperReturn(open!.side,open!.entryPrice,signal.price!));events.push([t,"exit",signal.exitReason,signal.price]);open=null;lastEventTs=t;}
  }
  return {events,returns};
}
test("same series twice gives identical signals and paper returns", () => {
  const prices=series(500).map((p,i)=>({...p,price:100+4*Math.sin(i/20)}));
  const first=simulate(prices);assert.ok(first.events.length>2);assert.ok(first.returns.length>0);assert.deepEqual(simulate(prices),first);
});
test("real SQL: minute upsert, closed-print immutability, positive finite constraints and empty seed", async () => {
  const db=await database();const sql=adapter(db);
  try {
    assert.equal((await snapshot(sql,base)).trades.length,0);
    assert.equal(await savePrint(sql,100,base+1000,base+1000),true);
    assert.equal(await savePrint(sql,101,base+2000,base+2000),true);
    assert.equal((await snapshot(sql,base)).prices.length,0);
    assert.equal((await snapshot(sql,base+MINUTE)).prices[0].price,101);
    assert.equal(await savePrint(sql,200,base+3000,base+MINUTE),false);
    for(const bad of [0,-1,NaN,Infinity]) assert.equal(await savePrint(sql,bad,base,base),false);
    assert.equal(await savePrint(sql,100,base+MINUTE,base),false);
    await assert.rejects(db.query("insert into spot_prices_1m values($1,'NaN','fixture')",[new Date(base+MINUTE).toISOString()]));
    await db.exec(await readFile(new URL("../../../migrations/0077_spot_signal_lab_v1.sql", import.meta.url),"utf8"));
    assert.equal((await snapshot(sql,base+MINUTE)).trades.length,0);
  } finally {await db.close();}
});
test("real SQL: concurrent/retried entry and close, one position, persisted same-bar refusal", async () => {
  const db=await database();const sql=adapter(db);const t=base+60*MINUTE;
  try {
    for(const p of series())await savePrint(sql,p.price,p.ts,p.ts);
    const before=await snapshot(sql,t);const signal=signalV1(input());
    const applied=await Promise.all([applySignal(sql,before,signal,t,t),applySignal(sql,before,signal,t,t)]);
    assert.deepEqual(applied,[true,false]);
    await assert.rejects(db.query("insert into paper_spot_trades(signal_version,side,entry_ts,entry_price,status) values('spot-signal-v1','short',$1,100,'open')",[new Date(t+MINUTE).toISOString()]));
    assert.equal(await paperTick(sql,t,true),true);
    const state=await snapshot(sql,t);assert.equal(state.trades.length,1);
    const exit={...signal,action:"exit" as const,exitReason:"opposite" as const,price:150};
    assert.equal(await applySignal(sql,state,exit,t+MINUTE,t+MINUTE),true);
    assert.equal(await applySignal(sql,state,exit,t+MINUTE,t+MINUTE),false);
    const closed=await snapshot(sql,t+MINUTE);assert.equal(closed.trades[0].status,"closed");assert.equal(closed.trades[0].pnlPaper,paperReturn("long",159,150).pnlPaper);
    assert.equal(await applySignal(sql,closed,signal,t+MINUTE,t+MINUTE),false);
  }finally{await db.close();}
});
test("real SQL: 50th close atomically kills, remains visible, rejects stale/new entry, no resurrection", async () => {
  const db=await database();const sql=adapter(db);const t=base+200*MINUTE;
  try {
    const trades=Array.from({length:49},(_,i)=>close(i+1));await insertClosed(db,trades);
    await db.query("update spot_signal_versions set n_closed=49,pnl_paper=$1",[trades.reduce((s,t)=>s+t.pnlPaper!,0)]);
    await db.query("insert into paper_spot_trades(signal_version,side,entry_ts,entry_price,status) values('spot-signal-v1','long',$1,100,'open')",[new Date(t-MINUTE).toISOString()]);
    const state=await snapshot(sql,t);const exit={...signalV1(input()),action:"exit" as const,exitReason:"max_hold" as const,price:100};
    assert.equal(await applySignal(sql,state,exit,t,t),true);
    const killed=await snapshot(sql,t);assert.equal(killed.version.status,"killed");assert.equal(killed.version.nClosed,50);assert.equal(killed.trades.length,50);assert.ok(killed.version.killReason);assert.ok(Math.abs(killed.version.pnlPaper+0.05)<1e-12);
    assert.equal(await applySignal(sql,killed,{...exit,action:"enter",exitReason:null,side:"long"},t+MINUTE,t+MINUTE),false);
    await db.query("insert into paper_spot_trades(signal_version,side,entry_ts,entry_price,status) values('spot-signal-v1','long',$1,100,'open')",[new Date(t+MINUTE).toISOString()]);
    await savePrint(sql,90,t+MINUTE,t+MINUTE);
    assert.equal(await paperTick(sql,t+2*MINUTE,true),true);
    const flat=await snapshot(sql,t+2*MINUTE);assert.equal(flat.trades.at(-1)!.exitReason,"killed_flatten");assert.equal(flat.trades.length,51);assert.deepEqual(flat.version,killed.version);
  }finally{await db.close();}
});
test("real SQL: a successful checkpoint keeps active status and freezes its baseline", async () => {
  const db=await database();const sql=adapter(db);const t=base+200*MINUTE;
  try {
    await insertClosed(db,Array.from({length:49},(_,i)=>close(i+1,100,110)));
    await db.query("update spot_signal_versions set n_closed=49");
    await db.query("insert into paper_spot_trades(signal_version,side,entry_ts,entry_price,status) values('spot-signal-v1','long',$1,100,'open')",[new Date(t-MINUTE).toISOString()]);
    const state=await snapshot(sql,t);const exit={...signalV1(input()),action:"exit" as const,exitReason:"opposite" as const,price:110};
    assert.equal(await applySignal(sql,state,exit,t,t),true);
    const pass=await snapshot(sql,t);assert.equal(pass.version.status,"active");assert.equal(pass.version.nClosed,50);assert.equal(pass.version.bhPnl,0.099);
  }finally{await db.close();}
});
test("storage failure is explicitly unavailable, with no fabricated book", async () => {
  const report=await spotReport(base,{query:async()=>{throw new Error("unavailable")}});
  assert.equal(report.ok,false);assert.equal("state" in report,false);assert.equal(report.error,"Storage unavailable");assert.equal(report.authority,"none");
});
test("network client uses only the declared public GET, no redirects, bounded and validated", async () => {
  let calls=0;
  const request:typeof fetch=async(url,options)=>{calls++;assert.equal(url,TICKER_URL);assert.equal(options?.method,"GET");assert.equal(options?.redirect,"error");assert.equal(options?.headers,undefined);return Response.json({price:"100",time:new Date(base).toISOString()});};
  assert.deepEqual(await publicTicker(request),{price:100,ts:base});assert.equal(calls,1);
  await assert.rejects(publicTicker(async()=>Response.json({price:"0",time:new Date(base).toISOString()})));
  await assert.rejects(publicTicker(async()=>new Response("x".repeat(16385))));
  await assert.rejects(publicTicker(async()=>new Response("failure",{status:503})));
});
test("authority is none and timer boot is default off", () => {
  const previous=process.env.SPOT_LAB;delete process.env.SPOT_LAB;
  try {assert.equal(AUTHORITY,"none");const stop=startSpotLab();assert.equal(typeof stop,"function");stop();}
  finally {if(previous===undefined)delete process.env.SPOT_LAB;else process.env.SPOT_LAB=previous;}
});

test("report retains every gain/loss, distinguishes an empty confirmed book, and is read only", async () => {
  const db=await database();const sql=adapter(db);
  try {
    const empty=await spotReport(base,sql);assert.equal(empty.ok,true);if(empty.ok)assert.equal(empty.state.trades.length,0);
    await insertClosed(db,[close(1,100,110),close(2,100,90)]);
    const before=await snapshot(sql,base+10*MINUTE);const report=await spotReport(base+10*MINUTE,sql);
    assert.equal(report.ok,true);if(report.ok){assert.equal(report.state.trades.length,2);assert.ok(report.state.trades[0].pnlPaper!>0);assert.ok(report.state.trades[1].pnlPaper!<0);}
    assert.deepEqual(await snapshot(sql,base+10*MINUTE),before);
    await assert.rejects(db.query("insert into paper_spot_trades(signal_version,side,entry_ts,entry_price,exit_price,exit_reason,gross,pnl_paper,status) values('spot-signal-v1','long',$1,100,110,'opposite',0.1,0.099,'closed')",[new Date(base).toISOString()]));
  }finally{await db.close();}
});
test("after a passing checkpoint, later losses cannot rejudge it or alter the fixed baseline", async () => {
  const db=await database();const sql=adapter(db);const t=base+200*MINUTE;
  try {
    await insertClosed(db,Array.from({length:50},(_,i)=>close(i+1,100,110)));
    await db.query("update spot_signal_versions set n_closed=50,pnl_paper=4.95,bh_pnl=0.099");
    await db.query("insert into paper_spot_trades(signal_version,side,entry_ts,entry_price,status) values('spot-signal-v1','short',$1,100,'open')",[new Date(t-MINUTE).toISOString()]);
    const state=await snapshot(sql,t);const exit={...signalV1(input()),action:"exit" as const,exitReason:"opposite" as const,price:1000};
    assert.equal(await applySignal(sql,state,exit,t,t),true);
    const next=await snapshot(sql,t);assert.equal(next.version.status,"active");assert.equal(next.version.bhPnl,0.099);assert.equal(next.version.nClosed,51);assert.ok(next.version.pnlPaper<0);
  }finally{await db.close();}
});
