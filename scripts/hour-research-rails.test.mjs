/**
 * Hour Research v1 — safety rails.
 *
 * The hourly research is a separate, shadow-only experiment. These rails hold
 * the boundary in source: it cannot reach the 15-minute Chair, seats, learner
 * or paper book; it cannot write their tables; it cannot place an order; it
 * cannot promote itself; a missing feed becomes WAIT rather than a number; one
 * hour yields at most one shadow candidate; grading uses the provider's own
 * settlement identity; and the page says SHADOW in words.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const read = (rel) => readFileSync(join(process.cwd(), rel), "utf8");
const codeOf = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const READ_MODEL_PURE = "src/lib/desk/hour-research.ts";
const HOUR_RESEARCH_FILES = [
  "src/lib/desk/hour-research.ts",
  "src/lib/desk/hour-research-sql.ts",
  "src/lib/desk/hour-research.server.ts",
  "src/lib/desk/hour-research-brief.ts",
  "src/lib/desk/hour-research-brief.server.ts",
  "src/lib/desk/hour-research-public.ts",
];

// Rails 1-5: the boundary, in imports and in SQL.
test("hour research never imports the 15-minute Chair, the seats, the learner, the bots or the paper book", () => {
  for (const rel of HOUR_RESEARCH_FILES) {
    const src = codeOf(rel);
    for (const banned of [
      './chair"', "./chair.ts", "./chair'", "./chair-v2", "./chair-v3", "./chair-ablation",
      "./learner", "./bots", "./crew", "./seats", "./whisper",
      "./book-floor", "./booked-decision", "./paper-book", "./books.server",
      "./floor-policy", "./promotion-gates", "./skill-gate", "./record",
      "./telemetry", "runChair", "runBots", "SPEAK_CONF", "sit_mass", "sitMass",
      "frame.chair", "frame.votes", "snap.chair", ".chair?", ".votes",
    ]) {
      assert.doesNotMatch(src, new RegExp(esc(banned)), `${rel} must not reference ${banned}`);
    }
  }
});

test("hour research writes only its own two tables, and never desk_ledger, the hourly ledger or a telemetry table", () => {
  for (const rel of HOUR_RESEARCH_FILES) {
    const src = codeOf(rel);
    for (const banned of [
      "desk_ledger", "desk_ledger_research", "desk_samples", "desk_state", "desk_policy",
      "desk_replay", "desk_taker", "desk_hour_ledger", "desk_seat_telemetry", "desk_chair_telemetry",
      "recordSystemEvent", "recordExitArena", "promoteToLive", "persistState",
    ]) {
      assert.doesNotMatch(src, new RegExp(esc(banned)), `${rel} must not reference ${banned}`);
    }
  }
  const writes = HOUR_RESEARCH_FILES.flatMap((rel) => {
    const src = codeOf(rel);
    return [...(src.match(/insert into\s+(\w+)/g) ?? []), ...(src.match(/update\s+desk_\w+/g) ?? []), ...(src.match(/delete from\s+(\w+)/g) ?? [])];
  });
  const allowed = new Set([
    "insert into desk_hour_predictions",
    "insert into desk_hour_shadow",
    "update desk_hour_predictions",
    "update desk_hour_shadow",
  ]);
  for (const w of writes) assert.ok(allowed.has(w), `unexpected write: ${w}`);
  // The public read model is exactly that: it issues no write at all.
  for (const rel of ["src/lib/desk/hour-research-brief.server.ts", "src/lib/desk/hour-research-brief.ts", "src/lib/desk/hour-research-public.ts"]) {
    assert.doesNotMatch(codeOf(rel), /insert into|update desk|delete from/i, `${rel} is read-only`);
  }
});

test("hour research cannot place an order, sign a request, or reach an exchange's private surface", () => {
  for (const rel of HOUR_RESEARCH_FILES) {
    const src = codeOf(rel);
    for (const banned of [
      "portfolio/orders", "/orders", "createOrder", "placeOrder", "KALSHI_API_KEY", "KALSHI_PRIVATE_KEY",
      "private_key", "signRequest", "Authorization", "wallet", "withdraw", "deposit",
    ]) {
      assert.doesNotMatch(src, new RegExp(esc(banned), "i"), `${rel} must not reference ${banned}`);
    }
  }
});

test("hour research cannot promote itself: authority stays none and the hourly live rule is never written", () => {
  const pure = read("src/lib/desk/hour-research.ts");
  assert.match(pure, /export const HOUR_RESEARCH_AUTHORITY = "none" as const;/);
  for (const rel of HOUR_RESEARCH_FILES) {
    const src = codeOf(rel);
    assert.doesNotMatch(src, /HOUR_POSTURE\.live_rule\s*=/, `${rel} must not assign the hourly live rule`);
    assert.doesNotMatch(src, /HOUR_BOOK_AUTHORITY\s*=/, `${rel} must not reassign the hourly book's authority`);
    assert.doesNotMatch(src, /AUTO_SKILL_PROMOTION|promote|LIVE_SKILL/i, `${rel} must not reference promotion`);
  }
  // And the hourly posture in the repository is still WAIT with no live rule.
  const hour = read("src/lib/desk/hour.ts");
  assert.match(hour, /live_rule: false/);
  assert.match(hour, /lean: "WAIT" as const/);
});

test("the 15-minute floor never imports the hourly research, in either direction", () => {
  for (const rel of [
    "src/lib/desk/server-engine.ts", "src/lib/desk/chair.ts", "src/lib/desk/learner.ts",
    "src/lib/desk/bots.ts", "src/lib/desk/crew.ts", "src/lib/desk/seats.ts",
    "src/lib/desk/books.server.ts", "src/lib/desk/book-floor.ts", "src/lib/desk/floor-policy.ts",
    "src/lib/desk/promotion-gates.ts", "src/lib/desk/record.server.ts", "src/lib/desk/record.ts",
    "src/lib/desk/telemetry.ts", "src/lib/desk/telemetry.server.ts",
  ]) {
    assert.doesNotMatch(read(rel), /hour-research|desk_hour_predictions|desk_hour_shadow/, `${rel} must not import the hourly research`);
  }
});

// Rail 7: missing data becomes WAIT, never a number.
test("every gate in the read returns a structured WAIT, and a WAIT never carries a fill", () => {
  const pure = read("src/lib/desk/hour-research.ts");
  assert.match(pure, /export const HOUR_WAIT_REASONS = \[/);
  for (const reason of [
    "insufficient_edge", "uncertainty_high", "incomplete_ladder", "no_usable_ask",
    "liquidity_unassessable", "spread_too_wide", "ladder_inconsistent", "outside_checkpoint",
    "model_unavailable", "no_settlement_index",
  ]) {
    assert.match(pure, new RegExp(esc(`return wait("${reason}")`)), `the read must be able to return ${reason}`);
  }
  assert.match(
    pure,
    /return wait\(f\.brti == null \? "no_settlement_index" : "stale_index"\);/,
    "an unusable settlement input says whether it was absent or undateable",
  );
  assert.match(pure, /decision: "WAIT",\s*candidate: null,/, "a WAIT carries no candidate");
  assert.match(pure, /if \(ask == null \|\| !\(ask > 0\) \|\| !\(ask < 100\)\) return null;/, "a missing ask is null, never a midpoint");
  // The storage shape enforces the same thing in SQL.
  const sql = read("migrations/0055_desk_hour_research.sql");
  assert.match(sql, /\(decision = 'WAIT' and side is null and ask is null and wait_reason is not null\)/);
  assert.match(sql, /or \(decision in \('YES', 'NO'\) and side is not null and ask is not null\)/);
});

// Rails 8-9: one hour, one candidate.
test("one hour can yield at most one shadow candidate, enforced by the primary key", () => {
  const sql = read("migrations/0055_desk_hour_research.sql");
  assert.match(sql, /create table if not exists desk_hour_shadow \(\s*\n\s*close_time\s+timestamptz primary key,/, "close_time is the primary key: one row per hour");
  assert.match(sql, /primary key \(close_time, checkpoint, ticker\)/, "the per-rung table keys every rung of every checkpoint");
  const stmts = read("src/lib/desk/hour-research-sql.ts");
  assert.match(stmts, /on conflict \(close_time\) do update set/, "the hour's row is upserted, never duplicated");
  assert.match(stmts, /where desk_hour_shadow\.decision = 'WAIT'/, "a directional candidate locks the hour");
  assert.match(stmts, /and desk_hour_shadow\.graded_at is null/, "and a settled hour is never rewritten");
  assert.match(
    stmts,
    /and excluded\.checkpoint < desk_hour_shadow\.checkpoint/,
    "only a strictly later checkpoint may replace a WAIT, so a duplicate or out-of-order tick is a no-op",
  );
  assert.match(stmts, /on conflict \(close_time, checkpoint, ticker\) do nothing/, "a rerun of a checkpoint writes nothing");
});

test("every priced rung is stored, and the record says what it holds", () => {
  const server = codeOf("src/lib/desk/hour-research.server.ts");
  assert.match(server, /export function pricedRungs\(/, "a rung counts as priced when the feed quoted a side");
  assert.match(server, /r\.yes_bid != null \|\| r\.yes_ask != null \|\| r\.no_bid != null \|\| r\.no_ask != null/);
  assert.match(server, /const STORE_RUNGS_MAX = \d+;/, "the only bound is a safety bound");
  assert.match(server, /stored_rungs/, "and how many were actually written is recorded");
  assert.match(read("migrations/0055_desk_hour_research.sql"), /stored_rungs\s+integer/);
  // One statement for the whole ladder, so storing all of it is affordable.
  assert.match(server, /await db\.query\(hourPredictionsInsert\(scored\.length\), params\);/);
  assert.doesNotMatch(server, /for \(const r of read\.rungs\)[\s\S]{0,200}await db`/, "no per-rung round trip");
});

test("the whole ladder is scored for calibration but only the selected rung is marked as the hour's call", () => {
  const sql = read("migrations/0055_desk_hour_research.sql");
  assert.match(sql, /is_selected\s+boolean not null default false/);
  assert.doesNotMatch(sql, /references\s+desk_ledger/i);
  assert.doesNotMatch(sql, /references\s+desk_hour_ledger/i);
  assert.doesNotMatch(sql, /create (or replace )?view/i);
  assert.doesNotMatch(sql, /insert into|update |delete from/i, "the migration creates structure and writes no rows");
  assert.match(sql, /Authority: none/);
  const pure = codeOf("src/lib/desk/hour-research.ts");
  assert.match(pure, /const best = confident\.reduce\(/, "one candidate, the best after-fee edge");
  // The record counts hours, not rungs: a WAIT hour is a sit, never a loss.
  assert.match(pure, /waits: graded\.length - calls\.length,/);
});

// Rail 10: no future data in a frozen checkpoint.
test("a frozen checkpoint is decision-time only: the pure model has no clock, no network and no database", () => {
  const pure = codeOf("src/lib/desk/hour-research.ts");
  for (const banned of ["Date.now", "new Date(", "fetch(", "@/lib/db", "getSql", "Math.random", "setTimeout", "setInterval", "process.env"]) {
    assert.doesNotMatch(pure, new RegExp(esc(banned)), `hour-research.ts must not reference ${banned}`);
  }
  // Its only runtime import is the hourly contract module, which is itself pure.
  const imports = [...read("src/lib/desk/hour-research.ts").matchAll(/^import\s+(?!type\b)[\s\S]*?from\s+"([^"]+)";/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ["./hour.ts"], "one pure runtime dependency");
  // The observer freezes the snapshot before scoring and stores it verbatim.
  const server = codeOf("src/lib/desk/hour-research.server.ts");
  assert.match(server, /features,\s*ladderComplete: ladder\.complete,/, "the read is taken from the frozen snapshot");
  assert.match(server, /const featureJson = JSON\.stringify\(\{/, "the whole frozen snapshot is stored for reproduction");
  assert.match(read("src/lib/desk/hour-research-sql.ts"), /\$28::jsonb/, "and lands in the jsonb column");
  assert.match(read("src/lib/desk/hour-research-sql.ts"), /"as_of", "secs_left"/, "the decision-time clock is frozen on the row");
  // Grading appends outcomes; it never rewrites a frozen input.
  const setClauses = server.match(/update desk_hour_(predictions|shadow) set[\s\S]*?where/g) ?? [];
  assert.equal(setClauses.length, 2, "exactly two grading updates");
  for (const clause of setClauses) {
    assert.doesNotMatch(
      clause,
      /\b(p_model|p_market|p_baseline_dist|uncertainty|z|yes_ask|no_ask|spread_yes|spread_no|edge_yes|edge_no|edge_cents|ask|fee|side|as_of|secs_left|features|expected_settlement|sigma_horizon|index_value|spot|basis|sigma_hour|explanation|is_selected|checkpoint)\s*=(?!=)/,
      "grading never rewrites a frozen decision input",
    );
    assert.match(clause, /graded_at = now\(\)/);
  }
});

test("the read cannot be written outside a checkpoint, and the page preview is never stored", () => {
  const server = codeOf("src/lib/desk/hour-research.server.ts");
  assert.match(server, /if \(checkpoint == null\) return null;/, "no checkpoint, no row");
  assert.doesNotMatch(server, /requireCheckpoint/, "the observer never relaxes the checkpoint requirement");
  const brief = codeOf("src/lib/desk/hour-research-brief.server.ts");
  assert.match(brief, /requireCheckpoint: false/, "the page may preview between checkpoints");
  assert.doesNotMatch(brief, /insert into|update desk|delete from/i, "and that preview is never written anywhere");
});

// Rail 11: the provider's own settlement identity.
test("grading uses the provider's settled ladder and its official expiration value, never spot and never early", () => {
  const server = codeOf("src/lib/desk/hour-research.server.ts");
  assert.match(server, /import \{ hourEventTicker, isSettled, officialValue \} from "\.\/hour-closer";/, "the same settlement identity the hourly closer uses");
  assert.match(server, /if \(!ladder\.complete\) continue;/, "an incomplete ladder is never graded");
  assert.match(server, /if \(!settledRows\.length\) continue;/, "no settled rung, no grade");
  assert.match(server, /if \(official == null\) continue;/, "no official value, no grade");
  assert.match(server, /close_time <= now\(\)/, "an hour is never graded before it closes");
  assert.match(server, /if \(!Number\.isFinite\(closeMs\) \|\| closeMs > now\) continue;/);
  assert.match(server, /return official >= strike \? 1 : 0;/, "the settlement identity: at or above the strike");
  assert.match(read("src/lib/desk/hour-closer.ts"), /expiration_value/, "the official value is the provider's expiration value");
});

// Rail 12: strike ordering.
test("the probability curve respects strike ordering, and the ladder's own order is the model's", () => {
  const pure = codeOf("src/lib/desk/hour-research.ts");
  assert.match(pure, /const rungs = \[\.\.\.input\.rungs\]\.sort\(\(a, b\) => a\.strike - b\.strike\);/, "the read sorts by strike itself");
  assert.match(pure, /\.sort\(\(a, b\) => a\.strike - b\.strike\)/, "the inversion count sorts by strike too");
  assert.match(pure, /if \(cur - prev > toleranceCents \/ 100\) bad \+= 1;/, "P(S >= K) must not rise with K");
  assert.match(pure, /if \(!quality\.monotonic\) return wait\("ladder_inconsistent"\);/);
  assert.match(pure, /while \(i > 0 && v\[i - 1\]! < v\[i\]!\)/, "pool adjacent violators, for a non-increasing fit");
  assert.match(pure, /out\[position\] = expanded\[k\]!;/, "the fit maps back onto observed rungs only");
});

// Rail 13: the fee.
test("the hourly fee is the repository's existing paper convention", () => {
  const pure = read("src/lib/desk/hour-research.ts");
  assert.match(pure, /import \{ takerFee/, "the fee comes from the hourly contract module, not a second formula");
  assert.doesNotMatch(codeOf("src/lib/desk/hour-research.ts"), /0\.07 \*|Math\.ceil\(7/, "no second fee formula lives here");
  assert.match(read("src/lib/desk/hour.ts"), /return Math\.ceil\(\(0\.07 \* entry \* \(100 - entry\)\) \/ 100\);/);
  assert.match(read("src/lib/desk/clock.ts"), /export function takerFeeCents/);
  assert.match(read("src/lib/desk/hour-research.test.ts"), /assert\.equal\(takerFee\(c\), takerFeeCents\(c\)/, "parity is proven cent by cent in the tests");
});

// Rail 14: the UI says SHADOW.
test("the hour page labels every model number as a shadow read with no authority", () => {
  const ui = read("src/components/desk/HourResearch.tsx");
  assert.match(ui, /SHADOW READ — NOT A LIVE HOURLY RULE/);
  assert.match(ui, /SHADOW RESEARCH/);
  assert.match(ui, /Hourly research authority: \{data\.authority\}/);
  assert.match(ui, /Live hourly rule: \{data\.live_rule \? "yes" : "no"\}/);
  assert.doesNotMatch(ui, /\bbuy\b|\bsignal\b|lock this|\bETH\b/i);
  assert.doesNotMatch(ui, /Date\.now\(|toLocaleTimeString\(/, "SSR-stable");
  assert.doesNotMatch(ui, /\bUP\b|\bDOWN\b/, "a strike ladder, never UP/DOWN");
  assert.match(ui, /data\.storage_unavailable \?/, "unreadable storage is said aloud, not shown as a zero");
  const brief = read("src/lib/desk/hour-research-brief.ts");
  assert.match(brief, /export const HOUR_SHADOW_LABEL = "SHADOW READ — NOT A LIVE HOURLY RULE";/);
  assert.match(brief, /live_rule: HOUR_POSTURE\.live_rule/, "the page reads the repository's posture, it does not assert its own");
  // The explanation the reader sees is built from stored numbers, not written by a model.
  assert.doesNotMatch(codeOf("src/lib/desk/hour-research.ts"), /openai|anthropic|astra/i);
  assert.doesNotMatch(codeOf("src/lib/desk/hour-research.server.ts"), /openai|anthropic|astra/i);
  assert.match(ui, /no language model supplies the/);
});

test("the hour page still loads the existing hourly brief, and the research brief cannot fail it", () => {
  const route = read("src/routes/hour.tsx");
  assert.match(route, /publicHourBrief/);
  assert.match(route, /publicHourResearch/);
  assert.match(route, /publicHourResearch\(\)\.catch\(\(\) => null\)/, "a research failure never takes the page down");
  const pub = read("src/lib/desk/hour-research-public.ts");
  assert.match(pub, /createServerFn\(\{ method: "GET" \}\)/);
  assert.doesNotMatch(pub, /method:\s*"POST"/);
});

// Rail 15: the existing closer is untouched.
test("the hourly closer and the hourly book are untouched by this work", () => {
  const closer = codeOf("src/lib/desk/hour-closer.server.ts");
  assert.match(closer, /if \(st\.timer\) return;/, "idempotent boot");
  assert.match(closer, /on conflict \(ticker, close_time\) do nothing/, "a rerun on the same window writes nothing");
  assert.doesNotMatch(closer, /hour-research/, "the closer does not know the research exists");
  assert.doesNotMatch(codeOf("src/lib/desk/hour-closer.ts"), /hour-research/);
  assert.doesNotMatch(codeOf("src/lib/desk/hour.ts"), /hour-research/);
  assert.doesNotMatch(codeOf("src/lib/desk/hour.server.ts"), /hour-research/);
});

test("the research observer boots beside the others, fire-and-forget, and never from the engine tick", () => {
  const health = read("server/routes/healthz.get.ts");
  assert.match(health, /void import\("\.\.\/\.\.\/src\/lib\/desk\/hour-research\.server"\)\s*\.then\(\(m\) => m\.ensureHourResearchObserver\(\)\)\s*\.catch\(\(\) => \{\}\)/);
  assert.doesNotMatch(read("src/lib/desk/server-engine.ts"), /hour-research/);
  const server = codeOf("src/lib/desk/hour-research.server.ts");
  assert.match(server, /if \(st\.timer\) return;/, "idempotent boot");
  assert.match(server, /if \(st\.busy\) return null;/, "passes never overlap");
  assert.match(server, /catch \(err\)[\s\S]*?st\.error = /, "the observer swallows its own errors");
});

test("the model is versioned and every stored row carries the version and the build it came from", () => {
  const pure = read("src/lib/desk/hour-research.ts");
  assert.match(pure, /export const HOUR_RESEARCH_VERSION = "hour-research-v\d+\.\d+\.\d+";/);
  assert.match(pure, /export const HOUR_MODEL = Object\.freeze\(\{/, "the tunables are frozen with the version");
  const sql = read("migrations/0055_desk_hour_research.sql");
  for (const col of ["model_version", "build_sha"]) {
    assert.ok((sql.match(new RegExp(`${col}\\s+text not null default ''`, "g")) ?? []).length === 2, `both tables store ${col}`);
  }
  const server = codeOf("src/lib/desk/hour-research.server.ts");
  assert.match(server, /RENDER_GIT_COMMIT/, "the build sha comes from the deploy, not from a guess");
  // Bound as parameters now that the statements live in their own module.
  assert.match(server, /HOUR_RESEARCH_VERSION, sha,/, "every stored rung carries the version and the build");
  assert.match(server, /HOUR_RESEARCH_VERSION, HOUR_RESEARCH_AUTHORITY, sha,/, "and so does the shadow row");
  const stmts = read("src/lib/desk/hour-research-sql.ts");
  for (const col of ["model_version", "build_sha"]) {
    assert.ok(stmts.includes(`"${col}"`), `the shadow statement binds ${col}`);
  }
});

// ---------------------------------------------------------------------------
// The settlement input cannot silently become the venue perp index
// ---------------------------------------------------------------------------

test("the settlement value is the CF Benchmarks feed, and a venue index can never be promoted into it", () => {
  const pure = codeOf(READ_MODEL_PURE);
  // ONE source, and it is named for the feed it comes from.
  assert.match(pure, /export type HourExpectedSource = "cfbenchmarks-brti" \| "none";/);
  assert.match(pure, /if \(!brtiUsable\(f\)\) return \{ value: null, source: "none" \};/);
  assert.match(pure, /return \{ value: f\.brti, source: "cfbenchmarks-brti" \};/);
  // The whole body of expectedSettlement must not mention any other candidate:
  // no spot fallback, no venue index, no basis carry.
  // Comments are stripped from `pure`, so bound the slice by the NEXT export
  // rather than by a doc-comment marker that no longer exists.
  const from = pure.indexOf("export function expectedSettlement");
  const body = pure.slice(from, pure.indexOf("export function", from + 10));
  assert.ok(body.includes("cfbenchmarks-brti") && body.length < 500, "the slice really is just that function");
  for (const banned of ["venue_index", "f.spot", "venue_basis", "spot+basis"]) {
    assert.ok(!body.includes(banned), `expectedSettlement must not read ${banned}`);
  }
  // The venue fields exist, and are named for what they actually are.
  assert.match(pure, /venue_index: number \| null;/);
  assert.match(pure, /venue_basis_bps: number \| null;/);
  assert.match(read(READ_MODEL_PURE), /PERPETUAL index/, "the source of the venue value is stated where a reader will see it");
  // No field anywhere claims a bare "index" that could be mistaken for settlement.
  assert.doesNotMatch(pure, /^\s*index:\s/m, "there is no ambiguous `index` field left");
  assert.doesNotMatch(pure, /^\s*index_age_s:\s/m);
});

test("the observer takes the settlement value from the settlement feed, and only raw measurement from it", () => {
  const server = codeOf("src/lib/desk/hour-research.server.ts");
  assert.match(server, /const \{ labBrtiNow \} = await import\("\.\/lab\.server"\);/, "dynamic, like the frame read");
  assert.doesNotMatch(server, /^import .*lab\.server/m, "never a static import");
  // Only the raw measurement is taken — the value, BOTH its ages and its source.
  // Nothing else from the lab may cross this line.
  assert.match(server, /return \{ value: b\.value, age_s: b\.age_s, source_age_s: b\.source_age_s, source: b\.source \};/);
  for (const banned of ["labFairNow", "labFairState", "settleFair", "labSummary", "noteDeskState", "vel2Now", "whale2Now", "tape2Now"]) {
    assert.doesNotMatch(server, new RegExp(esc(banned)), `the hourly observer must not read ${banned}`);
  }
  // The accessor itself is raw measurement and writes nothing.
  const lab = read("src/lib/desk/lab.server.ts");
  const acc = lab.slice(lab.indexOf("export function labBrtiNow"), lab.indexOf("export function labSettleReceipt"));
  assert.match(acc, /source: "cfbenchmarks-brti"/);
  for (const banned of ["insert into", "update ", "delete from", "p_up", "fair", "chair", "seat"]) {
    assert.ok(!acc.toLowerCase().includes(banned.toLowerCase()), `labBrtiNow must not touch ${banned}`);
  }
  // The venue index is stored, and is structurally unable to become settlement.
  assert.match(server, /venue_index: venueIndex/);
  assert.match(server, /brti: brtiValue,/);
  assert.doesNotMatch(server, /brti: .*index_px/, "index_px can never be bound to the settlement field");
});

test("unknown freshness is never treated as fresh", () => {
  const pure = codeOf(READ_MODEL_PURE);
  assert.match(pure, /export function isFresh\(/);
  // Each of the five conditions, in source, so a future edit cannot drop one.
  assert.match(pure, /typeof value !== "number" \|\| !Number\.isFinite\(value\) \|\| value <= 0/);
  assert.match(pure, /typeof ageS !== "number" \|\| !Number\.isFinite\(ageS\)/);
  assert.match(pure, /if \(ageS < 0\) return false;/);
  assert.match(pure, /return ageS <= maxAgeS;/);
  // Freshness is only ever decided through that one predicate.
  assert.match(pure, /const brtiFresh = brtiUsable\(f\);/);
  assert.match(pure, /const spotFresh = isFresh\(f\.spot, f\.spot_age_s, HOUR_MODEL\.max_spot_age_s\);/);
  assert.doesNotMatch(pure, /age_s == null \|\|/, "a null age must never short-circuit to fresh");
  // And only the settlement input gates the model.
  assert.match(pure, /if \(!quality\.brti_fresh\) return wait\(/);
});

// ---------------------------------------------------------------------------
// The settlement input is held to the repository's own BRTI standard, on BOTH
// clocks
// ---------------------------------------------------------------------------

test("the hourly BRTI threshold is the repository's 15-second standard, and cannot drift from it", () => {
  const pure = codeOf(READ_MODEL_PURE);
  assert.match(pure, /export const HOUR_BRTI_FRESH_S = \d+;/, "one explicit hourly constant, not a scattered literal");
  const hourly = Number(/export const HOUR_BRTI_FRESH_S = (\d+);/.exec(pure)?.[1]);
  // The repository's existing standard, read from where it actually lives.
  const repoMs = Number(/const BRTI_FRESH_MS = ([\d_]+);/.exec(read("src/lib/desk/lab.server.ts"))?.[1]?.replace(/_/g, ""));
  assert.ok(Number.isFinite(hourly) && Number.isFinite(repoMs), "both constants are readable");
  assert.equal(repoMs, 15_000, "the repository standard is 15 seconds");
  assert.equal(
    hourly,
    repoMs / 1000,
    "the hourly research must not hold the settlement value to a looser clock than the rest of the desk",
  );
  // The tunables table points at that one constant rather than restating it.
  assert.match(pure, /max_brti_age_s: HOUR_BRTI_FRESH_S,/, "no duplicated, drift-prone number");
  assert.doesNotMatch(pure, /max_brti_age_s: \d+/, "and no literal left behind");
});

test("a settlement reading needs BOTH its clocks: an unknown vendor stamp never passes", () => {
  const pure = codeOf(READ_MODEL_PURE);
  // The snapshot carries both ages, so a frozen row can be re-judged later.
  assert.match(pure, /brti_age_s: number \| null;/);
  assert.match(pure, /brti_source_age_s: number \| null;/);
  // And the predicate checks both, against the one threshold.
  assert.match(pure, /export function brtiUsable\(/);
  assert.match(
    pure,
    /isFresh\(f\.brti, f\.brti_age_s, HOUR_BRTI_FRESH_S\) && isFresh\(f\.brti, f\.brti_source_age_s, HOUR_BRTI_FRESH_S\)/,
    "receipt age AND vendor age, both inside the same limit",
  );
  // No fallback of any kind may appear in the predicate's body.
  const from = pure.indexOf("export function brtiUsable");
  const body = pure.slice(from, pure.indexOf("export function", from + 10));
  assert.ok(body.length < 500, "the slice really is just that function");
  for (const banned of ["venue_index", "f.spot", "??", "||"]) {
    assert.ok(!body.includes(banned), `brtiUsable must not contain ${banned}`);
  }
  // The observer carries the vendor age all the way onto the frozen snapshot.
  const server = codeOf("src/lib/desk/hour-research.server.ts");
  assert.match(server, /brti_source_age_s: brtiValue != null \? numOrNull\(brti\?\.source_age_s\) : null,/);
  assert.match(server, /source_age_s: number \| null;/, "and the read's own shape admits a null stamp");
  // The lab accessor really does publish it, and honestly.
  const lab = read("src/lib/desk/lab.server.ts");
  const acc = lab.slice(lab.indexOf("export function labBrtiNow"), lab.indexOf("export function labSettleReceipt"));
  assert.match(acc, /source_age_s: srcAge != null && Number\.isFinite\(srcAge\) && srcAge >= 0 \? srcAge : null,/);
});

test("the stored distance baseline is a fresh-spot baseline or nothing, with no substitute", () => {
  const pure = codeOf(READ_MODEL_PURE);
  assert.match(pure, /export function distanceBaselineFor\(/);
  assert.match(
    pure,
    /if \(!isFresh\(f\.spot, f\.spot_age_s, HOUR_MODEL\.max_spot_age_s\)\) return null;/,
    "the same freshness contract the quality verdict already uses for spot",
  );
  const from = pure.indexOf("export function distanceBaselineFor");
  const body = pure.slice(from, pure.indexOf("export function", from + 10));
  assert.ok(body.length < 500, "the slice really is just that function");
  for (const banned of ["venue_index", "f.brti", "??", "last_spot"]) {
    assert.ok(!body.includes(banned), `the baseline must not fall back to ${banned}`);
  }
  // And the recorder stores it through that gate, never the raw helper.
  const server = codeOf("src/lib/desk/hour-research.server.ts");
  assert.match(server, /distanceBaselineFor\(features, r\.strike, secsLeft\),/);
  assert.doesNotMatch(server, /distanceBaselineP\(/, "the ungated helper is never called from the recorder");
});

test("an unknown spread cannot pass the liquidity gate, and no bid is ever invented", () => {
  const pure = codeOf(READ_MODEL_PURE);
  assert.match(pure, /if \(!finite\(bid\) \|\| !finite\(ask\)\) return null;/, "a one-sided rung has no spread");
  assert.match(pure, /return Number\.isFinite\(s\) \? Math\.max\(0, s\) : null;/);
  assert.match(pure, /return s != null && Number\.isFinite\(s\);/, "a candidate needs a readable spread");
  assert.match(pure, /if \(!assessable\.length\) return wait\("liquidity_unassessable"\);/);
  assert.doesNotMatch(pure, /spread == null \|\| spread <=/, "the old permissive test is gone");
  assert.doesNotMatch(pure, /spread_yes = .*mid|bid = .*mid/, "no bid is manufactured to create a spread");
});

test("a checkpoint is claimed at or after its target, never early, and never backfilled", () => {
  const pure = codeOf(READ_MODEL_PURE);
  assert.match(pure, /export const HOUR_CHECKPOINT_GRACE_S = \d+;/);
  assert.match(pure, /if \(secsLeft <= target && secsLeft >= target - HOUR_CHECKPOINT_GRACE_S\) return c;/, "one-sided window");
  assert.match(pure, /export function checkpointMissed\(/);
  assert.doesNotMatch(pure, /Math\.abs\(secsLeft - c \* 60\)/, "the symmetric band is gone");
  assert.doesNotMatch(pure, /HOUR_CHECKPOINT_BAND_S/);
  // The observer's cadence has to fit inside the grace, or a checkpoint could be
  // lost to nothing but timing.
  const server = read("src/lib/desk/hour-research.server.ts");
  const tick = Number(/const TICK_MS = ([\d_]+);/.exec(server)?.[1]?.replace(/_/g, ""));
  const grace = Number(/HOUR_CHECKPOINT_GRACE_S = (\d+);/.exec(read(READ_MODEL_PURE))?.[1]);
  assert.ok(Number.isFinite(tick) && Number.isFinite(grace), "both constants are readable");
  assert.ok(tick / 1000 < grace, `the ${tick / 1000}s tick must fit inside the ${grace}s grace`);
});

test("the public timeline reuses the storage checkpoint rule instead of embedding a second one", () => {
  const brief = codeOf("src/lib/desk/hour-research-brief.ts");
  // The authoritative helper is imported from the pure model and actually used.
  assert.match(brief, /^\s*checkpointFor,$/m, "the timeline imports the model's own checkpoint helper");
  assert.match(
    brief,
    /const claimable = secsLeft == null \? null : checkpointFor\(secsLeft\);/,
    "and asks it what the observer could capture on this clock",
  );
  assert.match(brief, /else if \(claimable === cp\) state = "now";/, "live means exactly that window");
  // The old symmetric display band, and any re-derivation of one, are gone.
  assert.doesNotMatch(brief, /Math\.abs\(minsLeft - cp\)/, "the symmetric ±band is gone");
  assert.doesNotMatch(brief, /Math\.abs\([^)]*checkpoint[^)]*\)/i, "and is not rebuilt under another name");
  assert.doesNotMatch(brief, /1\.25/, "no second tolerance literal survives");
  assert.doesNotMatch(brief, /HOUR_CHECKPOINT_GRACE_S\s*[/*+-]/, "the grace is not re-scaled into a private rule");
  assert.doesNotMatch(brief, /const minsLeft =/, "the minutes-based display arithmetic is gone");
  // "done" is decided by a stored row, not by the clock.
  assert.match(brief, /if \(row\) state = "done";/);
});

test("a later WAIT checkpoint replaces its model version too, while authority stays immutable", () => {
  const stmts = read("src/lib/desk/hour-research-sql.ts");
  assert.match(
    stmts,
    /\(c\) => c !== "close_time" && c !== "event_ticker" && c !== "authority",/,
    "only the conflict key, the hour's identity and the immutable authority are held back",
  );
  assert.doesNotMatch(
    stmts,
    /c !== "model_version"/,
    "model_version must move with the snapshot: a mid-hour deploy cannot leave a row naming the wrong model",
  );
  // The columns list still carries both, and both tables still store them.
  for (const col of ["model_version", "build_sha", "authority"]) {
    assert.ok(stmts.includes(`"${col}"`), `the shadow statement binds ${col}`);
  }
  // Outcome columns are still outside the replaced set entirely.
  const sql = read("migrations/0055_desk_hour_research.sql");
  for (const col of ["result", "official_value", "settle_cents", "ev_cents", "graded_at"]) {
    assert.ok(!read("src/lib/desk/hour-research-sql.ts").includes(`"${col}"`), `${col} is never upserted`);
    assert.ok(sql.includes(col), `${col} exists as an appended outcome column`);
  }
});

test("a graded WAIT is a completed hour, and windows always equals waits plus calls", () => {
  const pure = codeOf(READ_MODEL_PURE);
  assert.match(pure, /const graded = rows\.filter\(\(r\) => r\.graded_at != null\);/, "completion is graded_at, not result");
  assert.doesNotMatch(pure, /const graded = rows\.filter\(\(r\) => r\.result === "YES"/, "the old outcome-based filter is gone");
  assert.match(pure, /waits: graded\.length - calls\.length,/, "so windows === waits + calls by construction");
  assert.match(pure, /graded_at: string \| null;/, "the row type carries it");
  // The page's own tape counts completed hours the same way.
  assert.match(codeOf("src/lib/desk/hour-research-brief.ts"), /\.filter\(\(r\) => r\.graded_at != null\)/);
  assert.match(codeOf("src/lib/desk/hour-research-brief.server.ts"), /graded_at: r\.graded_at == null \? null :/);
});
