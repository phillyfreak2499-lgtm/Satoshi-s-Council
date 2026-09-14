import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
function load(file, bindings = {}) {
  const source = readFileSync(new URL("../" + file, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {}; vm.runInNewContext(code, { exports, ...bindings }); return exports;
}
test("every destination remains reachable once, in an intentional group", () => {
  const { SITE_DESTINATIONS, sitePathActive } = load("src/lib/desk/navigation.ts");
  const paths = Array.from(SITE_DESTINATIONS, (item) => item.href);
  assert.equal(new Set(paths).size, paths.length);
  assert.deepEqual(paths.slice().sort(), ["/", "/chamber", "/training", "/books", "/lab", "/arena", "/board", "/about", "/faq", "/legal"].sort());
  assert.equal(sitePathActive("/training/wick", "/training"), true);
  assert.equal(sitePathActive("/training-other", "/training"), false);
  assert.equal(sitePathActive("/window/EXAMPLE", "/books"), true);
  assert.equal(sitePathActive("/seat/WICK", "/"), true);
});
test("only available coaches can open a training station", () => {
  const { availableCoach } = load("src/lib/desk/training.ts");
  assert.equal(availableCoach("wick").name, "WICK");
  for (const id of ["tape", "odds", "wire", "unknown", "../wick"]) assert.equal(availableCoach(id), undefined);
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
