import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToString } from "react-dom/server";

function load(path, deps = {}, globals = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, Date, AbortSignal, Error,
    require(key) { assert.ok(key in deps, `unexpected import ${key}`); return deps[key]; },
    ...globals,
  });
  return exports;
}

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const settings = { source: "live", poll_ms: 4000, beast: false };
const learner = () => ({ window_memory: { path_since_entry: [] } });
const serverFrame = (ticker = "LIVE") => ({
  snap: { ticker, as_of: 1000, close_time: 900000, spot: 65000 },
  votes: [], chair: { lean: "DOWN", confidence: 75 }, learner: learner(),
  call_log: [{ ticker, lean: "UP", cents: 81, settle: null }],
  settings, lastError: null, tick_age_s: 0, settling: false, v2: null,
});
const ok = (body = serverFrame()) => ({ ok: true, json: async () => body });

function harness() {
  const timers = new Map();
  const events = new Map();
  const writes = [];
  let nextTimer = 0;
  let requests = 0;
  let demoTicks = 0;
  let respond = async () => { throw new Error("offline"); };
  const doc = { hidden: false, addEventListener: (key, fn) => events.set(key, fn) };
  const deps = {
    "./persist": {
      DEFAULT_SETTINGS: settings,
      loadPersisted: () => ({ settings: { ...settings }, learner: learner() }),
      loadLearner: learner, loadCallLog: () => [],
      savePersisted: (value) => writes.push(value), saveCallLog: () => {},
    },
    "./skills": { freshLearner: learner },
    "./demo": {
      newDemoWindow: () => ({}),
      demoTick: () => { demoTicks++; return { ticker: "DEMO", spot: 100, close_time: 999999, as_of: 2000, secs_left: 600, health: { spot: "OK", kalshi: "OK" } }; },
    },
    "./bots": { runBots: () => [] },
    "./chair": { runChair: () => ({ lean: "WAIT" }) },
    "./time-gates": { softenTimeGates: (chair) => chair },
    "./stick": { stickLean: (_previous, lean) => ({ lean, st: { shown: lean } }) },
    "./scalp": { CHAIR_SCALP: "SATOSHI", onLean: () => {} },
    "./learner": { chicagoHuddleDue: () => false, windowsHuddleDue: () => false },
    "./hist": {}, "./live": {}, "./book-floor": {},
    "./pulse": { startPulse: () => {}, stopPulse: () => {} },
  };
  const api = load("src/lib/desk/engine.ts", deps, {
    document: doc, window: { addEventListener: (key, fn) => events.set(key, fn) },
    setInterval: (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; },
    clearInterval: (id) => timers.delete(id),
    fetch: async (url) => { requests++; assert.equal(url, "/frame"); return respond(); },
  });
  return {
    api, timers, events, doc, writes,
    get requests() { return requests; }, get demoTicks() { return demoTicks; },
    respond(fn) { respond = fn; },
    async poll() { assert.equal(timers.size, 1); [...timers.values()][0].fn(); await flush(); },
  };
}

test("first live failure stays live, writes no demo state, and recovers on the next poll", async () => {
  const h = harness();
  h.api.startEngine(); await flush();
  assert.equal(h.api.getFrame().settings.source, "live");
  assert.equal(h.api.getFrame().snap, null);
  assert.equal(h.api.getFrame().connection_error, "offline");
  assert.equal(h.demoTicks, 0);
  assert.equal(h.writes.length, 0);
  assert.equal([...h.timers.values()][0].ms, 4000);
  const frame = serverFrame(); h.respond(async () => ok(frame)); await h.poll();
  assert.equal(h.api.getFrame().snap, frame.snap);
  assert.equal(h.api.getFrame().connection_error, null);
  assert.equal(h.api.getFrame().settings.source, "live");
  h.api.stopEngine();
});

test("an outage preserves the actual booked call, read, and receipt time until recovery", async () => {
  const h = harness(); const first = serverFrame();
  h.respond(async () => ok(first)); h.api.startEngine(); await flush();
  const before = h.api.getFrame();
  h.respond(async () => { throw new Error("timeout"); }); await h.poll();
  const after = h.api.getFrame();
  assert.equal(after.snap, before.snap);
  assert.equal(after.chair, before.chair);
  assert.equal(after.call_log, before.call_log);
  assert.equal(after.frame_at, before.frame_at);
  assert.equal(after.connection_error, "timeout");
  const recovered = serverFrame("NEXT"); h.respond(async () => ok(recovered)); await h.poll();
  assert.equal(h.api.getFrame().call_log, recovered.call_log);
  assert.equal(h.api.getFrame().connection_error, null);
  h.api.stopEngine();
});

test("bad HTTP, malformed JSON, and missing snapshots preserve the last live frame", async () => {
  const h = harness(); h.respond(async () => ok()); h.api.startEngine(); await flush();
  const before = h.api.getFrame();
  for (const response of [
    { ok: false, status: 503 },
    { ok: true, json: async () => { throw new Error("invalid JSON"); } },
    ok({}), ok({ ...serverFrame(), snap: null }),
  ]) {
    h.respond(async () => response); await h.poll();
    assert.equal(h.api.getFrame().snap, before.snap);
    assert.equal(h.api.getFrame().call_log, before.call_log);
    assert.equal(h.api.getFrame().frame_at, before.frame_at);
    assert.ok(h.api.getFrame().connection_error);
    assert.equal(h.demoTicks, 0);
  }
  h.api.stopEngine();
});

test("browser reconnect and returning to the tab retry promptly without overlapping requests", async () => {
  const h = harness(); h.api.startEngine(); await flush();
  let resolve; h.respond(() => new Promise((r) => { resolve = r; }));
  h.events.get("online")(); h.events.get("online")(); h.api.retryLiveConnection();
  assert.equal(h.requests, 2);
  resolve(ok()); await flush();
  h.doc.hidden = true; h.events.get("visibilitychange")();
  assert.equal(h.timers.size, 0);
  h.events.get("online")(); assert.equal(h.requests, 2);
  h.respond(async () => ok()); h.doc.hidden = false; h.events.get("visibilitychange")(); await flush();
  assert.equal(h.requests, 3); assert.equal(h.timers.size, 1);
  h.api.stopEngine(); h.events.get("online")(); assert.equal(h.requests, 3);
});

test("choosing Demo discards an older pending live response; returning to Live drops demo state", async () => {
  const h = harness(); let resolve;
  h.respond(() => new Promise((r) => { resolve = r; })); h.api.startEngine();
  h.api.patchSettings({ source: "demo" }); await flush();
  assert.equal(h.api.getFrame().settings.source, "demo");
  assert.equal(h.api.getFrame().snap.ticker, "DEMO");
  resolve(ok()); await flush();
  assert.equal(h.api.getFrame().settings.source, "demo");
  assert.equal(h.api.getFrame().snap.ticker, "DEMO");
  h.respond(async () => { throw new Error("offline"); });
  h.api.patchSettings({ source: "live" }); await flush();
  assert.equal(h.api.getFrame().snap, null);
  assert.equal(h.api.getFrame().settings.source, "live");
  assert.equal(h.api.getFrame().frame_at, 0);
  h.api.stopEngine();
});

test("a stopped engine ignores a pending response", async () => {
  const h = harness(); let resolve;
  h.respond(() => new Promise((r) => { resolve = r; })); h.api.startEngine(); h.api.stopEngine();
  resolve(ok()); await flush();
  assert.equal(h.api.getFrame().snap, null);
  assert.equal(h.api.getFrame().ticking, false);
});

test("stopped pulse requests cannot put live prices back into Demo", async () => {
  let resolve;
  const pulse = load("src/lib/desk/pulse.ts", { react: React }, {
    setInterval: () => 1, clearInterval: () => {},
    fetch: () => new Promise((r) => { resolve = r; }),
  });
  pulse.startPulse(); pulse.stopPulse();
  resolve(ok({ as_of: Date.now(), stale: false, spot: 65000 })); await flush();
  assert.equal(pulse.freshPulse(), null);
  assert.equal(pulse.pulseReceivedAt(), 0);
});

test("hydration retains only live snapshots and carries the connection failure into the UI", () => {
  let state = { ...serverFrame(), frame_at: 1000 };
  let listener;
  const effects = [];
  const store = load("src/lib/desk/store.ts", {
    react: {
      createContext: () => ({}), useContext: () => state,
      useState: () => [state, (fn) => { state = typeof fn === "function" ? fn(state) : fn; }],
      useEffect: (fn) => effects.push(fn),
    },
    "./engine": { subscribe: (fn) => { listener = fn; return () => {}; }, startEngine: () => {}, getFrame: () => ({ snap: null }) },
  });
  store.useDesk(); effects.forEach((fn) => fn());
  const emptyLive = { snap: null, settings, lastError: null, connection_error: "offline", ticking: true };
  listener(emptyLive);
  assert.equal(state.snap.ticker, "LIVE"); assert.equal(state.connection_error, "offline");
  assert.equal(state.frame_at, 1000);
  state = { ...state, settings: { ...settings, source: "demo" }, snap: { ticker: "DEMO" } };
  listener(emptyLive);
  assert.equal(state.snap, null); assert.equal(state.settings.source, "live");
});

const connection = load("src/lib/desk/connection-state.ts");
const view = (overrides = {}) => ({ ...serverFrame(), frame_at: 1000, brain_age_s: 0, ...overrides });

test("status distinguishes offline, reconnecting, delayed, loading, healthy, and explicit Demo", () => {
  assert.equal(connection.connectionNotice(view(), 1001, true), null);
  assert.match(connection.connectionNotice(view(), 1001, false).title, /Connection lost/);
  assert.match(connection.connectionNotice(view({ connection_error: "timeout" }), 1001, true).title, /Reconnecting/);
  assert.match(connection.connectionNotice(view(), 17000, true).title, /delayed/);
  assert.match(connection.connectionNotice(view({ brain_age_s: 31 }), 1001, true).title, /delayed/);
  assert.match(connection.connectionNotice(view({ snap: null }), 1001, true).title, /Connecting/);
  assert.equal(connection.connectionNotice(view({ settings: { ...settings, source: "demo" }, connection_error: "old" }), 99000, false), null);
  assert.equal(connection.connectionNotice(view({ lastError: "owner key rejected" }), 1001, true), null);
});

test("the notice renders accessible recovery text only when needed", () => {
  const { LiveConnectionNotice } = load("src/components/desk/LiveConnectionNotice.tsx", {
    react: React, "react/jsx-runtime": jsx,
    "@/lib/desk/connection-state": connection,
    "@/lib/desk/engine": { retryLiveConnection: () => {} },
  });
  assert.equal(renderToString(React.createElement(LiveConnectionNotice, { frame: view() })), "");
  const html = renderToString(React.createElement(LiveConnectionNotice, { frame: view({ connection_error: "offline" }) }));
  assert.match(html, /role="status"/); assert.match(html, /aria-live="polite"/);
  assert.match(html, /last received desk snapshot/); assert.match(html, /Retry now/);
});
