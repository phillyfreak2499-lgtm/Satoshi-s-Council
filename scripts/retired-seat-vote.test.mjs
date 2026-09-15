import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { countChairQuorum } from "../src/lib/desk/council-authority.ts";

function productionRetirementFilter() {
  const crewSource = readFileSync(new URL("../src/lib/desk/crew.ts", import.meta.url), "utf8");
  const crewAst = ts.createSourceFile("crew.ts", crewSource, ts.ScriptTarget.Latest, true);
  const declaration = crewAst.statements.flatMap(s =>
    ts.isVariableStatement(s) ? [...s.declarationList.declarations] : [])
    .find(d => d.name.getText(crewAst) === "RETIRED_SEATS");
  assert.ok(declaration?.initializer, "production retirement policy must exist");
  const retired = vm.runInNewContext(`(${declaration.initializer.getText(crewAst)})`);

  const botsSource = readFileSync(new URL("../src/lib/desk/bots.ts", import.meta.url), "utf8");
  const botsAst = ts.createSourceFile("bots.ts", botsSource, ts.ScriptTarget.Latest, true);
  const fn = botsAst.statements.find(s =>
    ts.isFunctionDeclaration(s) && s.name?.text === "sitUnlessSure");
  assert.ok(fn, "production seat filter must exist");
  const code = ts.transpileModule(fn.getText(botsAst), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const apply = vm.runInNewContext(`${code}\nsitUnlessSure`, { RETIRED_SEATS: retired, SPEAK_CONF: 52 });
  const ctx = { learner: { knobs: {} }, snap: { as_of: 0 } };
  return { apply: (v) => apply(v, ctx), retired };
}

const read = (seat, lean = "WAIT") => ({ seat, lean, confidence: 55,
  reasoning: "paper read", skill_used: "SIT", skill_status: "SIT" });

test("a retired seat's natural WAIT is research, never Chair sit mass or quorum", () => {
  const { apply, retired } = productionRetirementFilter();
  assert.deepEqual(Object.keys(retired).sort(), ["CHEAP", "FADE", "ODDS"]);
  const votes = ["ODDS", "CHEAP", "FADE"].map(seat => apply(read(seat)));
  for (const v of votes) {
    assert.equal(v.lean, "WAIT");
    assert.equal(v.raw_lean, "WAIT");
    assert.equal(v.forced_sit, true);
    assert.match(v.reasoning, /retired from paper-call votes/);
  }
  const trueWait = apply(read("TAPE"));
  assert.equal(trueWait.forced_sit, undefined);
  assert.deepEqual(countChairQuorum([...votes, trueWait], new Set(), new Set()),
    { up: 0, down: 0, wait: 1 });
});

test("a directional retired read keeps its raw grading side; VEL and WARDEN keep WAIT work", () => {
  const { apply } = productionRetirementFilter();
  const odds = apply(read("ODDS", "UP"));
  assert.equal(odds.lean, "WAIT");
  assert.equal(odds.raw_lean, "UP");
  assert.equal(odds.forced_sit, true);
  const vel = apply(read("VEL"));
  const warden = apply(read("WARDEN"));
  assert.equal(vel.forced_sit, undefined);
  assert.equal(warden.forced_sit, undefined);
});
