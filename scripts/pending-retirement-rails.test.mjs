import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const engine = readFileSync(new URL("../src/lib/desk/server-engine.ts", import.meta.url), "utf8");

const between = (text, start, end) => {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing start marker: ${start}`);
  assert.ok(to > from, `missing end marker: ${end}`);
  return text.slice(from, to);
};

test("identity contradictions are retired from pending without a grade", () => {
  const resolve = between(engine, "async function resolvePending", "function gradeableBook");
  assert.match(resolve, /officialHit\(e, snap, p\.ticker, p\.close_time\)/);
  assert.match(resolve, /const identityFault = e\.identityFaults\.some/);
  assert.match(resolve, /isInconsistent\(f\.fault\)/);
  assert.match(resolve, /retired \+= 1/);
  assert.match(resolve, /e\.pending = remaining/);
  assert.match(resolve, /if \(retired > 0\) await persistState\(e, true\)/);
  assert.ok(
    resolve.indexOf("continue;") < resolve.indexOf("applyGrade("),
    "an irreconcilable window must leave the loop before grading",
  );
});

test("a newly detected mismatch never enters the pending retry set", () => {
  const settle = between(engine, "async function settleIfNeeded", "async function liveSnap");
  const fault = settle.indexOf("const identityFault = e.identityFaults.some");
  const add = settle.indexOf("e.pending = addKeyed(");
  assert.ok(fault >= 0 && add > fault, "the identity guard must run before enqueueing");
  const guarded = settle.slice(fault, add);
  assert.match(guarded, /removeKeyed\(e\.pending, w\.ticker, w\.close_time\)/);
  assert.match(guarded, /await persistState\(e, true\)/);
  assert.match(guarded, /return;/);
  assert.doesNotMatch(guarded, /applyGrade\(/);
});
