import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import * as crypto from "node:crypto";
import * as net from "node:net";
import React from "react";
import { renderToString } from "react-dom/server";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

function load(file, deps = {}) {
  const module = { exports: {} };
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: (key) => {
    assert.ok(key in deps, `unexpected import ${key} in ${file}`); return deps[key];
  }, Date, Math, Set, Map, Number, JSON, Buffer, URL, Response, process: { env: {} }, setTimeout, clearTimeout });
  return module.exports;
}
const functions = { createServerFn: () => ({ validator() { return this; }, handler(fn) { return fn; } }) };
const controls = load("src/lib/desk/board-controls.server.ts", { "node:crypto": crypto, "node:net": net });
const display = load("src/lib/desk/display-evidence.ts");

async function database() {
  const pg = new PGlite();
  for (let pass = 0; pass < 2; pass++) for (const file of ["0002_board.sql", "0003_board_threads.sql", "20260914_board_controls.sql"]) {
    await pg.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  const sql = async (strings, ...values) => (await pg.query(strings.reduce((s, part, i) => s + (i ? `$${i}` : "") + part, ""), values)).rows;
  return { pg, sql };
}

test("Board limits serialize simultaneous requests and persist across callers", async () => {
  const { pg, sql } = await database();
  try {
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => controls.reserveBoardPost(sql, "same-network")));
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    for (let i = 1; i < 10; i++) {
      await pg.exec("update board_rate_limits set last_post_at = now() - interval '31 seconds'");
      await controls.reserveBoardPost(sql, "same-network");
    }
    await pg.exec("update board_rate_limits set last_post_at = now() - interval '31 seconds'");
    await assert.rejects(controls.reserveBoardPost(sql, "same-network"), /10 messages/);
    await controls.reserveBoardPost(sql, "other-network");
    await pg.exec("update board_rate_limits set window_start = now() - interval '61 minutes', last_post_at = now() - interval '31 seconds'");
    await controls.reserveBoardPost(sql, "same-network");
    const { rows } = await pg.query("select posts from board_rate_limits where network_key='same-network'");
    assert.equal(rows[0].posts, 1);
  } finally { await pg.close(); }
});

test("network keys ignore spoofed leading addresses and fail closed without an address", () => {
  assert.equal(controls.boardNetworkKey("1.2.3.4, 203.0.113.7", "secret"), controls.boardNetworkKey("9.8.7.6, 203.0.113.7", "secret"));
  assert.equal(controls.boardNetworkKey(undefined, "secret"), controls.boardNetworkKey("garbage", "secret"));
  assert.notEqual(controls.boardNetworkKey("203.0.113.7", "secret"), "203.0.113.7");
});

test("moderation is authenticated, reversible, audited, and hides a parent's replies", async () => {
  const { pg, sql } = await database();
  const identities = load("src/lib/desk/system-events.ts");
  const view = load("src/lib/desk/public-room-view.ts");
  const board = load("src/lib/desk/board.ts", {
    "@tanstack/react-start": functions,
    "./public-room-view": view, "./system-events": identities,
    "./admin.server": { adminKeyOk: (key) => key === "test-admin" },
    "@/lib/db": { getSql: async () => sql },
    "./board-controls.server": { ...controls, requestNetworkKey: async () => "network" },
  });
  try {
    await pg.exec("insert into board(who,body,kind) values ('Reader','Original text','idea'); insert into board(who,body,parent_id,kind) values ('Another','Reply',1,'feedback')");
    await assert.rejects(board.moderateBoard({ data: { admin_key: "wrong", id: 1, hidden: true, reason: "spam" } }), /admin only/);
    await assert.rejects(board.listBoardModeration({ data: { admin_key: "wrong" } }), /admin only/);
    assert.equal((await board.listBoard()).length, 2);
    await board.moderateBoard({ data: { admin_key: "test-admin", id: 1, hidden: true, reason: "spam" } });
    assert.equal((await board.listBoard()).length, 0);
    await assert.rejects(board.postBoard({ data: { who: "Visitor", body: "new reply", parent_id: 1 } }), /gone/);
    const hidden = await board.listBoardModeration({ data: { admin_key: "test-admin" } });
    assert.equal(hidden.find((p) => p.id === 1).body, "Original text");
    await board.moderateBoard({ data: { admin_key: "test-admin", id: 1, hidden: false, reason: "reviewed" } });
    assert.equal((await board.listBoard()).length, 2);
    assert.equal((await pg.query("select * from board_moderation_log")).rows.length, 2);
    await board.postBoard({ data: { who: "First name", body: "Accepted" } });
    await assert.rejects(board.postBoard({ data: { who: "Changed name", body: "Cannot evade" } }), /30 seconds/);
    await assert.rejects(board.postBoard({ data: { who: "Bot", body: "Spam", website: "filled" } }), /accept/);
  } finally { await pg.close(); }
});

test("UTC timestamps and small-sample labels are unambiguous", () => {
  assert.equal(display.utcStamp("2026-09-14T12:45:00Z"), "2026-09-14 12:45:00 UTC");
  assert.equal(display.utcStamp("bad"), "Time unavailable");
  assert.equal(display.sampleRate(1, 1), "Small sample · n=1");
  assert.equal(display.sampleRate(0.75, 20), "75% · n=20");
  assert.equal(display.sampleRate(null, 0), "No observations");
  assert.deepEqual([...display.humanRanks([{ name: "A" }, { name: "Warm", warming: true }, { name: "B" }])], [["A", 1], ["B", 2]]);
});

test("homepage server frames are request-scoped and the hook renders their data", async () => {
  let current = { snap: { ticker: "FIRST" }, settings: {}, learner: {}, as_of: 123, tick_age_s: 0, votes: [], chair: null, call_log: [], v2: null, settling: false, lastError: null };
  const home = load("src/lib/desk/home-public.ts", { "@tanstack/react-start": functions, "./persist": { DEFAULT_SETTINGS: { tz: "America/Chicago", source: "demo" } }, "./server-engine": { getServerFrame: async () => current } });
  const first = await home.publicHomeSnapshot();
  current = { ...current, snap: { ticker: "SECOND" } };
  const second = await home.publicHomeSnapshot();
  assert.equal(first.snap.ticker, "FIRST");
  assert.equal(second.snap.ticker, "SECOND");
  assert.equal(first.settings.source, "live");
  const store = load("src/lib/desk/store.ts", { react: React, "./engine": { getFrame: () => ({ snap: null }), subscribe: () => () => {}, startEngine: () => { throw Error("must not start in SSR"); } } });
  const View = () => React.createElement("p", null, store.useDesk().snap?.ticker ?? "waiting");
  const render = (frame) => renderToString(React.createElement(store.InitialDeskFrame.Provider, { value: frame }, React.createElement(View)));
  assert.equal(render(first), "<p>FIRST</p>");
  assert.equal(render(second), "<p>SECOND</p>");
});

test("route metadata survives the share injector without entity double escaping", async () => {
  const site = load("src/lib/desk/site.ts");
  const { injectGrokPwaHead } = await import("./grok-pwa-shared.mjs");
  const head = site.pageHead("/lab", "Lab · Satoshi's Council", "Compare paper experiments.");
  const escape = (s) => s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
  const html = '<html><head><title>Lab · Satoshi&#x27;s Council</title>' + head.meta.filter((m) => m.content).map((m) => `<meta ${m.property ? 'property' : 'name'}="${m.property ?? m.name}" content="${escape(m.content)}">`).join("") + '</head><body></body></html>';
  const result = injectGrokPwaHead(html, { site: {}, host: "satoshiscouncil.com" });
  assert.equal((result.match(/property="og:title"/g) ?? []).length, 1);
  assert.ok(result.includes('property="og:url" content="https://satoshiscouncil.com/lab"'));
  assert.ok(result.includes('name="twitter:title"'));
  assert.ok(!result.includes("&amp;#x27;"));
  assert.equal(head.links[0].href, "https://satoshiscouncil.com/lab");
});
