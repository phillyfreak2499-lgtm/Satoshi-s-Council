import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// Non-type, relative runtime imports of a module (import type ... is erased).
function runtimeRelImports(src) {
  return [...src.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"(\.[^"]+)"/gm)].map((m) => m[1]);
}

test("telemetry.ts is pure: leaf runtime deps only, no DB, no decision modules", () => {
  const src = read("src/lib/desk/telemetry.ts");
  const imports = runtimeRelImports(src);
  // Only the two leaf modules may be imported at runtime; everything else is type-only.
  for (const imp of imports) {
    assert.ok(
      imp === "./math.ts" || imp === "./seats.ts",
      `telemetry.ts must not runtime-import ${imp} (keep it pure/leaf)`,
    );
  }
  assert.doesNotMatch(src, /getSql|insert\s+into|db\.query|\bdelete\s+from/i, "pure module must not touch the DB");
  assert.doesNotMatch(src, /from\s+"\.\/(chair|crew|bots|server-engine|book-floor|booked-decision)/, "no decision-path imports");
});

test("telemetry.server.ts is env-gated, fail-open, and does no synchronous DB work on the tick", () => {
  const src = read("src/lib/desk/telemetry.server.ts");
  // OFF by default: a flag guard that returns before any work.
  assert.match(src, /SEAT_TELEMETRY_ENABLED/);
  assert.match(src, /function enabled\(\)/);
  assert.match(src, /if\s*\(!enabled\(\)\)\s*return;/);

  // noteSeatTelemetry is the tick-path entry: it must be wrapped fail-open and
  // must not await (no synchronous DB on the decision tick).
  const fn = src.slice(src.indexOf("export function noteSeatTelemetry"), src.indexOf("function ensureFlusher"));
  assert.ok(fn.length > 0, "noteSeatTelemetry present");
  assert.match(fn, /try\s*\{/, "noteSeatTelemetry wrapped in try");
  assert.match(fn, /catch/, "noteSeatTelemetry swallows errors (fail-open)");
  assert.doesNotMatch(fn, /\bawait\b/, "no await (no sync DB) in the tick-path function");

  // DB writes only ever target the two telemetry tables.
  const insertTargets = [...src.matchAll(/insert\s+into\s+([a-z_]+)/gi)].map((m) => m[1]);
  const deleteTargets = [...src.matchAll(/delete\s+from\s+([a-z_]+)/gi)].map((m) => m[1]);
  const allowed = new Set(["desk_seat_reads", "desk_chair_evals"]);
  for (const t of [...insertTargets, ...deleteTargets]) {
    assert.ok(allowed.has(t), `telemetry writer touched unexpected table: ${t}`);
  }
  assert.ok(insertTargets.length >= 2, "writes both telemetry tables");
});

test("telemetry.server.ts introduces no execution / live-money path", () => {
  const src = read("src/lib/desk/telemetry.server.ts");
  assert.doesNotMatch(src, /placeOrder|brokerage|wallet|liveTrade|noteCall|book-floor|booked-decision|selectiveBook|paperBook/i);
  const imports = runtimeRelImports(src);
  for (const imp of imports) {
    assert.ok(imp === "./telemetry.ts", `server writer must not runtime-import ${imp}`);
  }
});

test("the engine hook runs AFTER the decision is finalized and only reads it", () => {
  const src = read("src/lib/desk/server-engine.ts");
  const hook = src.indexOf("noteSeatTelemetry(");
  const replay = src.indexOf("noteReplay(");
  const finalChair = src.indexOf("const chair = applyEntryMode");
  assert.ok(hook > 0, "hook present");
  assert.ok(finalChair > 0 && hook > finalChair, "hook is placed after the final chair is computed");
  assert.ok(replay > 0 && hook > replay, "hook is placed after noteReplay");
  // It passes the already-computed reads; it must not reassign chair/votes.
  assert.match(src, /noteSeatTelemetry\(snap,\s*votes,\s*rawChair,\s*chair,\s*e\.learner\)/);
});

test("roster role-id sets are single-sourced and in sync (no drift)", () => {
  const seats = read("src/lib/desk/seats.ts");
  const chair = read("src/lib/desk/chair.ts");
  const crew = read("src/lib/desk/crew.ts");

  const arrIds = (name, src) => {
    const m = src.match(new RegExp(`${name}[^=]*=\\s*\\[([^\\]]*)\\]`));
    return m ? [...m[1].matchAll(/"([A-Z]+)"/g)].map((x) => x[1]).sort() : null;
  };
  // Telemetry's non-voter id set must match the literal the Chair actually uses,
  // so the two definitions can never silently drift apart.
  const telemetryNonVoters = arrIds("CHAIR_NON_VOTER_IDS", seats);
  const chairLit = chair.match(/CHAIR_NON_VOTERS = new Set<SeatId>\(\[([^\]]*)\]/);
  const chairNonVoters = chairLit ? [...chairLit[1].matchAll(/"([A-Z]+)"/g)].map((m) => m[1]).sort() : null;
  assert.deepEqual(telemetryNonVoters, ["ORBIT", "WARDEN", "WIRE"]);
  assert.deepEqual(telemetryNonVoters, chairNonVoters, "telemetry non-voters must match chair.ts");
  const ids = arrIds;

  const retiredIds = ids("RETIRED_SEAT_IDS", seats);
  // crew.ts RETIRED_SEATS keys must match RETIRED_SEAT_IDS exactly.
  const crewBlock = crew.slice(crew.indexOf("RETIRED_SEATS"), crew.indexOf("};", crew.indexOf("RETIRED_SEATS")));
  const crewKeys = [...crewBlock.matchAll(/\b([A-Z]+):\s*"/g)].map((m) => m[1]).sort();
  assert.deepEqual(retiredIds, crewKeys, "RETIRED_SEAT_IDS must match crew.ts RETIRED_SEATS keys");
});

test("migration 0054 creates both append-only telemetry tables with indexes", () => {
  const sql = read("migrations/0054_desk_seat_telemetry.sql");
  assert.match(sql, /create table if not exists desk_seat_reads/);
  assert.match(sql, /create table if not exists desk_chair_evals/);
  assert.match(sql, /suppression_reason\s+text/);
  assert.match(sql, /bar_sit_mass\s+double precision/);
  assert.match(sql, /gates\s+jsonb/);
  assert.match(sql, /create index if not exists desk_seat_reads_reason_idx/);
  assert.match(sql, /create index if not exists desk_chair_evals_decision_idx/);
});
