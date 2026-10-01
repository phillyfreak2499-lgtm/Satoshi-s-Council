import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const plain = (x) => JSON.parse(JSON.stringify(x));
const cache = new Map();
function load(path) {
  path = resolve(root, path);
  if (cache.has(path)) return cache.get(path);
  const module = { exports: {} }; cache.set(path, module.exports);
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Date, Math, Number, Set, Map,
    require: (name) => load(resolve(dirname(path), name.endsWith('.ts') ? name : name + '.ts')) });
  return module.exports;
}
const { VENUE_PAUSE_REGISTRATION: registration } = load('src/lib/desk/venue-pause-registration.ts');
const { partitionApprovedGaps, readApprovedGaps } = load('src/lib/desk/venue-pause.ts');
const { bundleToSnapshot } = load('src/lib/desk/live.ts');
const holes = registration.entries.map((e) => e.close_ms);
const approved = () => registration.entries.map((e) => ({ close_ms: e.close_ms, record: e,
  manifest_sha256: registration.manifest_sha256, owner_approval_id: 'owner-reviewed-execution',
  integrity_effect: 'EXCLUDE_FROM_MISSING_CONTRACT_COUNT' }));

test('no executed approval leaves all 24 maintenance gaps unresolved', () => {
  const result = partitionApprovedGaps(holes, []);
  assert.equal(result.raw.length, 24); assert.equal(result.unresolved.length, 24);
  assert.equal(result.classified.length, 0);
  for (const row of approved()) {
    assert.equal(partitionApprovedGaps(holes, [{ ...row, integrity_effect: 'NONE' }]).classified.length, 0);
    assert.equal(partitionApprovedGaps(holes, [{ ...row, owner_approval_id: '' }]).classified.length, 0);
  }
});

test('approved exact evidence classifies 24; raw gaps and genuine losses remain visible', () => {
  const real = Date.parse('2026-09-14T12:45:00Z');
  const future = Date.parse('2026-10-08T07:15:00Z');
  const result = partitionApprovedGaps([...holes, real, future], approved());
  assert.equal(result.raw.length, 26); assert.equal(result.classified.length, 24);
  assert.deepEqual(plain(result.unresolved), [real, future]);
});

test('changed source, invented field, expanded interval or wrong manifest cannot affect integrity', () => {
  const row = approved()[0];
  for (const bad of [
    { ...row, record: { ...row.record, official_winner: 'UP' } },
    { ...row, record: { ...row.record, source_hashes: ['0'.repeat(64)] } },
    { ...row, manifest_sha256: '0'.repeat(64) },
    { ...row, close_ms: Date.parse('2026-10-08T07:15:00Z') },
  ]) assert.equal(partitionApprovedGaps([...holes, bad.close_ms], [bad]).classified.length, 0);
});

test('missing classification table is inactive and reads issue no writes', async () => {
  const calls = [];
  const db = { query: async (sql) => { calls.push(sql); return [{ present: false }]; } };
  assert.equal((await readApprovedGaps(db, holes)).unresolved.length, 24);
  assert.equal(calls.length, 1); assert.match(calls[0], /^select /);
});

test('classification reader failure propagates instead of claiming a clean ledger', async () => {
  await assert.rejects(readApprovedGaps({ query: async () => { throw Error('storage unavailable'); } }, holes), /storage unavailable/);
});

test('actual engine gap scan changes integrity only after execution and fails closed on read failure', async () => {
  const source = readFileSync(resolve(root, 'src/lib/desk/server-engine.ts'), 'utf8');
  const ast = ts.createSourceFile('server-engine.ts', source, ts.ScriptTarget.Latest, true);
  const selected = ast.statements.filter(n =>
    (ts.isFunctionDeclaration(n) && n.name?.text === 'scanLedgerGaps') ||
    (ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(ast) === 'GAP_SCAN_MS'))
  ).map(n => n.getText(ast)).join('\n');
  const { ledgerGaps } = load('src/lib/desk/reliability.ts');
  for (const mode of ['absent', 'approved', 'failure']) {
    const sql = Object.assign(async () => [{ ms: Date.parse('2026-10-01T07:00:00Z') }, { ms: Date.parse('2026-10-01T09:15:00Z') }], {
      query: async (text) => {
        assert.match(text, /^select /);
        if (mode === 'failure') throw Error('classification read failed');
        return text.includes('to_regclass') ? [{ present: mode === 'approved' }] : approved();
      },
    });
    const context = vm.createContext({ Date, Number, GAP_SCAN_MS: 300000, ledgerGaps, readApprovedGaps,
      sql: async () => sql, pushRecipientCounts: async () => ({ owner: 1, call: 1, settle: 1 }),
      pushDeliverySummary: async () => null, reconcile: async () => {}, noteErr: (e, _scope, msg) => e.errors.push(msg) });
    vm.runInContext(ts.transpileModule(selected, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
    const e = { lastGapScanAt: 0, ledgerGapCount: 0, errors: [] };
    await context.scanLedgerGaps(e);
    assert.equal(e.ledgerGapRawCount, 8);
    assert.equal(e.ledgerGapCount, mode === 'approved' ? 0 : 8);
    assert.equal(e.ledgerGapClassifiedCount, mode === 'approved' ? 8 : 0);
    if (mode === 'failure') assert.match(e.errors[0], /classification read failed/);
  }
});

test('classification schema is append-only, preserves nulls, and cannot seed on deploy', async () => {
  const pg = new PGlite();
  try {
    await pg.exec(readFileSync(resolve(root, 'docs/sql/manual/ledger_window_classifications.sql'), 'utf8'));
    const e = registration.entries[0];
    await pg.query("insert into desk_window_classifications (close_ms,manifest_sha256,classification,reason,record,owner_approval_id,integrity_effect) values ($1,$2,'NO_CONTRACT','VENUE_PAUSE',$3,'approval','NONE')", [e.close_ms, registration.manifest_sha256, JSON.stringify(e)]);
    await assert.rejects(pg.query('update desk_window_classifications set owner_approval_id=\'changed\''), /append-only/);
    await assert.rejects(pg.query('delete from desk_window_classifications'), /append-only/);
    const records = await pg.query('select record from desk_window_classifications');
    assert.equal(records.rows[0].record.official_winner, null);
    assert.equal(records.rows[0].record.final_grading_votes, null);
  } finally { await pg.close(); }
});

test('command default validates source hashes offline and executes no database connection', () => {
  const run = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/classify-venue-pause.ts'], { cwd: root, encoding: 'utf8', env: { ...process.env, DATABASE_URL: 'postgres://unreachable.invalid/db' } });
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.writes, 0); assert.equal(report.database_connected, false);
  assert.equal(report.intervals, 24); assert.equal(report.manifest_sha256, registration.manifest_sha256);
  for (const args of [['--apply'], ['--apply', '--owner-approval-id', 'approval', '--manifest-sha256', 'bad'], ['--apply-integrity-effect'], ['--dry-run', '--apply', '--owner-approval-id', 'approval', '--manifest-sha256', registration.manifest_sha256]]) {
    const rejected = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/classify-venue-pause.ts', ...args], { cwd: root, encoding: 'utf8' });
    assert.equal(rejected.status, 1); assert.doesNotMatch(rejected.stderr, /postgres:\/\//);
  }
});

const CLOSE = Date.parse('2026-10-01T07:00:00Z');
function bundle(as_of, market = {}) {
  return { as_of, spot: 78000, spot_backup: 78000, perp: 78000, index_px: 78000,
    spot_age_s: 0, fng_history: [], klines_1m: [], klines_5m: [], klines_15m: [], klines_1h: [],
    kalshi: { ticker: 'KXBTC15M-26OCT010300-00', close_time: CLOSE, strike: 78000,
      yes_bid: 49, yes_ask: 51, no_bid: 49, no_ask: 51, ok: true, quote_ts: as_of, receipt_ts: as_of, ...market } };
}
test('real bundle conversion preserves one expired identity across eight maintenance windows', () => {
  let previous = null;
  for (let i = 0; i <= 8; i++) {
    const snap = bundleToSnapshot(bundle(CLOSE + i * 900000 + 4000), {}, previous);
    assert.equal(snap.close_time, CLOSE); assert.equal(snap.ticker, 'KXBTC15M-26OCT010300-00');
    assert.equal(snap.obs.ticker, snap.ticker); assert.equal(snap.secs_left, 0);
    previous = snap;
  }
  const next = bundleToSnapshot(bundle(CLOSE + 7204000, { ticker: 'KXBTC15M-26OCT010515-15', close_time: CLOSE + 8100000 }), {}, previous);
  assert.equal(next.close_time, CLOSE + 8100000); assert.equal(next.ticker, 'KXBTC15M-26OCT010515-15');
});

test('missing feed preserves prior identity; missing identity stays explicitly unknown', () => {
  const prior = bundleToSnapshot(bundle(CLOSE - 4000), {}, null);
  const absent = { ...bundle(CLOSE + 3600000), kalshi: null };
  assert.equal(bundleToSnapshot(absent, {}, prior).close_time, CLOSE);
  const unknown = bundleToSnapshot(absent, {}, null);
  assert.equal(unknown.close_time, 0); assert.equal(unknown.ticker, '');
});
