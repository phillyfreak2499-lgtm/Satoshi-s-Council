import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function load(path, overrides = {}) {
  const output = ts.transpileModule(read(path), { fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((id) => id in overrides ? overrides[id] : require(id), module, module.exports);
  return module.exports;
}
const events = load("src/lib/desk/desk-sound-events.ts");
const playerModule = load("src/lib/desk/desk-sound-player.ts");
const { newSoundCursor, observeDeskSounds, deskSoundViewActive } = events;
const { renderDeskCue, safeDeskVolume, DeskSoundPlayer } = playerModule;
const BASE = Date.parse("2026-09-16T16:00:00Z");
const CLOSE = BASE + 900000;
const TICKER = "KXBTC15M-26SEP161215-15";
const row = (overrides = {}) => ({ id: "paper", ticker: TICKER, close_time: CLOSE, t: BASE + 4000, lean: "UP", cents: 83, settle: null, flipped: false, ...overrides });
const frame = (t, lean = "WAIT", rows = []) => ({
  settings: { source: "live" }, frame_at: t, brain_age_s: 0, connection_error: null, lastError: null,
  chair: { lean, score: 0, bar: 0.54 }, call_log: rows,
  snap: { as_of: t, ticker: TICKER, close_time: CLOSE, health: { spot: "LIVE", kalshi: "LIVE" }, official_settles: [] },
});
const observe = (c, f, active = true, now = f.frame_at) => observeDeskSounds(c, f, now, active);

test("initial load and restored sessions never announce an existing Chair read", () => {
  const c = newSoundCursor();
  assert.deepEqual(observe(c, frame(BASE, "UP", [row({ t: BASE - 1000, close_time: BASE + 600000 })])), []);
  assert.deepEqual(observe(c, frame(BASE + 4000, "WAIT")), []);
  assert.deepEqual(observe(c, frame(BASE + 8000, "UP")), []);
  const restored = newSoundCursor([...c.seen]);
  observe(restored, frame(BASE + 12000));
  assert.deepEqual(observe(restored, frame(BASE + 16000, "UP")), []);
});

test("new Chair directions sound once per direction per window, not on gauge motion", () => {
  const c = newSoundCursor();
  observe(c, frame(BASE));
  assert.equal(observe(c, frame(BASE + 4000, "UP"))[0].kind, "chair-up");
  observe(c, frame(BASE + 8000));
  assert.deepEqual(observe(c, frame(BASE + 12000, "UP")), []);
  assert.equal(observe(c, frame(BASE + 16000, "DOWN"))[0].kind, "chair-down");
  assert.deepEqual(observe(c, frame(BASE + 20000, "DOWN")), []);
  const high = frame(BASE + 24000); high.chair.score = 999;
  assert.deepEqual(observe(c, high), []);
});

test("a real new paper record has priority over the simultaneous Chair cue", () => {
  const c = newSoundCursor(); observe(c, frame(BASE));
  const f = frame(BASE + 4000, "UP", [row()]);
  assert.deepEqual(observe(c, f).map((e) => e.kind), ["paper-fill"]);
  assert.deepEqual(observe(c, f), []);
  assert.deepEqual(observe(c, frame(BASE + 8000, "UP", [row()])), []);
});

test("old, wrong-window and malformed paper records cannot create fill sounds", () => {
  for (const change of [{ t: BASE - 40000 }, { cents: NaN }, { cents: 0 }, { cents: 100 }, { ticker: "DEMO" }, { close_time: CLOSE + 900000 }, { t: CLOSE }, { lean: "WAIT" }]) {
    const c = newSoundCursor(); observe(c, frame(BASE));
    assert.deepEqual(observe(c, frame(BASE + 4000, "WAIT", [row(change)])), []);
  }
});

function settlementFrame(value = 100) {
  const f = frame(CLOSE + 4000, "WAIT", [row({ settle: value })]);
  f.snap.ticker = "KXBTC15M-26SEP161230-30";
  f.snap.close_time = CLOSE + 900000;
  f.snap.official_settles = [{ ticker: TICKER, close_time: CLOSE, lean: value === 100 ? "UP" : "DOWN", receipt_ts: CLOSE + 1000 }];
  return f;
}

test("settlement requires an observed open position and matching fresh official evidence", () => {
  for (const result of [0, 100]) {
    const c = newSoundCursor(); observe(c, frame(CLOSE - 8000, "WAIT", [row()]));
    const f = settlementFrame(result);
    assert.deepEqual(observe(c, f).map((e) => e.kind), ["settlement"]);
    assert.deepEqual(observe(c, { ...f, frame_at: CLOSE + 8000, snap: { ...f.snap, as_of: CLOSE + 8000 } }), []);
  }
});

test("no result sound for a backfilled, missing, stale or mismatched settlement", () => {
  for (const change of ["missing", "stale", "wrong-close", "wrong-result", "not-observed"]) {
    const c = newSoundCursor(); observe(c, frame(CLOSE - 8000, "WAIT", change === "not-observed" ? [] : [row()]));
    const f = settlementFrame();
    if (change === "missing") f.snap.official_settles = [];
    if (change === "stale") f.snap.official_settles[0].receipt_ts = CLOSE - 40000;
    if (change === "wrong-close") f.snap.official_settles[0].close_time += 900000;
    if (change === "wrong-result") f.snap.official_settles[0].lean = "DOWN";
    assert.deepEqual(observe(c, f), []);
  }
});

test("Demo, stale feeds and transport recovery stay silent and cannot queue alerts", () => {
  for (const change of ["demo", "error", "stale", "age", "missing-age", "future"]) {
    const c = newSoundCursor(); observe(c, frame(BASE));
    const f = frame(BASE + 4000, "UP");
    if (change === "demo") f.settings.source = "demo";
    if (change === "error") f.connection_error = "offline";
    if (change === "stale") f.snap.health.kalshi = "STALE";
    if (change === "age") f.brain_age_s = 30;
    if (change === "missing-age") f.brain_age_s = null;
    if (change === "future") f.snap.as_of += 30000;
    assert.deepEqual(observe(c, f), []);
    assert.deepEqual(observe(c, frame(BASE + 8000, "UP")), []);
    assert.deepEqual(observe(c, frame(BASE + 12000, "UP")), []);
  }
});

test("mute, backgrounding, long gaps and out-of-order frames cannot replay history", () => {
  const c = newSoundCursor(); observe(c, frame(BASE));
  assert.deepEqual(observe(c, frame(BASE + 4000, "UP"), false), []);
  assert.deepEqual(observe(c, frame(BASE + 8000, "UP")), []);
  assert.deepEqual(observe(c, frame(BASE + 6000, "DOWN"), true, BASE + 9000), []);
  assert.deepEqual(observe(c, frame(BASE + 40000, "DOWN")), []);
  assert.deepEqual(observe(c, frame(BASE + 44000, "DOWN")), []);
});

test("large historical books do not evict the current read and repeat its alert", () => {
  const old = Array.from({ length: 500 }, (_, i) => row({ ticker: `${TICKER}-${i}`, close_time: BASE - (i + 50) * 900000, t: BASE - (i + 50) * 900000 - 600000, settle: 100 }));
  const c = newSoundCursor(); observe(c, frame(BASE, "WAIT", old));
  assert.equal(observe(c, frame(BASE + 4000, "UP", old))[0].kind, "chair-up");
  assert.deepEqual(observe(c, frame(BASE + 8000, "UP", old)), []);
  assert.ok(c.seen.size <= 384);
});

test("window identity includes close time and state restoration is bounded", () => {
  const c = newSoundCursor(); observe(c, frame(BASE, "UP"));
  const f = frame(BASE + 4000, "UP"); f.snap.close_time += 900000;
  assert.equal(observe(c, f)[0].kind, "chair-up");
  assert.equal(newSoundCursor([null, {}, 1]).seen.size, 0);
  assert.equal(newSoundCursor(Array.from({ length: 1000 }, (_, i) => `key-${i}`)).seen.size, 384);
});

test("only live Floor and Gallery views are eligible, never replay or training routes", () => {
  for (const search of ["", "?view=guided", "?tab=satoshi", "?tab=atelier&mode=streamer"]) assert.equal(deskSoundViewActive("/", search), true);
  for (const search of ["?tab=books", "?tab=settings", "?seat=WICK", "?tab=board"]) assert.equal(deskSoundViewActive("/", search), false);
  for (const path of ["/books", "/window/example", "/training-desk/wick/index.html", "/chamber"]) assert.equal(deskSoundViewActive(path, ""), false);
});

test("original audio is deterministic, finite, short, bounded and fades to silence", () => {
  for (const kind of ["chair-up", "chair-down", "paper-fill", "settlement"]) {
    const a = renderDeskCue(kind); const b = renderDeskCue(kind);
    assert.deepEqual(a, b);
    assert.ok(a.length > 2400 && a.length < 24000);
    assert.ok(a.every(Number.isFinite));
    assert.ok(Math.max(...a.map(Math.abs)) > 0.02);
    assert.ok(Math.max(...a.map(Math.abs)) < 0.6);
    assert.equal(a[0], 0); assert.equal(a[a.length - 1], 0);
  }
  assert.notDeepEqual(renderDeskCue("chair-up"), renderDeskCue("chair-down"));
  assert.throws(() => renderDeskCue("chair-up", NaN));
  assert.equal(safeDeskVolume(NaN), 25); assert.equal(safeDeskVolume(-1), 0); assert.equal(safeDeskVolume(101), 100);
});

test("sound control SSR is muted with volume and previews, without creating audio", () => {
  const { DeskSoundControl } = load("src/components/desk/DeskSoundControl.tsx", {
    "@/lib/desk/store": { useDesk: () => frame(BASE) },
    "@/lib/desk/desk-sound-events": events,
    "@/lib/desk/desk-sound-player": playerModule,
  });
  const html = renderToStaticMarkup(createElement(DeskSoundControl));
  assert.match(html, /data-sound-enabled="false"/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /Desk sound volume/);
  assert.match(html, /Preview Chair UP sound/);
  assert.match(html, /Preview Paper fill sound/);
  assert.match(html, /Preview Settlement sound/);
  assert.match(html, /Preview does not enable alerts/);
  assert.ok(!html.includes("autoplay"));
});

test("player creates no AudioContext on construction and cannot play before explicit unlock", async () => {
  const original = globalThis.window;
  let created = 0; let started = 0; let stopped = 0; let closed = 0;
  class Audio {
    state = "running"; currentTime = 0; destination = {};
    constructor() { created++; }
    createGain() { return { gain: { value: 0, setTargetAtTime() {}, setValueAtTime() {}, cancelScheduledValues() {} }, connect() {} }; }
    createBuffer(channels, length) { return { getChannelData: () => new Float32Array(length) }; }
    createBufferSource() { return { connect() {}, disconnect() {}, start() { started++; }, stop() { stopped++; } }; }
    close() { closed++; this.state = "closed"; return Promise.resolve(); }
  }
  globalThis.window = { AudioContext: Audio };
  try {
    const p = new DeskSoundPlayer(); assert.equal(created, 0);
    assert.equal(p.play("paper-fill", 25), false);
    await p.unlock(); assert.equal(created, 1);
    assert.equal(p.play("paper-fill", 0), false);
    assert.equal(p.play("paper-fill", 25), true); assert.equal(started, 1);
    p.stop(); assert.equal(stopped, 1);
    p.dispose(); assert.equal(closed, 1);
    assert.equal(p.play("chair-up", 25), false);
  } finally { if (original === undefined) delete globalThis.window; else globalThis.window = original; }
});

test("audio is downstream of decisions, uses no score or write path, and exists once in the header", () => {
  for (const file of ["chair.ts", "server-engine.ts", "engine.ts", "selective-entry.ts", "book-floor.ts"]) assert.ok(!read(`src/lib/desk/${file}`).includes("desk-sound"));
  const observer = read("src/lib/desk/desk-sound-events.ts");
  assert.ok(!observer.includes("chair.score")); assert.ok(!observer.includes("chair.bar"));
  const control = read("src/components/desk/DeskSoundControl.tsx");
  assert.ok(!control.includes("fetch(")); assert.ok(!control.includes("postDesk"));
  assert.match(control, /document\.hasFocus\(\)/); assert.match(control, /!document\.hidden/);
  assert.match(control, /useState\(false\)/); assert.match(control, /sessionStorage/);
  assert.match(read("src/components/desk/GlobalHeader.tsx"), /location\.pathname === "\/"/);
  assert.equal((read("src/components/desk/SiteHeader.tsx").match(/\{controls\}/g) ?? []).length, 1);
});
