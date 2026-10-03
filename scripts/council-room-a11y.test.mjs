import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const noop = () => null;
const overrides = {
  "@/lib/desk/chamber-speech": { listChamberSpeech: async () => [] },
  "./RosterEvidence": { RosterEvidence: noop },
  "./PaperDisclaimer": { PaperDisclaimer: noop },
  "./GlobalHeader": { GlobalHeader: noop },
  "./Crest": { Crest: noop },
};
const cache = new Map();
function load(path) {
  const file = resolve(path);
  if (cache.has(file)) return cache.get(file);
  const out = ts.transpileModule(readFileSync(file, "utf8"), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const mod = { exports: {} };
  cache.set(file, mod.exports);
  const req = (id) => {
    if (id in overrides) return overrides[id];
    if (!id.startsWith(".") && !id.startsWith("@/")) return require(id);
    const base = id.startsWith("@/") ? join(process.cwd(), "src", id.slice(2)) : resolve(dirname(file), id);
    const found = [base, base + ".ts", base + ".tsx", base + "/index.ts"].find((p) => existsSync(p) && !p.endsWith("/"));
    if (!found) throw Error("unresolved " + id + " from " + file);
    return load(found);
  };
  new Function("require", "module", "exports", out)(req, mod, mod.exports);
  return mod.exports;
}

const { FeedStatus } = load("src/components/desk/ChamberRoom.tsx");
const feedModule = load("src/lib/desk/council-room-feed.ts");

const T = Date.parse("2026-10-02T23:20:00Z");
const env = { hidden: false, online: true };
const liveRegion = (html) => {
  const m = /<div role="status" aria-live="polite" aria-atomic="true" data-feed-announce="">([\s\S]*?)<\/div><div data-feed-clock="">/.exec(html);
  assert.ok(m, "live region must be followed directly by the non-live clock block");
  return m[1];
};

test("the polite live region holds only meaningful status, never the ticking clocks", () => {
  const feed = feedModule.applyDelivery(feedModule.initialFeed([], T), [], T);
  const a = renderToStaticMarkup(React.createElement(FeedStatus, { feed, env, now: T + 5_000 }));
  const b = renderToStaticMarkup(React.createElement(FeedStatus, { feed, env, now: T + 10_000 }));
  assert.notEqual(a, b, "the clocks do change every tick");
  assert.equal(liveRegion(a), liveRegion(b), "nothing inside the live region changes when only time passes");
  assert.doesNotMatch(liveRegion(a), /ago|Last successful read|Newest recorded event|UTC/);
  assert.equal((a.match(/aria-live=/g) ?? []).length, 1, "exactly one live region");
  assert.doesNotMatch(a, /role="status"[^>]*data-phase|data-phase[^>]*role="status"/, "outer panel is not itself live");
});

test("a later successful read changes the clock block but not the announcement", () => {
  const first = feedModule.applyDelivery(feedModule.initialFeed([], T), [], T);
  const second = feedModule.applyDelivery(first, [], T + 12_000);
  const a = renderToStaticMarkup(React.createElement(FeedStatus, { feed: first, env, now: T + 1_000 }));
  const b = renderToStaticMarkup(React.createElement(FeedStatus, { feed: second, env, now: T + 13_000 }));
  assert.notEqual(a, b);
  assert.equal(liveRegion(a), liveRegion(b));
});

test("phase, error and withheld-record transitions are announced", () => {
  const ok = feedModule.applyDelivery(feedModule.initialFeed([], T), [], T);
  const failed = feedModule.applyFailure(ok, new Error("read 503"), T + 12_000);
  const withheld = feedModule.applyDelivery(failed, [{ event_key: "bad key" }], T + 24_000);
  const regions = [ok, failed, withheld].map((feed) => liveRegion(renderToStaticMarkup(React.createElement(FeedStatus, { feed, env, now: T + 25_000 }))));
  assert.match(regions[0], /no recorded public events/);
  assert.match(regions[1], /Last read failed/);
  assert.match(regions[1], /Read error: read 503/);
  assert.match(regions[2], /Withheld from narration: 1 · missing or inconsistent identity/);
  const stale = liveRegion(renderToStaticMarkup(React.createElement(FeedStatus, { feed: ok, env, now: T + feedModule.STALE_AFTER_MS + 1 })));
  assert.match(stale, /Stale/);
  const offline = liveRegion(renderToStaticMarkup(React.createElement(FeedStatus, { feed: ok, env: { hidden: false, online: false }, now: T })));
  assert.match(offline, /Disconnected/);
});
