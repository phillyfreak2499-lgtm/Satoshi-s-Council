import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual engine persistence and settlement functions. Only I/O and
// the downstream grading consumer are substituted; no copied rollover loop.
const engine = readFileSync(new URL('../src/lib/desk/server-engine.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('server-engine.ts', engine, ts.ScriptTarget.Latest, true);
const functions = ['freshEng', 'loadState', 'persistState', 'previousDecision', 'settleIfNeeded', 'resolvePending', 'gradeSource', 'gradeableBook', 'noteGradeCand', 'markPending', 'windowKey', 'noteErr'];
const constants = ['STATE_ID', 'PERSIST_EVERY_MS', 'DEFAULT_SERVER_SETTINGS', 'IDENTITY_FAULT_CAP', 'GRADED_KEY_CAP'];
const selected = ast.statements.filter((n) =>
  (ts.isFunctionDeclaration(n) && functions.includes(n.name?.text)) ||
  (ts.isVariableStatement(n) && n.declarationList.declarations.some((d) => constants.includes(d.name.getText(ast))))
).map((n) => n.getText(ast)).join('\n');
assert.equal(ast.statements.filter((n) => ts.isFunctionDeclaration(n) && functions.includes(n.name?.text)).length, functions.length);
assert.match(engine, /const prev = previousDecision\(e\)/);
assert.match(engine, /e\.lastChair = chair;\s*e\.recoveredWindow = null/);

const transpile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
// Include the actual pure history restorer now used by loadState; never stub away its validation.
const riskAst = ts.createSourceFile('selective-entry.ts', readFileSync(new URL('../src/lib/desk/selective-entry.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const riskSource = riskAst.statements.filter(n =>
  (ts.isFunctionDeclaration(n) && n.name?.text === 'restoreRiskCalls') ||
  (ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(riskAst) === 'keyOf'))
).map(n => n.getText(riskAst).replace(/^export /, '')).join('\n');
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
const authority = pureModule('../src/lib/desk/council-authority.ts');
const math = pureModule('../src/lib/desk/math.ts');
const ownerRestore = pureModule('../src/lib/desk/owner-restore.ts', {
  './council-authority.ts': authority, './math.ts': math,
});
const statusTransitions = pureModule('../src/lib/desk/status-transitions.ts');
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

test('a new admission version starts a fresh window; same-version restart keeps its start and risk history', async () => {
  const h = harness(); const first = h.freshEng();
  first.selectiveStart = Date.parse('2026-09-14T12:00:00Z');
  first.riskCalls = [{ id: 'risk', ticker: TICKER, t: CLOSE - 600000, close_time: CLOSE, lean: 'UP', cents: 82, settle: 0, flipped: false }];
  await h.persistState(first, true);
  const same = harness({ durable: h.durable() }); const restored = same.freshEng();
  await same.loadState(restored);
  assert.equal(restored.selectiveStart, first.selectiveStart);
  assert.deepEqual(plain(restored.riskCalls), plain(first.riskCalls));
  const older = { ...h.durable(), selective_policy: 'ENTRY_SELECTIVE_V1' };
  const changed = harness({ durable: older }); const upgraded = changed.freshEng();
  const activation = upgraded.selectiveStart;
  await changed.loadState(upgraded);
  assert.equal(upgraded.selectiveStart, activation);
  assert.equal(activation % 900000, 0);
  assert.notEqual(activation, first.selectiveStart);
  assert.deepEqual(plain(upgraded.riskCalls), plain(first.riskCalls));
});

function harness(options = {}) {
  let durable = options.durable ?? null;
  const writes = [];
  const grades = [];
  const transitions = [];
  const events = [];
  const db = async (strings, ...params) => {
    if (strings.join('').includes('select state')) return durable ? [{ state: plain(durable) }] : [];
    const state = JSON.parse(params[1]);
    writes.push(state);
    events.push('save-start');
    await options.beforeWrite?.(state, writes.length);
    durable = state;
    events.push('save-ack');
    return [];
  };
  const context = vm.createContext({
    ...reliability, ...active, Date, JSON, Promise, structuredClone, SELECTIVE_ENTRY_ID: 'ENTRY_SELECTIVE_V2',
    recoveryPilotEnabled: () => false,
    applyOwnerRestore: ownerRestore.applyOwnerRestore,
    ownerRestoreMode: () => ownerRestore.ownerRestoreMode({ OWNER_RESTORE_E1_PAIR_V1: options.ownerRestoreMode }),
    skillStatusSnapshot: statusTransitions.skillStatusSnapshot,
    queueStatusTransitions: (before, after, writer) => {
      events.push('transitions');
      transitions.push(...plain(statusTransitions.diffStatuses(before, after, Date.now(), writer)));
    },
    recoveryPilotStartAtBoot: (now, enabled, previousEnabled, previousStart) =>
      enabled && previousEnabled && Number.isFinite(previousStart) && previousStart > 0
        ? previousStart
        : Math.ceil(now / 900000) * 900000,
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
  vm.runInContext(transpile(riskSource + '\n' + selected + '\n' + gradeStub), context);
  return { ...context, writes, grades, transitions, events, durable: () => plain(durable) };
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

function ownerRestoreLearner() {
  const card = { n: 100, ev_n: 100, wilson: 0.8, ev: 5, status: 'SHADOW' };
  return {
    skills: {
      'STRIKE.itm_time': { ...card, id: 'STRIKE.itm_time', owner: 'STRIKE' },
      'CHAIN.oi_with_price': { ...card, id: 'CHAIN.oi_with_price', owner: 'CHAIN' },
      'STREAK.continue_young': { ...card, id: 'STREAK.continue_young', owner: 'STREAK' },
    },
    seat_n: { STRIKE: 210, CHAIN: 210 },
    seat_calib_debt: { STRIKE: 210, CHAIN: 0 },
    window_memory: { original: 'retained' }, settle_tape: [{ original: true }],
  };
}

function ownerRestoreDurable(riskValid = true) {
  const risk = { id: 'real-existing-call', ticker: TICKER, t: CLOSE - 600000, close_time: CLOSE, lean: 'UP', cents: 82, settle: 0, flipped: false };
  const priorClose = CLOSE - 900000;
  const priorTicker = 'KXBTC15M-26SEP140830-30';
  return {
    learner: ownerRestoreLearner(), call_log: [risk], risk_calls: [risk], risk_history_valid: riskValid,
    baseline_calls: [{ ...risk, id: 'baseline', ticker: priorTicker, t: priorClose - 600000, close_time: priorClose }],
    selective_start: CLOSE - 9000000, selective_policy: 'ENTRY_SELECTIVE_V2',
    settings: { bar_override: 0.62, mutes: ['ODDS'], adaptive_bar: false, beast: false },
    last_call: { ticker: TICKER, close_time: CLOSE, lean: 'UP' },
    v2: { w: { STRIKE: 0.2 }, b: 0.1 }, last_ledger_ok_at: CLOSE - 30000,
    ledger_queue: [{ key: `${priorTicker}:${priorClose}`, row: { ticker: priorTicker, close_time: priorClose, values: ['original', 2] }, attempts: 3, firstAt: priorClose, nextAt: priorClose + 8000, lastErr: 'retry' }],
    shadow_fills: { original: 'shadow-fill' }, entry_state: { original: 'booked-state' },
    pending: [fixture({ ticker: priorTicker, close_time: priorClose })],
    identity_faults: [{ key: 'original-fault', at: priorClose }],
    graded_keys: [`older-window:${priorClose - 900000}`], active_window: fixture(),
    ledger_recon_baseline: priorClose - 900000, readiness_alerted: true,
  };
}

test('owner restore saves only after complete recovery and queues transitions only after durable acknowledgement', async () => {
  const original = ownerRestoreDurable();
  let release; let started;
  const startedPromise = new Promise((resolve) => { started = resolve; });
  const blocked = new Promise((resolve) => { release = resolve; });
  const h = harness({
    durable: original, ownerRestoreMode: 'STATUS_AND_STRIKE_CALIBRATION',
    beforeWrite: async (state) => {
      started();
      assert.equal(state.learner.skills['STRIKE.itm_time'].status, 'LIVE');
      assert.equal(state.learner.skills['CHAIN.oi_with_price'].status, 'LIVE');
      assert.equal(state.learner.skills['STREAK.continue_young'].status, 'SHADOW');
      assert.equal(state.learner.seat_calib_debt.STRIKE, 190);
      assert.equal(state.learner.owner_restore.state, 'APPLIED');
      // A boot-time save must retain everything restored after the learner.
      for (const key of ['call_log', 'risk_calls', 'risk_history_valid', 'baseline_calls', 'selective_start', 'selective_policy', 'settings', 'last_call', 'v2', 'last_ledger_ok_at', 'ledger_queue', 'shadow_fills', 'entry_state', 'pending', 'identity_faults', 'graded_keys', 'active_window', 'ledger_recon_baseline', 'readiness_alerted']) {
        assert.deepEqual(state[key], original[key], `automatic save preserves ${key}`);
      }
      assert.equal(h.transitions.length, 0, 'no authority transition is advertised before the save completes');
      await blocked;
    },
  });
  const e = h.freshEng();
  const loading = h.loadState(e);
  assert.equal(await Promise.race([startedPromise.then(() => true), loading.then(() => false)]), true,
    `restore must reach its durable write: ${JSON.stringify(e.ownerRestore)}`);
  assert.deepEqual(h.events, ['save-start']);
  assert.equal(e.ownerRestore, null, 'no successful boot receipt before acknowledgement');
  assert.equal(e.ownerRestorePending, true, 'health must hide the candidate marker while pending');
  assert.deepEqual(h.durable(), original, 'the durable learner is unchanged while acknowledgement is pending');
  release();
  await loading;
  assert.deepEqual(h.events, ['save-start', 'save-ack', 'transitions']);
  assert.equal(e.ownerRestorePending, false);
  assert.equal(e.ownerRestore.outcome, 'APPLIED');
  assert.equal(e.ownerRestore.changed, true);
  assert.equal(e.riskReady, true);
  assert.equal(h.writes.length, 1, 'loadState itself performs exactly one force-persist');
  assert.deepEqual(h.transitions.map(({ card, from, to, writer }) => ({ card, from, to, writer })), [
    { card: 'CHAIN.oi_with_price', from: 'SHADOW', to: 'LIVE', writer: 'ownerRestore' },
    { card: 'STRIKE.itm_time', from: 'SHADOW', to: 'LIVE', writer: 'ownerRestore' },
  ]);
  const reboot = harness({ durable: h.durable(), ownerRestoreMode: 'STATUS_AND_STRIKE_CALIBRATION' });
  const again = reboot.freshEng(); await reboot.loadState(again);
  assert.equal(again.ownerRestore.outcome, 'ALREADY_DONE');
  assert.equal(reboot.writes.length, 0);
  assert.equal(reboot.transitions.length, 0);
});

test('a successful owner restore preserves an invalid durable risk latch', async () => {
  const h = harness({ durable: ownerRestoreDurable(false), ownerRestoreMode: 'STATUS_AND_STRIKE_CALIBRATION' });
  const e = h.freshEng(); await h.loadState(e);
  assert.equal(e.ownerRestore.outcome, 'APPLIED');
  assert.equal(e.riskReady, false, 'authority restoration cannot release invalid restored risk history');
  assert.equal(h.durable().risk_history_valid, false);
  assert.deepEqual(h.durable().risk_calls, ownerRestoreDurable(false).risk_calls);
});

test('failed boot saves retain original authority and calibration and publish no restore or rollback transition', async () => {
  for (const mode of ['STATUS_AND_STRIKE_CALIBRATION', 'ROLLBACK']) {
    const original = ownerRestoreDurable();
    if (mode === 'ROLLBACK') {
      assert.equal(ownerRestore.applyOwnerRestore(original.learner, 'STATUS_AND_STRIKE_CALIBRATION', Date.now() - 1000).outcome, 'APPLIED');
      original.learner = plain(original.learner);
    }
    const h = harness({ durable: original, ownerRestoreMode: mode, beforeWrite: () => { throw Error('database unavailable'); } });
    const e = h.freshEng(); await h.loadState(e);
    assert.equal(h.writes.length, 1, `${mode} attempted automatic persistence`);
    assert.equal(e.ownerRestore.outcome, mode === 'ROLLBACK' ? 'ROLLBACK_REFUSED' : 'REFUSED');
    assert.equal(e.ownerRestore.changed, false);
    assert.deepEqual(plain(e.ownerRestore.status), []);
    assert.deepEqual(plain(e.ownerRestore.debt), []);
    assert.match(e.ownerRestore.reason, /save was not acknowledged/);
    assert.match(e.lastError, /database unavailable/);
    assert.deepEqual(plain(e.learner), original.learner, `${mode} keeps the original in-memory learner`);
    assert.deepEqual(h.durable(), original, `${mode} keeps the original durable learner`);
    assert.deepEqual(h.transitions, []);
    assert.deepEqual(h.events, ['save-start']);
    assert.equal(e.riskReady, true);
    assert.deepEqual(plain(e.pending), original.pending);
    assert.deepEqual(plain(e.riskCalls), original.risk_calls);
  }
});
