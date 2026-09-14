import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual engine persistence and settlement functions. Only I/O and
// the downstream grading consumer are substituted; no copied rollover loop.
const engine = readFileSync(new URL('../src/lib/desk/server-engine.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('server-engine.ts', engine, ts.ScriptTarget.Latest, true);
const functions = ['freshEng', 'loadState', 'persistState', 'previousDecision', 'settleIfNeeded', 'resolvePending', 'gradeSource', 'gradeableBook', 'noteGradeCand', 'markPending', 'windowKey'];
const constants = ['STATE_ID', 'PERSIST_EVERY_MS', 'DEFAULT_SERVER_SETTINGS', 'IDENTITY_FAULT_CAP', 'GRADED_KEY_CAP'];
const selected = ast.statements.filter((n) =>
  (ts.isFunctionDeclaration(n) && functions.includes(n.name?.text)) ||
  (ts.isVariableStatement(n) && n.declarationList.declarations.some((d) => constants.includes(d.name.getText(ast))))
).map((n) => n.getText(ast)).join('\n');
assert.equal(ast.statements.filter((n) => ts.isFunctionDeclaration(n) && functions.includes(n.name?.text)).length, functions.length);
assert.match(engine, /const prev = previousDecision\(e\)/);
assert.match(engine, /e\.lastChair = chair;\s*e\.recoveredWindow = null/);

const transpile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function pureModule(path, dependencies = {}) {
  const module = { exports: {} };
  vm.runInNewContext(transpile(readFileSync(new URL(path, import.meta.url), 'utf8')), {
    module, exports: module.exports,
    require: (name) => { assert.ok(name in dependencies, `unexpected import ${name}`); return dependencies[name]; },
    Date, Math, Number, Set, Map,
  });
  return module.exports;
}
const identity = pureModule('../src/lib/desk/window-identity.ts');
const reliability = pureModule('../src/lib/desk/reliability.ts');
const active = pureModule('../src/lib/desk/active-window.ts', { './window-identity.ts': identity });
const plain = (x) => JSON.parse(JSON.stringify(x));
const CLOSE = Date.parse('2026-09-14T12:45:00Z');
const TICKER = 'KXBTC15M-26SEP140845-45';
const NEXT = 'KXBTC15M-26SEP140900-00';
const fixture = (changes = {}) => ({
  ticker: TICKER, close_time: CLOSE,
  snap: { ticker: TICKER, close_time: CLOSE, as_of: CLOSE - 8000, spot: 77899, strike: 77950.84, secs_left: 8, chalk: false, leftover_cents: 1, health: { spot: 'LIVE', kalshi: 'LIVE' } },
  votes: [{ seat: 'DRIFT', lean: 'DOWN', confidence: 71 }],
  chair: { lean: 'WAIT', confidence: 78, score: -0.51, bar: 0.57, sit_mass: 0.73 },
  ...changes,
});

function harness(options = {}) {
  let durable = options.durable ?? null;
  const writes = [];
  const grades = [];
  const db = async (strings, ...params) => {
    if (strings.join('').includes('select state')) return durable ? [{ state: plain(durable) }] : [];
    const state = JSON.parse(params[1]);
    writes.push(state);
    await options.beforeWrite?.(state, writes.length);
    durable = state;
    return [];
  };
  const context = vm.createContext({
    ...reliability, ...active, Date, JSON, Promise,
    sql: async () => db,
    freshLearner: () => ({ window_memory: {}, settle_tape: [] }),
    freshWatchdog: () => ({}),
    mergeLearner: (v) => plain(v), sliceLearner: (v) => plain(v),
    sanitizeShadowFills: (v) => v ?? {}, sanitizeBookedDecisionState: (v) => v ?? {},
    sanitizeIdentityFaults: (v) => v ?? [],
    officialHit: (_e, snap, ticker, close) => {
      const result = identity.matchSettle(snap.official_settles ?? [], ticker, close);
      return result.ok ? result.settle : undefined;
    },
    captureGrade: (v) => grades.push(plain(v)),
  });
  const gradeStub = `async function applyGrade(e, snap, votes, chair, winner) {
    const key = jobKey(snap.ticker, snap.close_time);
    if (e.gradedKeys.includes(key)) return;
    e.gradedKeys.push(key);
    captureGrade({snap, votes, chair, winner});
    await persistState(e, true);
  }`;
  vm.runInContext(transpile(selected + '\n' + gradeStub), context);
  return { ...context, writes, grades, durable: () => plain(durable) };
}
function setCurrent(e, w) {
  e.prevSnap = w.snap; e.lastVotes = w.votes; e.lastChair = w.chair;
}
function nextSnap(settled = true) {
  return { ...fixture().snap, ticker: NEXT, close_time: CLOSE + 900000, as_of: CLOSE + 20000, secs_left: 880,
    official_settles: settled ? [{ ticker: TICKER, close_time: CLOSE, lean: 'DOWN' }] : [] };
}

test('restart straddling close retains the original votes and grades once', async () => {
  const h = harness(); const before = h.freshEng(); const observed = fixture();
  setCurrent(before, observed);
  await h.persistState(before, true);
  assert.equal(h.durable().pending.length, 0, 'the window had not become pending');
  assert.deepEqual(h.durable().active_window, observed);
  const boot = h.freshEng(); await h.loadState(boot);
  assert.equal(boot.prevSnap, null, 'checkpoint never becomes a live feed');
  const s = nextSnap();
  await h.settleIfNeeded(boot, s, [{ seat: 'DRIFT', lean: 'UP', confidence: 99 }], fixture().chair, h.previousDecision(boot));
  assert.equal(h.grades.length, 1);
  assert.deepEqual(h.grades[0].votes, observed.votes);
  assert.deepEqual(h.grades[0].chair, observed.chair);
  assert.equal(h.durable().active_window, null, 'a completed checkpoint cannot reappear');
  const again = h.freshEng(); await h.loadState(again);
  await h.settleIfNeeded(again, s, [], fixture().chair, h.previousDecision(again));
  assert.equal(h.grades.length, 1);
});

test('restart before close keeps the live-book candidate through a chalk tick', async () => {
  const h = harness(); const e = h.freshEng(); const observed = fixture();
  setCurrent(e, observed); await h.persistState(e, true);
  const boot = h.freshEng(); await h.loadState(boot);
  const chalk = { ...observed, snap: { ...observed.snap, chalk: true, as_of: CLOSE - 1000, secs_left: 1 } };
  await h.settleIfNeeded(boot, chalk.snap, [], chalk.chair, h.previousDecision(boot));
  assert.equal(h.grades.length, 0, 'no early settlement');
  h.noteGradeCand(boot, chalk.snap, [], chalk.chair); setCurrent(boot, chalk); boot.recoveredWindow = null;
  await h.persistState(boot, true);
  assert.deepEqual(h.durable().active_window, observed, 'the real candidate survives');
});

test('a resumed same-window observation supersedes the saved candidate', async () => {
  const h = harness(); const e = h.freshEng(); const observed = fixture();
  setCurrent(e, observed); await h.persistState(e, true);
  const boot = h.freshEng(); await h.loadState(boot); h.previousDecision(boot);
  const newer = fixture({ votes: [{ seat: 'DRIFT', lean: 'UP', confidence: 80 }] });
  newer.snap.as_of += 4000; newer.snap.secs_left -= 4;
  h.noteGradeCand(boot, newer.snap, newer.votes, newer.chair); setCurrent(boot, newer); boot.recoveredWindow = null;
  await h.settleIfNeeded(boot, nextSnap(), [], newer.chair, h.previousDecision(boot));
  assert.deepEqual(h.grades[0].votes, newer.votes);
});

test('delayed official result survives another restart as pending', async () => {
  const h = harness(); const e = h.freshEng(); setCurrent(e, fixture()); await h.persistState(e, true);
  const boot = h.freshEng(); await h.loadState(boot);
  await h.settleIfNeeded(boot, nextSnap(false), [], fixture().chair, h.previousDecision(boot));
  assert.equal(h.grades.length, 0);
  assert.equal(h.durable().pending.length, 1);
  assert.equal(h.durable().active_window, null);
  const again = h.freshEng(); await h.loadState(again);
  await h.settleIfNeeded(again, nextSnap(), [], fixture().chair, h.previousDecision(again));
  assert.equal(h.grades.length, 1);
  assert.equal(h.durable().pending.length, 0);
});

test('legacy state without a checkpoint does not invent a lost decision', async () => {
  const h = harness({ durable: { learner: {}, call_log: [], settings: {} } });
  const e = h.freshEng(); await h.loadState(e);
  assert.equal(e.recoveredWindow, null);
  await h.settleIfNeeded(e, nextSnap(), [], fixture().chair, h.previousDecision(e));
  assert.equal(h.grades.length, 0);
});

test('wrong identities, missing votes, nonfinite data and completed windows are refused', () => {
  const w = fixture();
  for (const bad of [null, {}, { ...w, close_time: CLOSE + 900000 }, { ...w, votes: [] }, { ...w, chair: {} }, { ...w, snap: { ...w.snap, spot: NaN } }, { ...w, snap: { ...w.snap, as_of: CLOSE + 120000 } }]) {
    assert.equal(active.restoreActiveWindow(bad), null);
  }
  assert.equal(active.restoreActiveWindow(w, [`${TICKER}:${CLOSE}`]), null);
  assert.equal(active.checkpointActiveWindow(w, [], [w]), null);
});

test('overlapping saves finish in capture order and cannot resurrect an old active window', async () => {
  let release; let started;
  const startedPromise = new Promise((r) => { started = r; });
  const block = new Promise((r) => { release = r; });
  const h = harness({ beforeWrite: async (_s, n) => { if (n === 1) { started(); await block; } } });
  const e = h.freshEng(); setCurrent(e, fixture());
  const first = h.persistState(e, true); await startedPromise;
  e.gradedKeys.push(`${TICKER}:${CLOSE}`);
  const second = h.persistState(e, true);
  await Promise.resolve(); assert.equal(h.writes.length, 1, 'second write waits for first');
  release(); await Promise.all([first, second]);
  assert.equal(h.writes.length, 2);
  assert.equal(h.durable().active_window, null);
  assert.ok(h.durable().graded_keys.includes(`${TICKER}:${CLOSE}`));
});

test('a failed save does not poison subsequent checkpoint writes', async () => {
  const h = harness({ beforeWrite: async (_s, n) => { if (n === 1) throw Error('database unavailable'); } });
  const e = h.freshEng(); setCurrent(e, fixture());
  await h.persistState(e, true); assert.match(e.lastError, /database unavailable/);
  await h.persistState(e, true); assert.deepEqual(h.durable().active_window, fixture());
});
