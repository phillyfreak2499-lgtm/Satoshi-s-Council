/** Frozen V3 cohorts settle existing receipts but collect no new-policy frames. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const now = Date.parse("2026-09-30T19:00:00Z");
const observers = [
  ["shadow-lab.server.ts", "shadowLabTick"],
  ["shadow-lab-mid-recovery.server.ts", "midRecoveryTick"],
  ["shadow-lab-mid-recovery-locks.server.ts", "midRecoveryLocksTick"],
  ["shadow-lab-mid-recovery-locks-v2.server.ts", "midRecoveryLocksV2Tick"],
];

/** Transpile actual observers; fake only the SQL/engine/resource boundaries. */
function loader(deps = {}) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const code = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, {
      exports,
      require: (key) => {
        const bare = key.replace(/\.ts$/, "");
        if (key in deps) return deps[key];
        if (bare in deps) return deps[bare];
        assert.ok(key.startsWith("."), `unexpected dependency ${key}`);
        const path = new URL(key.endsWith(".ts") ? key : `${key}.ts`, new URL(file, root));
        return load(path.href.slice(root.href.length));
      },
      Date, Math, JSON, Number, Array, Object, Map, Set, Intl, Promise, Error,
      structuredClone, setImmediate, setInterval: () => 1, clearInterval: () => {},
      globalThis: {}, console, process: { env: {}, memoryUsage: () => ({ rss: 100 * 1_048_576 }) },
    });
    return exports;
  }
  return load;
}

function boundaries(frame, events) {
  const sql = async (strings) => {
    const statement = strings.join("?");
    events.push(statement);
    if (/update desk_shadow_receipts/.test(statement)) return [{ experiment: "EXISTING_V3_RECEIPT" }];
    return [];
  };
  return {
    "@/lib/db": { getSql: async () => sql, dbPoolStats: () => null },
    "./server-engine": { getServerFrame: async () => { events.push("frame"); return frame; } },
    "./resource-governor": { governorDecision: () => ({ run: true, reasons: [] }) },
    "./resource-governor-witness": { readResourceGovernorWitness: () => ({ measured_at_ms: now, sample: {}, thresholds: {} }) },
  };
}

for (const [file, tick] of observers) {
  test(`${file}: different explicit policy settles first and never reads a new observation`, async () => {
    const events = [];
    let reads = 0;
    const frame = {
      selective: { policy: "ENTRY_OWNER_ROLLBACK_V1", ready: true },
      get snap() { reads += 1; return null; },
    };
    const mod = loader(boundaries(frame, events))(`src/lib/desk/${file}`);
    await mod[tick](now);
    assert.equal(reads, 0, "a mismatched-policy frame must not be observed");
    assert.ok(events.some((s) => /update desk_shadow_receipts/.test(s)), "existing receipts still settle");
    assert.equal(events.at(-1), "frame", "collection stops immediately after policy identity is read");
    assert.ok(!events.some((s) => /insert into|from desk_shadow_receipts where/i.test(s)), "no new receipts or arm evaluations");
    assert.ok(events.findIndex((s) => /update desk_shadow_receipts/.test(s)) < events.indexOf("frame"), "settlement precedes guard");
    if (file === "shadow-lab.server.ts") {
      assert.ok(events.some((s) => /from desk_selector_attribution a/.test(s)), "existing attribution rows also reach the settle sweep");
    }
  });

  test(`${file}: frozen policy and undefined legacy fixtures continue to normal frame validation`, async () => {
    for (const policy of ["ENTRY_SELECTIVE_V3", undefined]) {
      const events = [];
      let reads = 0;
      const frame = { selective: { policy, ready: true }, get snap() { reads += 1; return null; } };
      const mod = loader(boundaries(frame, events))(`src/lib/desk/${file}`);
      await mod[tick](now);
      assert.equal(reads, 1, `${String(policy)} is admitted to existing frame validation`);
    }
  });
}

test("selector attribution independently rejects a different explicit policy before tracking, finalizing, or SQL", async () => {
  const events = [];
  const mod = loader({ "@/lib/db": {} })("src/lib/desk/selector-attribution.server.ts");
  const t = mod.blankAttributionTracker();
  const retained = { ticks: 1, finalized: false };
  t.windows.set("old", retained);
  await mod.observeSelectorAttribution(async (s) => { events.push(s.join("?")); return []; }, {
    policy: "ENTRY_OWNER_ROLLBACK_V1", get snap() { throw new Error("mismatched policy must not read an observation"); },
  }, t, now);
  assert.deepEqual(events, []);
  assert.equal(t.windows.get("old"), retained, "no new-policy finalization of the frozen track");
  assert.equal(retained.finalized, false);
  assert.equal(t.written, 0);
});

test("selector attribution allows frozen and legacy policy inputs; the shadow caller passes the actual policy", async () => {
  for (const policy of ["ENTRY_SELECTIVE_V3", undefined]) {
    const events = [];
    const mod = loader({ "@/lib/db": {} })("src/lib/desk/selector-attribution.server.ts");
    await mod.observeSelectorAttribution(async (s) => { events.push(s.join("?")); return []; }, {
      policy, snap: { ticker: "KXBTC15M-FIXTURE", as_of: now, close_time: now + 420_000 },
      chair: {}, call_log: [], audit: null, ready: true, start: 0,
    }, mod.blankAttributionTracker(), now);
    assert.equal(events.length, 1, "the existing prospective-boundary read still executes");
    assert.match(events[0], /from desk_shadow_manifests/);
  }
  assert.match(read("src/lib/desk/shadow-lab.server.ts"), /policy: a\.selective\?\.policy/);
});


test("frozen package evaluator keeps V3 edge, index, family and confirmation gates under owner rollback", () => {
  const load = loader({ "@/lib/db": {} });
  const { SHADOW_PACKAGE_POLICY } = load("src/lib/desk/shadow-lab.server.ts");
  const { gateVector, DEPLOYED_POLICY } = load("src/lib/desk/gate-vector.ts");
  const { chairState, SELECTOR_ATTRIBUTION_POLICY } = load("src/lib/desk/selector-attribution.ts");
  assert.equal(DEPLOYED_POLICY.id, "ENTRY_OWNER_ROLLBACK_V1", "test runs against the actual changed Champion");
  assert.equal(SHADOW_PACKAGE_POLICY.id, "ENTRY_SELECTIVE_V3");
  assert.equal(SELECTOR_ATTRIBUTION_POLICY.id, "ENTRY_SELECTIVE_V3");
  assert.equal(SHADOW_PACKAGE_POLICY.kind, "owner_reference", "global deployed requirements cannot override frozen params");
  const snap = {
    ticker: "FROZEN-PACKAGE", as_of: now, close_time: now + 420_000,
    yes_ask: 85, yes_bid: 84, no_ask: 16, no_bid: 15, no_bid_size: 10, yes_bid_size: 10,
    edge_up: 5, edge_down: -20, lab_fair_yes: 95, lab_age_s: 1,
    spot_age_s: 1, obs: { receipt_ts: now - 1000, gap: "ok" },
    health: { spot_ok: true, kalshi_ok: true, spot: "LIVE", kalshi: "LIVE" },
  };
  const row = (seat) => ({ seat, lean: "UP", health: "LIVE", status: "LIVE", weight: 1, folded: false, forced_sit: false });
  const chair = { lean: "UP", score: 0.7, bar: 0.5, hard_fail: false, gates: [], rows: [row("STRIKE"), row("CHAIN")], quorum: { up: 2, down: 0, wait: 0 } };
  const watch = { key: `${snap.ticker}|${snap.close_time}`, side: "UP", mode: "normal", since: now - 8_000, last: now, frames: 3 };
  const ctx = { calls: [], ready: true, start: now - 3_600_000, watch };
  const baseline = gateVector(snap, chair, ctx, SHADOW_PACKAGE_POLICY);
  assert.equal(baseline.eligible_ignoring_confirmation, true, JSON.stringify(baseline.checks));
  assert.equal(baseline.checks.find((k) => k.id === "confirmation").pass, true);
  const scenarios = [
    ["model_edge", { ...snap, edge_up: 2 }, chair, ctx],
    ["index_edge", { ...snap, lab_fair_yes: 85 }, chair, ctx],
    ["families", snap, { ...chair, rows: [row("CARRY"), row("CHAIN")] }, ctx],
    ["time", { ...snap, close_time: now + 120_000 }, chair, ctx],
    ["confirmation", snap, chair, { ...ctx, watch: { ...watch, since: now, frames: 1 } }],
  ];
  for (const [id, s, c, x] of scenarios) {
    const vector = gateVector(s, c, x, SHADOW_PACKAGE_POLICY);
    assert.equal(vector.checks.find((k) => k.id === id).pass, false, `${id} stays frozen under the new Champion`);
    const attribution = chairState(s, c, x);
    assert.ok(attribution.gate, "the attribution evaluator must produce an actual gate vector");
    assert.equal(attribution.gate.checks.find((k) => k.id === id).pass, false, `attribution ${id} also stays V3`);
  }
});

test("shadow base provenance and all frozen manifest fingerprints remain V3", () => {
  const { SHADOW_BASE_POLICY_ID, SHADOW_MANIFEST_FINGERPRINTS } = loader()("src/lib/desk/shadow-manifests.ts");
  assert.equal(SHADOW_BASE_POLICY_ID, "ENTRY_SELECTIVE_V3");
  assert.deepEqual({ ...SHADOW_MANIFEST_FINGERPRINTS }, {
    UNMUTE_DEDUP_SHELF_V1: "UNMUTE_DEDUP_SHELF_V1|v1|612f23b9|8arms",
    WARDEN_JUMP_VETO_V1: "WARDEN_JUMP_VETO_V1|v1|ae4a57cc|5arms",
    SETTLE_BASIS_MEASURED_V1: "SETTLE_BASIS_MEASURED_V1|v1|e1c9d3b1|4arms",
    MIRROR_35_V1: "MIRROR_35_V1|v1|15d0f9d4|3arms",
  });
});
