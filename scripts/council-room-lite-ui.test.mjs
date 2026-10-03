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

const { CouncilRoomLite } = load("src/components/desk/CouncilRoomLite.tsx");
const lite = load("src/lib/desk/council-room-lite.ts");
const feeds = load("src/lib/desk/council-room-feed.ts");
const { parseRosterSnapshot } = load("src/lib/desk/council-room-snapshot.ts");
const fx = load("src/lib/desk/council-room.fixtures.ts");
const { SEAT_IDS } = load("src/lib/desk/types.ts");

const T = fx.RECEIVED;
const env = { hidden: false, online: true };
const snap = parseRosterSnapshot({
  as_of: T,
  tick_age_s: 1.5,
  snap: { ticker: fx.TICKER, close_time: fx.CLOSE },
  chair: { lean: "WAIT", rows: SEAT_IDS.map((seat) => ({ seat, lean: seat === "STRIKE" ? "UP" : "WAIT", selectable_live_cards: 1, authority_ready_cards: 1 })) },
});
const live = lite.applySnapshot(lite.emptySnapshotState(), snap, T);
const render = (model) => renderToStaticMarkup(React.createElement(CouncilRoomLite, { model }));
const announce = (html) => {
  const m = /<p role="status" aria-live="polite" aria-atomic="true" data-room-announce="">([\s\S]*?)<\/p><p data-room-clock="">/.exec(html);
  assert.ok(m, "live region must be followed directly by the non-live clock line");
  return m[1];
};
const text = (html) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

test("the room's live region announces only the snapshot status, never clocks", () => {
  const feed = feeds.initialFeed([], T);
  const a = render(lite.buildRoomModel(live, feed, T + 1_000, env));
  const later = lite.applySnapshot(live, snap, T + 12_000);
  const b = render(lite.buildRoomModel(later, feed, T + 13_000, env));
  assert.notEqual(a, b, "read time changes");
  assert.equal(announce(a), announce(b));
  assert.doesNotMatch(announce(a), /UTC|ago|tick age|window/);
  assert.equal((a.match(/aria-live=/g) ?? []).length, 1);
});

test("seats are 21 non-interactive list items; the only control is one jump link", () => {
  const html = render(lite.buildRoomModel(live, feeds.initialFeed([], T), T, env));
  assert.equal((html.match(/<li /g) ?? []).length, 21);
  assert.doesNotMatch(html, /<button|<input|<select|tabindex=|onClick/);
  assert.equal((html.match(/<a /g) ?? []).length, 1);
  assert.match(html, /href="#exchange-heading"/);
  assert.equal((html.match(/<svg[^>]*aria-hidden="true"/g) ?? []).length, (html.match(/<svg/g) ?? []).length, "every mark is decorative");
  assert.match(text(html), /STRIKE UP/);
  assert.match(text(html), /ODDS Retired · no vote/);
  assert.match(text(html), /WARDEN Pit crew · no vote/);
});

test("reading order: status, SATOSHI, paper book, integrity, lab, seats", () => {
  const t = text(render(lite.buildRoomModel(live, feeds.initialFeed([], T), T, env)));
  const order = ["Current state: snapshot is current", "SATOSHI · Chair", "Paper book", "WARDEN · Feed integrity", "ALCHEMIST · Lab", "Current state · seat reads"].map((s) => t.indexOf(s));
  assert.ok(order.every((i) => i >= 0), JSON.stringify(order));
  assert.deepEqual([...order].sort((x, y) => x - y), order);
});

test("stale, unavailable and disconnected render explicitly and never as WAIT", () => {
  const feed = feeds.initialFeed([], T);
  const stale = text(render(lite.buildRoomModel(live, feed, T + feeds.STALE_AFTER_MS + 1, env)));
  assert.match(stale, /snapshot is stale/);
  const unavailable = render(lite.buildRoomModel(lite.applySnapshotFailure(lite.emptySnapshotState(), T), feed, T, env));
  assert.match(text(unavailable), /snapshot unavailable · seat and Chair state unknown/);
  assert.match(text(unavailable), /No snapshot values shown/);
  assert.doesNotMatch(unavailable, /data-read="WAIT"/);
  assert.match(text(unavailable), /Current state snapshot : unknown/);
  const offline = render(lite.buildRoomModel(live, feed, T, { hidden: false, online: false }));
  assert.match(text(offline), /disconnected · seat and Chair state unknown/);
  assert.doesNotMatch(offline, /data-read="(UP|WAIT|DOWN)"/);
  assert.match(text(offline), /none in retained recorded events · position unknown/);
});

test("data-flash appears only on targets of fresh recorded events", () => {
  const quiet = render(lite.buildRoomModel(live, feeds.initialFeed([fx.SYNTHETIC.book()], T), T, env));
  assert.doesNotMatch(quiet, /data-flash/);
  const base = feeds.applyDelivery(feeds.initialFeed([], T), [], T);
  const fresh = feeds.applyDelivery(base, [fx.SYNTHETIC.book()], T + 12_000);
  const html = render(lite.buildRoomModel(live, fresh, T + 12_000, env));
  assert.equal((html.match(/data-flash="true"/g) ?? []).length, 1);
  assert.match(html, /data-flash="true" aria-labelledby="room-lite-book"/);
});

test("CSS: flash is static under reduced motion and nothing in the room loops", () => {
  const css = readFileSync("src/styles.css", "utf8");
  const block = css.slice(css.indexOf("/* COUNCIL ROOM V1 LIGHTWEIGHT"));
  assert.ok(block.length > 100);
  assert.match(block, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.room-lite-tile\[data-flash="true"\],\s*\.room-lite-seat\[data-flash="true"\] \{ animation: none; \}/);
  assert.match(block, /html\[data-motion="reduce"\] \.room-lite-tile\[data-flash="true"\]/);
  assert.match(block, /\.room-lite-jump:focus-visible/);
  assert.doesNotMatch(block, /infinite|animation-iteration-count/);
  const animated = block.match(/animation:\s*[^;]+;/g) ?? [];
  assert.ok(animated.every((a) => /none|council-room-fresh 2\.4s ease-out 1/.test(a)), animated.join(" | "));
});
