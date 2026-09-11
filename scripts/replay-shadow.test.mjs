/**
 * The replay's column parity, and why it is worth a test of its own.
 *
 * Replay stores parallel arrays: t[i] is the instant, and every other column's
 * i-th entry belongs to it. A column that skips a push — because the lab was
 * dark, or a read was thin, or an early return jumped over it — does not throw
 * and does not look wrong. It shifts every later reading one instant earlier for
 * the rest of the window, and the scrubber then shows microstructure that was
 * measured AFTER the moment it is drawn against. That is lookahead rendered as a
 * chart, and it would be invisible.
 *
 * So this reads the source and requires that every shadow column is pushed
 * exactly once on the path that pushes `t`, unconditionally, with a null for the
 * missing case rather than a skip.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "src/lib/desk/replay.server.ts"), "utf8");

const SHADOW = ["imb", "micro", "ofi", "cancel", "tflow", "resid", "lead"];

test("every shadow column is declared, initialised, and pushed exactly once", () => {
  const sampler = src.slice(src.indexOf("function noteShadow"), src.indexOf("function leaderCode"));
  for (const col of SHADOW) {
    assert.match(src, new RegExp(`\\n  ${col}: \\(number \\| null\\)\\[\\];`), `${col} is not declared on ReplayCols`);
    assert.match(src, new RegExp(`\\n          ${col}: \\[\\],`), `${col} is not initialised with the series`);
    const pushes = [...sampler.matchAll(new RegExp(`c\\.${col}\\.push\\(`, "g"))].length;
    assert.equal(pushes, 1, `${col} is pushed ${pushes} times in noteShadow, must be exactly 1`);
  }
});

test("the shadow sampler cannot be skipped by a branch", () => {
  // One unconditional call, on the same path that pushes t. If it ever moves
  // inside an `if`, a dark lab produces short columns instead of null ones.
  const calls = [...src.matchAll(/noteShadow\(c, snap\.ticker\);/g)].length;
  assert.equal(calls, 1, "noteShadow must be called exactly once");
  const noteFn = src.slice(src.indexOf("export function noteReplay"), src.indexOf("function noteShadow"));
  const idx = noteFn.indexOf("noteShadow(c, snap.ticker);");
  assert.ok(idx > 0, "noteShadow is not called from noteReplay");
  // It sits after the per-seat loop, at the same brace depth as c.t.push — i.e.
  // nothing between the two can return early past it.
  const between = noteFn.slice(noteFn.indexOf("c.t.push("), idx);
  assert.ok(!/\breturn\b/.test(between), "a return sits between recording t and recording the shadow reads");
});

test("a missing read is stored as null, never as a zero", () => {
  const sampler = src.slice(src.indexOf("function noteShadow"), src.indexOf("const r2 ="));
  // Optional chaining everywhere, so a dark lab yields undefined, and the
  // rounders turn undefined into null rather than 0.
  for (const col of ["imb_l5", "micro_minus_mid", "ofi_norm_15s", "cancel_share", "trade_imb_15s"]) {
    assert.match(sampler, new RegExp(`t2\\?\\.${col}`), `${col} is read without optional chaining`);
  }
  assert.match(src, /n == null \|\| !Number\.isFinite\(n\) \? null : Math\.round/);
  assert.ok(!/\?\?\s*0/.test(sampler), "a missing shadow read is being defaulted to 0");
  // A thin VEL read is nothing, not a zero residual.
  assert.match(sampler, /v2\?\.h30\.ok \? r2\(v2\.h30\.residual\) : null/);
});

test("the client type marks the shadow columns optional", () => {
  // Windows recorded before 2026-09-11 have no shadow columns at all. A required
  // field would make every one of them fail to parse.
  const client = readFileSync(join(ROOT, "src/lib/desk/replay.ts"), "utf8");
  for (const col of SHADOW) {
    assert.match(client, new RegExp(`\\n  ${col}\\?: \\(number \\| null\\)\\[\\];`), `${col} must be optional on the client`);
  }
});

test("the replay records these reads and nothing reads them back into a decision", () => {
  assert.ok(!/decideChair|onLean|noteCall|learner/.test(src), "replay.server.ts reaches a decision path");
  // It imports the measurements one way only.
  assert.match(src, /import \{ tape2Now, vel2Now \} from "\.\/lab\.server";/);
  const lab = readFileSync(join(ROOT, "src/lib/desk/lab.server.ts"), "utf8");
  assert.ok(!/from "\.\/replay\.server"/.test(lab), "lab.server imports replay.server — that is a cycle");
});
