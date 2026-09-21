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

const HOUR_RESEARCH_FILES = [
  "src/lib/desk/hour-research.ts",
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
    "insufficient_edge", "uncertainty_high", "incomplete_ladder",
    "no_usable_ask", "spread_too_wide", "ladder_inconsistent", "outside_checkpoint", "model_unavailable",
  ]) {
    assert.match(pure, new RegExp(esc(`return wait("${reason}")`)), `the read must be able to return ${reason}`);
  }
  assert.match(pure, /return wait\(f\.index == null \? "stale_index" : "stale_spot"\);/, "a stale feed names which feed it was");
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
  const server = codeOf("src/lib/desk/hour-research.server.ts");
  assert.match(server, /on conflict \(close_time\) do update set/, "the hour's row is upserted, never duplicated");
  assert.match(server, /where desk_hour_shadow\.decision = 'WAIT' and desk_hour_shadow\.graded_at is null/, "the first candidate locks the hour; a call row is never rewritten");
  assert.match(server, /on conflict \(close_time, checkpoint, ticker\) do nothing/, "a rerun of a checkpoint writes nothing");
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
  assert.match(server, /\$\{featureJson\}::jsonb/, "the whole frozen snapshot is stored for reproduction");
  assert.match(server, /as_of, secs_left/, "the decision-time clock is frozen on the row");
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
  assert.match(server, /\$\{HOUR_RESEARCH_VERSION\}/);
});
