import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('actual manual writer is atomic, idempotent, append-only, and touches no grading or booking tables', () => {
  const code = `
    import assert from 'node:assert/strict';
    import { PGlite } from '@electric-sql/pglite';
    import { appendClassifications } from './scripts/classify-venue-pause.ts';
    import { VENUE_PAUSE_REGISTRATION as r } from './src/lib/desk/venue-pause-registration.ts';
    import { readApprovedGaps } from './src/lib/desk/venue-pause.ts';
    const pg = new PGlite();
    await pg.exec('create table desk_ledger (close_time timestamptz)');
    const calls = []; let failAt = null; let database = r.database;
    const db = { query: async (sql, params) => {
      calls.push(sql);
      if (sql === 'select current_database() as name') return { rows: [{ name: database }] };
      if (sql.startsWith('insert into') && params[0] === failAt) throw Error('simulated storage failure');
      if (sql.includes('create table')) { await pg.exec(sql); return { rows: [] }; }
      return pg.query(sql, params);
    } };
    try {
      failAt = r.entries[4].close_ms;
      await assert.rejects(appendClassifications(db, 'approved-code-fixture', false), /storage failure/);
      assert.equal((await pg.query("select to_regclass('public.desk_window_classifications') as name")).rows[0].name, null, 'DDL and earlier inserts roll back together');
      failAt = null;
      await appendClassifications(db, 'approved-code-fixture', false);
      await appendClassifications(db, 'approved-code-fixture', false);
      const readDb = { query: async (sql, params) => (await pg.query(sql, params)).rows };
      const holes = r.entries.map(e => e.close_ms);
      assert.equal((await readApprovedGaps(readDb, holes)).classified.length, 0);
      assert.equal((await pg.query('select count(*)::int n from desk_window_classifications')).rows[0].n, 24);
      assert.equal((await pg.query("select count(*)::int n from desk_window_classifications where integrity_effect='EXCLUDE_FROM_MISSING_CONTRACT_COUNT'")).rows[0].n, 0);
      await appendClassifications(db, 'approved-integrity-fixture', true);
      assert.equal((await readApprovedGaps(readDb, holes)).classified.length, 24);
      assert.equal((await pg.query('select count(*)::int n from desk_window_classifications')).rows[0].n, 48, 'integrity approval appends; never rewrites classification');
      await assert.rejects(appendClassifications(db, 'different-approval', true), /conflict/);
      database = 'wrong_database';
      await assert.rejects(appendClassifications(db, 'approved-code-fixture', false), /wrong database/);
      database = r.database;
      await pg.query('insert into desk_ledger values ($1)', [r.entries[0].close_time]);
      await assert.rejects(appendClassifications(db, 'approved-code-fixture', false), /now has a ledger row/);
      for (const sql of calls.filter(s => /^(insert|update|delete)/i.test(s))) assert.ok(sql.startsWith('insert into public.desk_window_classifications '));
    } finally { await pg.close(); }
  `;
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', code], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
});
