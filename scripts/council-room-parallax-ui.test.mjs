import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const cache = new Map();
function load(path) {
  const file = resolve(path);
  if (cache.has(file)) return cache.get(file);
  const out = ts.transpileModule(readFileSync(file, "utf8"), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  cache.set(file, mod.exports);
  const req = (id) => {
    if (!id.startsWith(".") && !id.startsWith("@/")) return require(id);
    const base = id.startsWith("@/") ? join(process.cwd(), "src", id.slice(2)) : resolve(dirname(file), id);
    const found = [base, base + ".ts", base + ".tsx", base + "/index.ts"].find((p) => existsSync(p) && !p.endsWith("/"));
    if (!found) throw Error("unresolved " + id + " from " + file);
    return load(found);
  };
  new Function("require", "module", "exports", out)(req, mod, mod.exports);
  return mod.exports;
}


/**
 * CR-CLAUDE-004 2.5D chamber markup and boundary checks. FIXTURES ARE SYNTHETIC.
 */
const { CouncilRoomParallax, MemberDetail, MOTION_PAUSE_LABEL } = load("src/components/desk/CouncilRoomParallax.tsx");
const lite = load("src/lib/desk/council-room-lite.ts");
const feeds = load("src/lib/desk/council-room-feed.ts");
const px = load("src/lib/desk/council-room-parallax.ts");
const { parseRosterSnapshot } = load("src/lib/desk/council-room-snapshot.ts");
const fx = load("src/lib/desk/council-room.fixtures.ts");
const { SEAT_IDS } = load("src/lib/desk/types.ts");

const T = fx.RECEIVED;
const env = { hidden: false, online: true };
const snap = parseRosterSnapshot({
  as_of: T,
  tick_age_s: 1,
  snap: { ticker: fx.TICKER, close_time: fx.CLOSE },
  chair: { lean: "UP", rows: SEAT_IDS.map((seat) => ({ seat, lean: "WAIT", selectable_live_cards: 1, authority_ready_cards: 1 })) },
});
const live = lite.applySnapshot(lite.emptySnapshotState(), snap, T);
const render = (feed, room, selected = null) => renderToStaticMarkup(React.createElement(CouncilRoomParallax, { feed, room, initialSelected: selected }));
const text = (html) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

test("seven member buttons and one motion-pause button; no live region, link-free stage, decorative planes", () => {
  const feed = feeds.initialFeed([], T);
  const html = render(feed, lite.buildRoomModel(live, feed, T, env));
  assert.equal((html.match(/class="room-px-member"/g) ?? []).length, 7);
  assert.equal((html.match(/<button/g) ?? []).length, 8, "seven members plus motion pause");
  assert.match(html, new RegExp(`<button type="button" class="room-px-motion">${MOTION_PAUSE_LABEL}</button>`));
  assert.doesNotMatch(html, /aria-live|role="status"/, "the 2.5D room adds no live region");
  assert.equal((html.match(/class="room-px-plane[^"]*" style="[^"]*" aria-hidden="true"/g) ?? []).length, 2, "planes are decorative");
  for (const id of ["SATOSHI", "WARDEN", "ALCHEMIST", "WICK", "DRIFT", "INDEX", "TAPE"]) assert.match(html, new RegExp(`data-member="${id}"`));
  assert.match(html, /aria-expanded="false"/);
});

test("a selected member shows recorded activity and current snapshot as two separate sections", () => {
  const feed = feeds.initialFeed([fx.SYNTHETIC.book(), fx.SYNTHETIC.sweep()], T);
  const room = lite.buildRoomModel(live, feed, T, env);
  const html = render(feed, room, "SATOSHI");
  const rec = html.indexOf('data-section="recorded"');
  const cur = html.indexOf('data-section="snapshot"');
  assert.ok(rec > 0 && cur > rec, "recorded first, then snapshot, separately");
  const recorded = html.slice(rec, cur);
  const current = html.slice(cur);
  assert.match(recorded, /History/, "page-load rows are labelled History");
  assert.match(recorded, /recorded /);
  assert.doesNotMatch(recorded, /snapshot is current|Chair current state/);
  assert.match(text(current), /Current snapshot · not a recorded event/);
  assert.match(text(current), /Chair current state: UP/);
  assert.match(html, /aria-expanded="true"/);
});

test("seat members say their activity is SWEEP's record about them; empty and no-field cases are stated, not invented", () => {
  const feed = feeds.initialFeed([fx.SYNTHETIC.sweep()], T);
  const room = lite.buildRoomModel(live, feed, T, env);
  const drift = text(renderToStaticMarkup(React.createElement(MemberDetail, { panel: px.memberPanel(feed, room, px.CAST.find((m) => m.id === "DRIFT")) })));
  assert.match(drift, /DRIFT does not speak in the event log\. Its activity is what SWEEP recorded about it\./);
  const wick = text(renderToStaticMarkup(React.createElement(MemberDetail, { panel: px.memberPanel(feed, room, px.CAST.find((m) => m.id === "WICK")) })));
  assert.match(wick, /No recorded event for WICK in the retained feed\./);
  const lab = text(renderToStaticMarkup(React.createElement(MemberDetail, { panel: px.memberPanel(feed, room, px.CAST.find((m) => m.id === "ALCHEMIST")) })));
  assert.match(lab, /The Lab has no current-state field in the desk snapshot\./);
  const warden = text(renderToStaticMarkup(React.createElement(MemberDetail, { panel: px.memberPanel(feed, room, px.CAST.find((m) => m.id === "WARDEN")) })));
  assert.match(warden, /Pit crew · no vote/);
  assert.doesNotMatch(warden, /Pit crew · no vote :/);
});

test("unknown, paused-by-you and disconnected states reach the panel text; never shown as WAIT", () => {
  const feed = feeds.initialFeed([], T);
  const off = text(render(feed, lite.buildRoomModel(live, feed, T, { hidden: false, online: false }), "SATOSHI"));
  assert.match(off, /disconnected · seat and Chair state unknown/);
  assert.match(off, /Chair current state: unknown/);
  const paused = text(render(feed, lite.buildRoomModel(live, feed, T, { ...env, userPaused: true }), "SATOSHI"));
  assert.match(paused, /live updates paused by you/);
  const none = text(render(feed, lite.buildRoomModel(lite.emptySnapshotState(), feed, T, env), "WICK"));
  assert.match(none, /Seat read: unknown/);
});

test("only fresh recorded events mark a member; history never does", () => {
  const history = feeds.initialFeed([fx.SYNTHETIC.alert()], T);
  assert.doesNotMatch(render(history, lite.buildRoomModel(live, history, T, env)), /data-flash/);
  const fresh = feeds.applyDelivery(feeds.applyDelivery(feeds.initialFeed([], T), [], T), [fx.SYNTHETIC.alert()], T + 12_000);
  const html = render(fresh, lite.buildRoomModel(live, fresh, T + 12_000, env));
  assert.equal((html.match(/data-flash="true"/g) ?? []).length, 1);
  assert.match(html, /data-member="WARDEN" data-flash="true"/);
});

test("CSS: drift only in live mode, static under reduced motion and on phones, focus-visible on every control", () => {
  const css = readFileSync("src/styles.css", "utf8");
  const block = css.slice(css.indexOf("/* COUNCIL ROOM V1 2.5D CHAMBER"));
  assert.ok(block.length > 100);
  assert.match(block, /\.room-px\[data-motion="live"\] \.room-px-plane,\s*\.room-px\[data-motion="live"\] \.room-px-cast \{ animation: room-px-drift/);
  assert.match(block, /@media \(prefers-reduced-motion: reduce\) \{\s*\.room-px-plane,\s*\.room-px-cast,\s*\.room-px-member\[data-flash="true"\] \{ animation: none !important; \}/);
  assert.match(block, /html\[data-motion="reduce"\] \.room-px-plane/);
  assert.match(block, /\.room-px-stage:focus-within \.room-px-cast \{ animation-play-state: paused; \}/, "drift holds still under focus");
  assert.match(block, /@media \(max-width: 719px\) \{[\s\S]*?\.room-px-plane \{ display: none; \}/);
  for (const sel of ["room-px-motion", "room-px-close", "room-px-member", "room-px-stage"]) assert.match(block, new RegExp(`\\.${sel}:focus-visible`), sel);
  const animated = (block.match(/animation:\s*[^;]+;/g) ?? []).filter((a) => !/none/.test(a));
  assert.ok(animated.every((a) => /room-px-drift 18s|council-room-fresh 2\.4s ease-out 1/.test(a)), animated.join(" | "));
});
