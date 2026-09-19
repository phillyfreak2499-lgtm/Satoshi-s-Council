import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
function load(file, bindings = {}) {
  const source = readFileSync(new URL("../" + file, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {}; vm.runInNewContext(code, { exports, URLSearchParams, ...bindings }); return exports;
}
test("every destination remains reachable once, in an intentional group", () => {
  const { SITE_DESTINATIONS, sitePathActive } = load("src/lib/desk/navigation.ts");
  const paths = Array.from(SITE_DESTINATIONS, (item) => item.href);
  assert.equal(new Set(paths).size, paths.length);
  assert.deepEqual(paths.slice().sort(), ["/", "/desk", "/chamber", "/training", "/books", "/record", "/hour", "/lab", "/arena", "/board", "/about", "/faq", "/legal", "/?tab=atelier", "/?tab=settings", "/?tab=crew", "/?tab=structure", "/?view=guided", "https://satoshis-council-shop.fourthwall.com/"].sort());
  assert.equal(sitePathActive("/training/wick", "/training"), true);
  assert.equal(sitePathActive("/training-other", "/training"), false);
  assert.equal(sitePathActive("/window/EXAMPLE", "/books"), true);
  assert.equal(sitePathActive("/seat/WICK", "/desk"), true);
});
test("only available coaches can open a training station", () => {
  const { availableCoach } = load("src/lib/desk/training.ts");
  assert.equal(availableCoach("wick").name, "WICK");
  assert.equal(availableCoach("tape").name, "TAPE");
  assert.equal(availableCoach("drift").name, "DRIFT");
  for (const id of ["odds", "wire", "unknown", "../wick"]) assert.equal(availableCoach(id), undefined);
});
test("training feed sends only bounded WICK evidence and handles missing snapshots", async () => {
  const file = "server/routes/training-frame.get.ts";
  const source = readFileSync(new URL("../" + file, import.meta.url), "utf8").replace('const { getServerFrame } = await import("../../src/lib/desk/server-engine");', '');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  let frame = { as_of: 1, tick_age_s: 0, snap: { ticker: "TEST", candles_1m: Array.from({ length: 90 }, (_, t) => ({ t })) }, votes: [{ seat: "WICK", lean: "WAIT", evidence: ["closed candle"] }, { seat: "OTHER", evidence: ["not training"] }], learner: { private: true }, settings: { extra: true } };
  const exports = {}; vm.runInNewContext(code, { exports, Response, getServerFrame: async () => frame });
  let response = await exports.default(); let data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.snap.candles_1m.length, 48); assert.equal(data.snap.candles_1m[0].t, 42); assert.equal(data.wick.lean, "WAIT");
  assert.equal(data.learner, undefined); assert.equal(data.settings, undefined); assert.equal(data.votes, undefined); assert.equal(response.headers.get("cache-control"), "no-store");
  frame = { as_of: 1, snap: null, votes: [] }; response = await exports.default(); data = await response.json(); assert.equal(data.snap, null); assert.equal(data.wick, null);
});

test("TAPE projection bounds book samples and excludes execution claims and unrelated state", async () => {
  const source = readFileSync(new URL("../server/routes/training-tape-frame.get.ts", import.meta.url), "utf8").replace('const { getServerFrame } = await import("../../src/lib/desk/server-engine");', '');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  let frame = { as_of: 1, tick_age_s: 0, snap: { ticker: "TEST", candles_1m: Array.from({length:90},(_,t)=>({t})), imbalance_hist: Array.from({length:60},(_,i)=>i/100), imbalance:.5, yes_bid_size:60, no_bid_size:20, spread_cents:7 }, votes: [{seat:"TAPE",lean:"WAIT",health:"LIVE",feed_age_s:1,evidence:["resting size"]},{seat:"WICK",lean:"UP"}], learner:{private:true} };
  const exports = {}; vm.runInNewContext(code, { exports, Response, getServerFrame: async () => frame });
  const response = await exports.default(); const data = await response.json();
  assert.equal(data.tape.lean,"WAIT"); assert.equal(data.tape.feed_age_s,1); assert.equal(data.snap.candles_1m.length,48); assert.equal(data.book.imbalance_hist.length,24); assert.equal(data.book.imbalance_hist[0],.36);
  assert.equal(data.book.yes_bid_size,60); assert.equal(data.trades,undefined); assert.equal(data.wick,undefined); assert.equal(data.learner,undefined); assert.equal(data.votes,undefined); assert.equal(response.headers.get("cache-control"),"no-store");
  frame={snap:null,votes:[]}; const missing=await (await exports.default()).json(); assert.equal(missing.snap,null); assert.equal(missing.book,null); assert.equal(missing.tape,null);
});

test("DRIFT projection exposes only bounded momentum teaching evidence", async () => {
  const source = readFileSync(new URL("../server/routes/training-drift-frame.get.ts", import.meta.url), "utf8")
    .replace('const { getServerFrame } = await import("../../src/lib/desk/server-engine");', '')
    .replace('const { readDrift } = await import("../../src/lib/desk/structure");', '');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  let frame = {
    as_of: 1,
    tick_age_s: 0,
    snap: {
      ticker: "TEST",
      close_time: 2,
      spot: 100,
      strike: 99,
      ret5: .001,
      ret15: .003,
      ret30: .004,
      ret1h: .005,
      candles_1m: Array.from({ length: 90 }, (_, t) => ({ t })),
    },
    votes: [{ seat: "DRIFT", lean: "UP", raw_lean: "UP", confidence: 61, health: "LIVE", feed_age_s: 1, evidence: ["aligned"] }, { seat: "TAPE", lean: "DOWN" }],
    learner: { private: true },
    chair: { private: true },
  };
  const readDrift = () => ({ sign5: "UP", sign15: "UP", sign30: "UP", sign1h: "UP", aligned: true, strong15: true, accel: false, decay: false, pullback: false, stack: true, chop: false, lean: "UP", rsi: 55, volConfirm: true, trend: "UP", ema1mBull: true, ema5mBull: true });
  const exports = {};
  vm.runInNewContext(code, { exports, Response, getServerFrame: async () => frame, readDrift });
  const response = await exports.default();
  const data = await response.json();
  assert.equal(data.drift.lean, "UP");
  assert.equal(data.drift.confidence, 61);
  assert.equal(data.momentum.aligned, true);
  assert.equal(data.snap.ret15, .003);
  assert.equal(data.snap.candles_1m.length, 48);
  assert.equal(data.snap.candles_1m[0].t, 42);
  assert.equal(data.tape, undefined);
  assert.equal(data.learner, undefined);
  assert.equal(data.chair, undefined);
  assert.equal(data.votes, undefined);
  assert.equal(response.headers.get("cache-control"), "no-store");
  frame = { as_of: 1, tick_age_s: 0, snap: null, votes: [] };
  const missing = await (await exports.default()).json();
  assert.equal(missing.snap, null);
  assert.equal(missing.momentum, null);
  assert.equal(missing.drift, null);
});

test("TAPE live lessons pause for stale, future, or invalid book evidence", () => {
  const source=readFileSync(new URL("../public/training-desk/tape/main.js",import.meta.url),"utf8");
  const code=source.slice(source.indexOf("function validBook"),source.indexOf("function message"));
  const now=Date.now(); const context={Date,frame:null,offline:false}; vm.createContext(context); vm.runInContext(code,context);
  const fresh=()=>({as_of:now,tick_age_s:1,snap:{close_time:now+60000},book:{yes_bid_size:60,no_bid_size:20,spread_cents:7,imbalance:.5,imbalance_hist:[.1,.2,.3,.5]},tape:{health:"LIVE",feed_age_s:1}});
  assert.equal(context.isFresh(fresh()),true); assert.equal(context.persistence(fresh()),"UP");
  for(const edit of [f=>f.as_of=now-21000,f=>f.as_of=now+6000,f=>f.tick_age_s=-1,f=>f.tape.feed_age_s=16,f=>f.tape.health="STALE",f=>f.book.yes_bid_size=-1,f=>f.book.imbalance=2,f=>f.snap.close_time=now-1]){const f=fresh();edit(f);assert.equal(context.isFresh(f),false);}
  const short=fresh();short.book.imbalance_hist=[.5];assert.equal(context.persistence(short),"NEED 4"); const mixed=fresh();mixed.book.imbalance_hist=[.1,.2,-.1,.5];assert.equal(context.persistence(mixed),"MIXED");
});
