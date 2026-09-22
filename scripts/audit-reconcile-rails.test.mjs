/**
 * Audit-reconciliation rails (2026-09-22, external reconciliation pass).
 *
 * 1. A shadow-lab observer failure cannot alter decision output: the tick
 *    swallows a failing database or frame into its own health record and never
 *    writes to the frame it read.
 * 2. Oracle / counterfactual / baseline modules are evaluation-only: no
 *    decision module imports them.
 * 3. MIRROR-35 is a CANDIDATE_NOT_COLLECTING manifest with authority none; the
 *    intention helper reaches no production writer and the observer ignores it.
 * 4. A blind-floor summary is typed MARKET_BASELINE and can never be labelled a
 *    Chair backtest.
 * 5. Status-transition telemetry is wrapped, non-throwing, and hooked around
 *    every reviewSeats / runHuddle call site in the engine without assignment.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const codeOf = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

function loader(deps = {}, globals = {}) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const code = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { exports, require: (key) => {
      if (key in deps) return deps[key];
      const bare = key.replace(/\.ts$/, "");
      if (bare in deps) return deps[bare];
      assert.ok(key.startsWith("."), `unexpected dependency ${key}`);
      const path = new URL(key.endsWith(".ts") ? key : `${key}.ts`, new URL(file, root));
      return load(path.href.slice(root.href.length));
    }, Date, Math, JSON, Number, Array, Object, Map, Set, Intl, Promise, Error, structuredClone, setInterval, clearInterval, globalThis: {}, console, process: { env: { ...globals.env } } });
    return exports;
  }
  return load;
}

function walk(dir, out = []) {
  for (const name of readdirSync(new URL(dir, root))) {
    const rel = `${dir}${name}`;
    if (statSync(new URL(rel, root)).isDirectory()) walk(`${rel}/`, out);
    else if (/\.(ts|tsx|mjs)$/.test(name) && !/\.test\.(ts|mjs)$/.test(name)) out.push(rel);
  }
  return out;
}

const frameOf = (secsLeft) => {
  const close = Date.parse("2026-10-01T15:00:00Z");
  return {
    snap: { as_of: close - secsLeft * 1000, close_time: close, ticker: "KXBTC15M-26OCT011100-00", yes_ask: 84, yes_bid: 83, no_ask: 17, no_bid: 16, no_bid_size: 10, yes_bid_size: 10, demo: false, spot: 1 },
    chair: { lean: "UP", rows: [], gates: [], quorum: { up: 2, down: 0 } },
    votes: [], learner: { skills: {} }, settings: {}, selective: { ready: true },
  };
};

test("rail 1: a failing database inside shadowLabTick is absorbed into health; the frame is never touched", async () => {
  let frameReads = 0;
  const frame = frameOf(400);
  const before = JSON.stringify(frame);
  const load = loader({
    "@/lib/db": { getSql: async () => { throw new Error("db down"); } },
    "./server-engine": { getServerFrame: async () => { frameReads += 1; return frame; } },
  }, { env: { SHADOW_LAB_ENABLED: "true" } });
  const mod = load("src/lib/desk/shadow-lab.server.ts");
  await assert.doesNotReject(mod.shadowLabTick(Date.now()));
  assert.equal(mod.shadowLabHealth().error, "db down");
  assert.equal(frameReads, 0, "the frame is not even read when the database is down");
  assert.equal(JSON.stringify(frame), before);
});

test("rail 1b: a failing or out-of-window frame is absorbed; the observer reads a clone and writes nothing back", async () => {
  const calls = [];
  const sql = async (strings) => { calls.push(strings.join("?")); return []; };
  const boom = loader({ "@/lib/db": { getSql: async () => sql }, "./server-engine": { getServerFrame: async () => { throw new Error("frame boom"); } } }, { env: {} });
  const m1 = boom("src/lib/desk/shadow-lab.server.ts");
  await assert.doesNotReject(m1.shadowLabTick(Date.now()));
  assert.equal(m1.shadowLabHealth().error, "frame boom");

  const frame = frameOf(800); // outside the 180–600 s research window
  const before = JSON.stringify(frame);
  const ok = loader({ "@/lib/db": { getSql: async () => sql }, "./server-engine": { getServerFrame: async () => frame } }, { env: {} });
  const m2 = ok("src/lib/desk/shadow-lab.server.ts");
  await assert.doesNotReject(m2.shadowLabTick(Date.now()));
  assert.equal(m2.shadowLabHealth().error, null);
  assert.equal(JSON.stringify(frame), before, "the observer mutates nothing on the frame it was handed");
  assert.ok(calls.every((q) => /^\s*update desk_shadow_receipts/.test(q)), `only the settle sweep touched the database: ${calls.map((q) => q.slice(0, 40)).join(" | ")}`);

  const src = codeOf("src/lib/desk/shadow-lab.server.ts");
  assert.match(src, /structuredClone\(\{ snap: frame\.snap, votes: frame\.votes, learner: frame\.learner, settings: frame\.settings \}\)/);
  assert.match(src, /catch \(error\) \{\s*st\.error = /);
  assert.doesNotMatch(src, /frame\.(snap|chair|votes|learner|settings|selective)\s*=/);
});

test("rail 1c: healthz kicks the observer fire-and-forget and the observer is env-gated default OFF", () => {
  assert.match(read("server/routes/healthz.get.ts"), /void import\("\.\.\/\.\.\/src\/lib\/desk\/shadow-lab\.server"\)\s*\.then\(\(m\) => m\.ensureShadowLabObserver\(\)\)\s*\.catch\(\(\) => \{\}\);/);
  const load = loader({ "@/lib/db": { getSql: async () => { throw new Error("must not be called"); } } }, { env: {} });
  const mod = load("src/lib/desk/shadow-lab.server.ts");
  assert.equal(mod.ensureShadowLabObserver({}), "disabled");
  assert.equal(mod.ensureShadowLabObserver({ SHADOW_LAB_ENABLED: "TRUE" }), "disabled", "only the literal string true enables it");
  for (const f of walk("src/").concat(walk("server/"))) {
    if (f === "server/routes/healthz.get.ts" || f.startsWith("src/lib/desk/shadow-lab")) continue;
    assert.ok(!read(f).includes("shadow-lab.server"), `${f} imports the observer`);
  }
});

test("rail 2: oracle, counterfactual, baseline and reconciliation modules are evaluation-only (no decision module imports them)", () => {
  const evaluationOnly = ["counterfactuals", "market-baseline", "trial-decomposition", "vote-correlation", "evidence-strength", "price-precision", "status-transitions"];
  const importers = [];
  for (const f of walk("src/").concat(walk("server/"))) {
    const src = read(f);
    for (const m of evaluationOnly) {
      const re = new RegExp(`from ["'][./]*[\\w/.-]*\\b${m}(\\.server)?(\\.ts)?["']`);
      if (re.test(src) && !f.includes(`/${m}`)) importers.push(`${f} -> ${m}`);
    }
  }
  assert.deepEqual(importers.sort(), ["src/lib/desk/server-engine.ts -> status-transitions"], "the engine imports only the pure transition buffer; nothing else is imported by any runtime module (healthz kicks the drainer through a dynamic import)");
  assert.match(read("server/routes/healthz.get.ts"), /status-transitions\.server/);
  assert.doesNotMatch(read("src/lib/desk/server-engine.ts"), /status-transitions\.server/, "the engine never imports the writer side");
  assert.match(read("src/lib/desk/counterfactuals.ts"), /EVALUATION ONLY/);
  assert.doesNotMatch(codeOf("src/lib/desk/counterfactuals.ts"), /import .* from ["']\.\/(chair|selective-entry|book-floor|server-engine|learner)/);
});

test("rail 3: MIRROR-35 is CANDIDATE_NOT_COLLECTING, authority none, reaches no production writer, and the observer ignores it", () => {
  const load = loader({}, {});
  const manifests = load("src/lib/desk/shadow-manifests.ts");
  const lab = load("src/lib/desk/shadow-lab.ts");
  const e4 = manifests.E4_MIRROR_35_V1;
  assert.equal(e4.status, "CANDIDATE_NOT_COLLECTING");
  assert.equal(e4.authority, "none");
  assert.equal(e4.prospective_start_at, null);
  assert.equal(lab.countsAgainstCap(e4.status), false);
  assert.equal(manifests.activeShadowCount(), 0);
  assert.equal(lab.SHADOW_MAX_ACTIVE, 3);
  const arms = codeOf("src/lib/desk/shadow-arms.ts");
  for (const forbidden of ["noteCall(", "applyDeskOp(", "server-engine", "book-floor", "desk_ledger", "e.learner", "status = \"LIVE\""]) {
    assert.ok(!arms.includes(forbidden), `shadow-arms reaches ${forbidden}`);
  }
  assert.doesNotMatch(codeOf("src/lib/desk/shadow-lab.server.ts"), /MIRROR|mirror35/);
  assert.equal(new Set(manifests.SHADOW_MANIFESTS.map((m) => m.status)).has("SHADOW"), false, "nothing collects until an owner activates");
});

test("rail 4: a blind-floor summary is typed MARKET_BASELINE and the artifact never calls itself a Chair backtest", () => {
  const load = loader({}, {});
  const mod = load("src/lib/desk/market-baseline.ts");
  assert.equal(mod.MARKET_BASELINE, "MARKET_BASELINE");
  assert.throws(() => mod.assertBaseline({ kind: "CHAIR_BACKTEST" }), /not a MARKET_BASELINE summary/);
  const path = { side: "UP", winner: "UP", ticks: [{ secs_left: 400, yes_ask: 84, yes_bid: 83 }] };
  const s = mod.blindFloor([path], 80);
  assert.equal(s.kind, "MARKET_BASELINE");
  const artifact = read("docs/audit/market_baseline_2026-09-22.json");
  assert.equal(JSON.parse(artifact).label, "MARKET_BASELINE");
  assert.doesNotMatch(artifact, /CHAIR_BACKTEST/);
  for (const doc of ["docs/SELECTOR_VS_FLOOR_2026-09-22.md", "docs/EXTERNAL_AUDIT_RECONCILIATION_2026-09-22.md"]) {
    let text; try { text = read(doc); } catch { continue; }
    assert.ok(text.includes("MARKET_BASELINE"), `${doc} labels the blind floor as MARKET_BASELINE`);
  }
});

test("rail 5: status-transition telemetry never throws into the engine, is queued (not written) on the engine path, and is hooked around every review and huddle", async () => {
  const load = loader({}, {});
  const pure = load("src/lib/desk/status-transitions.ts");
  assert.equal(pure.queueStatusTransitions({ "A.x": "LIVE", "B.y": "SHADOW" }, { "A.x": "BENCH", "B.y": "SHADOW" }, "reviewSeats", 1790000000000), 1);
  assert.equal(pure.queueStatusTransitions(null, undefined, "runHuddle"), 0, "garbage input is absorbed, never thrown");
  for (let i = 0; i < pure.STATUS_TRANSITION_BUFFER_MAX + 10; i += 1) pure.queueStatusTransitions({ c: "LIVE" }, { c: "BENCH" }, "runHuddle", i);
  const stats = pure.statusTransitionBufferStats();
  assert.equal(stats.pending, pure.STATUS_TRANSITION_BUFFER_MAX, "the buffer is bounded");
  assert.equal(stats.dropped, 11, "drops are counted, never thrown");
  assert.equal(pure.drainStatusTransitions(5).length, 5);

  const written = [];
  const failing = loader({ "./system-events.server": { recordSystemEvent: async (ev) => { written.push(ev); if (written.length === 1) throw new Error("db down"); return { inserted: true }; } } }, {});
  const server = failing("src/lib/desk/status-transitions.server.ts");
  const pure2 = failing("src/lib/desk/status-transitions.ts");
  pure2.queueStatusTransitions({ "A.x": "LIVE", "B.y": "LIVE" }, { "A.x": "BENCH", "B.y": "SHADOW" }, "reviewSeats", 1790000000000);
  assert.equal(await server.drainStatusTransitionLog(1), 1, "one write failed, one succeeded, nothing threw");
  const health = server.statusTransitionLogHealth();
  assert.deepEqual({ written: health.written, failed: health.failed, error: health.error, pending: health.buffer.pending }, { written: 1, failed: 1, error: "db down", pending: 0 });
  assert.equal(written[0].event_key, "SKILL_STATUS:A.x:LIVE_to_BENCH:1790000000000");
  assert.equal(written[0].public, false);
  assert.equal(written[0].payload.authority, "none");
  assert.equal(server.ensureStatusTransitionLog({ SKILL_STATUS_LOG_DISABLED: "true" }), "disabled");

  const engine = codeOf("src/lib/desk/server-engine.ts");
  const huddles = (engine.match(/runHuddle\(e\.learner\)/g) ?? []).length;
  const huddleHooks = (engine.match(/queueStatusTransitions\(statusesBeforeHuddle, skillStatusSnapshot\(e\.learner\), "runHuddle"\)/g) ?? []).length;
  assert.ok(huddles >= 3 && huddles === huddleHooks, `every runHuddle site is instrumented (${huddles} sites, ${huddleHooks} hooks)`);
  assert.match(engine, /const statusesBeforeReview = skillStatusSnapshot\(e\.learner\);\s*reviewSeats\(e\.learner\);\s*queueStatusTransitions\(statusesBeforeReview, skillStatusSnapshot\(e\.learner\), "reviewSeats"\);/);
  assert.doesNotMatch(engine, /=\s*queueStatusTransitions\(/, "the hook's return is never assigned");
  assert.doesNotMatch(engine, /recordSystemEvent|status-transitions\.server/, "the engine never touches the writer");
  assert.doesNotMatch(codeOf("src/lib/desk/status-transitions.ts"), /\.status\s*=/, "the pure module never assigns a status");
  assert.match(read("server/routes/healthz.get.ts"), /void import\("\.\.\/\.\.\/src\/lib\/desk\/status-transitions\.server"\)\s*\.then\(\(m\) => m\.ensureStatusTransitionLog\(\)\)\s*\.catch\(\(\) => \{\}\);/);
});


test("rail 6: shadow collection cannot start before verified atomic prospective boundary and MIRROR-35 is excluded", () => {
  const server = codeOf("src/lib/desk/shadow-lab.server.ts");
  const manifests = codeOf("src/lib/desk/shadow-manifests.ts");
  assert.match(server, /await registerShadowManifests\(sql\);\s*await verifyShadowManifests\(sql\);\s*const activation = await activateInitialShadowCollection\(sql, Date\.now\(\)\);[\s\S]*st\.activatedAt = durableStart;[\s\S]*st\.timer = setInterval/);
  assert.match(server, /st\.sessionStartedAt = Date\.now\(\);[\s\S]*st\.timer = setInterval/);
  assert.match(server, /const windowOpen = snap\.close_time - 15 \* 60_000;\s*if \(st\.sessionStartedAt > 0 && windowOpen < st\.sessionStartedAt\) return;/);
  assert.match(server, /candidates = 3 or \(shadows = 3 and shadow_starts = 1\)/);
  assert.match(server, /coalesce\(m\.prospective_start_at,/);
  assert.match(server, /shadow manifest fingerprint mismatch/);
  assert.match(server, /shadow manifest fee fingerprint mismatch/);
  assert.match(server, /a\.decided\.has\(k\) \|\| pending\.has\(k\)/);
  assert.match(server, /recordShadowReceipt\(sql, r, payload\)[\s\S]*\.then\(\(inserted\) => \{[\s\S]*a\.decided\.add\(k\)/);
  assert.doesNotMatch(server.slice(server.indexOf("activateInitialShadowCollection"), server.indexOf("/**\n * Settle fill receipts")), /MIRROR_35_V1/);
  assert.match(manifests, /INITIAL_SHADOW_COLLECTION_IDS/);
  const targetBlock = manifests.slice(manifests.indexOf("INITIAL_SHADOW_COLLECTION_IDS"), manifests.indexOf("/** The three-active rule"));
  assert.doesNotMatch(targetBlock, /MIRROR_35_V1/);
});
