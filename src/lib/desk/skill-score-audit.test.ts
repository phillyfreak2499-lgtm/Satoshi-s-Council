import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { centsOf, takerFeeCents } from "./clock.ts";
import { directionalConf, wilsonLower } from "./math.ts";
import { beginSkillScoreAudit, finishSkillScoreAudit, SCORE_AUDIT_START, SCORE_AUDIT_SKILLS, withSkillAuditColumn } from "./skill-score-audit.ts";
import { withEntrySkillRosterColumn } from "./entry-skill-roster.ts";
import type { ChairResult, Learner, SkillCard, Snapshot, Vote } from "./types";

const root = new URL("../../../", import.meta.url);
function functions(path: string, names: string[]) {
  const source = readFileSync(new URL(path, root), "utf8");
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const found = ast.statements.filter(n => ts.isFunctionDeclaration(n) && n.name && names.includes(n.name.text));
  assert.equal(found.length, names.length);
  return found.map(n => n.getText(ast).replace(/^export\s+/, "")).join("\n");
}
const graderSource = functions("src/lib/desk/learner.ts", ["push20", "creditDirectional", "creditWait", "gradePaper", "waitWasGood", "gradeWindow", "updateStreak", "consumeLock"])
  + functions("src/lib/desk/skills.ts", ["refreshDerived"]);
const grade = vm.runInNewContext(ts.transpileModule(graderSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText.replaceAll("export ", "") + "\ngradeWindow", {
  centsOf, wilsonLower, updateFade: () => {}, tuneFromCard: () => {},
  phaseOfWindows: () => "EXPLOIT", rememberTape: (t: unknown) => t,
}) as (l: Learner, s: Snapshot, v: Vote[], c: ChairResult, outcome: "UP" | "DOWN") => { learner: Learner };

const snap = (extra: Partial<Snapshot> = {}) => ({
  as_of: SCORE_AUDIT_START + 800_000, close_time: SCORE_AUDIT_START + 900_000,
  ticker: "KXBTC15M-26SEP151200-00", phase: "FINAL", regime_key: "US_AM_FINAL",
  yes_ask: 82, yes_bid: 81, no_ask: 19, yes_mid: 81.5, fair_yes: 85,
  lab_fair_yes: 84, chalk: false, leftover_cents: -1,
  health: { spot: "LIVE", kalshi: "LIVE" }, ...extra,
} as Snapshot);
const card = (id: string) => ({ id, owner: id.split(".")[0], status: "SHADOW", n: 0, hits: 0,
  brier_n: 0, brier_sum: 0, brier: 0, ev_n: 0, ev_sum: 0, ev: 0, wait_good: 0, wait_miss: 0,
  last20: [], pocket: {}, streak_wrong: 0 } as unknown as SkillCard);
const learner = () => ({ skills: Object.fromEntries(SCORE_AUDIT_SKILLS.map(id => [id, card(id)])),
  lockdown: false, lockdown_until: 0, seat_n: {}, seat_hits: {}, pattern_book: {}, window_patterns: [],
  settle_tape: [], window_memory: { prior_settles: [], tapes: [], path_since_entry: [], streak_n: 0 },
  graded_windows: 0 } as unknown as Learner);
const vote = (extra: Partial<Vote> = {}) => ({ seat: "DRIFT", skill_used: SCORE_AUDIT_SKILLS[0], lean: "UP", confidence: 11, paper: [], ...extra } as Vote);
const chair = { lean: "WAIT", confidence: 70 } as ChairResult;
const options = { countable: true, source: "kalshi-result", build_sha: "test-build", graded_at: SCORE_AUDIT_START + 901_000 };

function run(votes: Vote[], s = snap(), outcome: "UP" | "DOWN" = "UP", countable = true) {
  const l = learner();
  const untouched = JSON.stringify(l);
  const before = beginSkillScoreAudit(l, s, votes, outcome, { ...options, countable });
  assert.equal(JSON.stringify(l), untouched, "capture cannot mutate the learner");
  if (countable) grade(l, s, votes, chair, outcome);
  const graded = JSON.stringify(l);
  const audit = finishSkillScoreAudit(before, l)!;
  assert.equal(JSON.stringify(l), graded, "comparison cannot mutate the learner");
  for (const skill of audit.skills) assert.equal(skill.check, "MATCH", skill.id);
  return { l, audit, before };
}

test("production grading explains a high error for a correct low-strength rule", () => {
  assert.equal(directionalConf(0.1, "FINAL", 1), 11);
  const { audit } = run([vote()]);
  const r = audit.skills[0]!.observations[0]!;
  assert.equal(r.hit, 1); assert.equal(r.legacy_input, 0.11);
  assert.ok(Math.abs(r.legacy_squared_error! - 0.7921) < 1e-12);
  assert.equal(r.confidence_kind, "signal_strength_not_calibrated_probability");
  assert.equal(r.hypothetical_net_cents, 16);
  assert.equal(audit.scope, "last_grading_input_not_booked_entry");
});

test("gagged grading uses raw confidence while other paper skills retain their own input", () => {
  const { audit } = run([vote({ lean: "WAIT", confidence: 70, forced_sit: true, raw_lean: "DOWN", raw_conf: 9,
    paper: [{ id: SCORE_AUDIT_SKILLS[1], lean: "UP", confidence: 30, status: "SHADOW" }] })], snap(), "DOWN");
  const drift = audit.skills[0]!.observations[0]!;
  const pulse = audit.skills[1]!.observations[0]!;
  assert.equal(drift.path, "gagged"); assert.equal(drift.confidence, 9); assert.equal(drift.hit, 1);
  assert.equal(pulse.path, "paper"); assert.equal(pulse.confidence, 30); assert.equal(pulse.hit, 0);
  assert.equal(drift.market_side_midpoint, 1 - 0.815);
  assert.equal(drift.hypothetical_net_cents, 79);
});

test("the selected skill is not credited again from its paper mirror", () => {
  const { audit } = run([vote({ paper: [{ id: SCORE_AUDIT_SKILLS[0], lean: "UP", confidence: 90, status: "SHADOW" }] })]);
  assert.equal(audit.skills[0]!.observations.length, 1);
  assert.equal(audit.skills[0]!.after!.n, 1);
});

test("quiet skills, unavailable feeds, chalk and excluded windows do not invent credits", () => {
  assert.equal(run([vote({ lean: "WAIT" })]).audit.skills[0]!.observations.length, 0);
  for (const s of [snap({ chalk: true }), snap({ leftover_cents: 13 }), snap({ health: { spot: "DOWN", kalshi: "DOWN" } as Snapshot["health"] })]) {
    const { audit } = run([vote()], s);
    assert.notEqual(audit.credit_skip_reason, null);
    assert.equal(audit.skills[0]!.after!.n, 0);
    assert.equal(audit.skills[0]!.observations[0]!.credited, false);
  }
  assert.equal(run([vote()], snap(), "UP", false).audit.skills[0]!.after!.n, 0);
});

test("missing real quotes stay missing while the existing fallback remains inspectable", () => {
  const { audit } = run([vote()], snap({ yes_ask: 0 }));
  const r = audit.skills[0]!.observations[0]!;
  assert.equal(r.ask_cents, null); assert.equal(r.fee_cents, null); assert.equal(r.hypothetical_net_cents, null);
  assert.equal(r.legacy_quote_fallback, true);
  assert.equal(r.legacy_net_cents, 100 - 81.5 - takerFeeCents(81.5));
});

test("no receipt is manufactured for historical input; post-close input is never an advance prediction", () => {
  assert.equal(beginSkillScoreAudit(learner(), snap({ as_of: SCORE_AUDIT_START - 1 }), [vote()], "UP", options), null);
  const { audit } = run([vote()], snap({ as_of: snap().close_time }));
  assert.equal(audit.input_before_close, false);
  assert.equal(audit.skills[0]!.observations[0]!.market_squared_error, null);
});

test("a changed counter fails the audit without repairing the record", () => {
  const { before, l } = run([vote()]);
  l.skills[SCORE_AUDIT_SKILLS[0]]!.brier_sum += 0.1;
  const value = l.skills[SCORE_AUDIT_SKILLS[0]]!.brier_sum;
  assert.equal(finishSkillScoreAudit(before, l)!.skills[0]!.check, "MISMATCH");
  assert.equal(l.skills[SCORE_AUDIT_SKILLS[0]]!.brier_sum, value);
});

test("missing counters or invalid confidence report MISSING, never a fabricated match", () => {
  const l = learner(); const before = beginSkillScoreAudit(l, snap(), [vote({ confidence: NaN })], "UP", options);
  grade(l, snap(), [vote({ confidence: NaN })], chair, "UP");
  assert.equal(finishSkillScoreAudit(before, l)!.skills[0]!.check, "MISSING");
  delete l.skills[SCORE_AUDIT_SKILLS[0]];
  assert.equal(finishSkillScoreAudit(before, l)!.skills[0]!.check, "MISSING");
});

test("receipt survives outbox serialization with exact clocks and inputs", () => {
  const { audit } = run([vote()]);
  const restored = JSON.parse(JSON.stringify(audit));
  assert.deepEqual(restored, audit);
  const old = Array(41).fill(null);
  assert.equal(withSkillAuditColumn(old).length, 42);
  assert.equal(old.length, 41);
  const current = [...old, JSON.stringify(audit)];
  assert.equal(withSkillAuditColumn(current), current);
});

test("the deployed ledger insert preserves old rows and stores new receipts atomically", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  try {
    const names = readdirSync(new URL("migrations/", root)).filter(n => n.endsWith(".sql")).sort();
    for (const name of names.filter(n => n !== "0034_desk_skill_score_audit.sql")) await db.exec(readFileSync(new URL(`migrations/${name}`, root), "utf8"));
    await db.exec("insert into desk_ledger (ticker, close_time, source, winner, chair_lean) values ('AUDIT-OLD', '2026-09-15T15:30:00Z', 'test', 'DOWN', 'WAIT')");
    const migration = readFileSync(new URL("migrations/0034_desk_skill_score_audit.sql", root), "utf8");
    await db.exec(migration); await db.exec(migration);
    const old = await db.query<{ skill_score_audit: unknown; winner: string }>("select skill_score_audit,winner from desk_ledger where ticker='AUDIT-OLD'");
    assert.equal(old.rows[0]!.skill_score_audit, null); assert.equal(old.rows[0]!.winner, "DOWN");
    const source = readFileSync(new URL("src/lib/desk/server-engine.ts", root), "utf8");
    const ast = ts.createSourceFile("server-engine.ts", source, ts.ScriptTarget.Latest, true);
    const statements = ast.statements.filter(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => ["LEDGER_COLUMNS", "LEDGER_INSERT"].includes(d.name.getText(ast))));
    const sql = vm.runInNewContext(statements.map(n => n.getText(ast)).join("\n") + "\nLEDGER_INSERT") as string;
    const { audit } = run([vote()]);
    const values = Array(41).fill(null);
    values[0] = snap().ticker; values[1] = new Date(snap().close_time).toISOString(); values[2] = "kalshi-result";
    values[3] = "UP"; values[4] = "WAIT"; values[12] = 0; values[13] = "{}";
    values[5] = 70; values[6] = 0; values[7] = 0.5; values[8] = 1;
    await db.query(sql, withEntrySkillRosterColumn([...values, JSON.stringify(audit)]));
    await db.query(sql, withEntrySkillRosterColumn([...values, null])); // retry never overwrites the first receipt
    const saved = await db.query<{ skill_score_audit: unknown; entry_skill_roster: unknown }>("select skill_score_audit,entry_skill_roster from desk_ledger where ticker=$1", [snap().ticker]);
    assert.deepEqual(saved.rows[0]!.skill_score_audit, audit);
    assert.equal(saved.rows[0]!.entry_skill_roster, null, "an earlier score receipt cannot invent an entry roster");
    values[0] = "AUDIT-RESTORED";
    await db.query(sql, withEntrySkillRosterColumn(withSkillAuditColumn(values)));
    const restored = await db.query<{ skill_score_audit: unknown }>("select skill_score_audit from desk_ledger where ticker='AUDIT-RESTORED'");
    assert.equal(restored.rows[0]!.skill_score_audit, null);
    const reader = readFileSync(new URL("src/lib/desk/skill-score-audit.server.ts", root), "utf8");
    const readerAst = ts.createSourceFile("reader.ts", reader, ts.ScriptTarget.Latest, true);
    const readerBody = readerAst.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getText(readerAst).replace(/^export\s+/, "")).join("\n");
    const read = vm.runInNewContext(ts.transpileModule(readerBody, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText + "\nskillScoreAuditSnapshot", {
      SCORE_AUDIT_START, SCORE_AUDIT_VERSION: audit.version,
      getSql: async () => async (parts: TemplateStringsArray, ...args: unknown[]) => {
        const query = parts.reduce((s, part, i) => s + (i ? `$${i}` : "") + part, "");
        return (await db.query(query, args)).rows;
      },
    }) as () => Promise<{ available: boolean; recorded_windows: number; receipts: unknown[] }>;
    const publicAudit = await read();
    assert.equal(publicAudit.available, true);
    assert.equal(publicAudit.recorded_windows, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(publicAudit.receipts)), [audit]);
  } finally { await db.close(); }
});
