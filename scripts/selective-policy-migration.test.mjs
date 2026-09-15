import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('selective activation preserves historical policy and is idempotent', async () => {
  const db = new PGlite();
  try {
    const initial = await readFile(new URL('../migrations/0025_desk_policy_lab.sql', import.meta.url), 'utf8');
    // The original policy schema and seed, before the unrelated observation tables.
    await db.exec(initial.slice(0, initial.indexOf('create table if not exists desk_policy_observations')));
    const migration = await readFile(new URL('../migrations/0032_desk_selective_policy.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    const first = (await db.query('select * from desk_floor_policy order by policy_id')).rows;
    assert.equal(first.length, 2);
    const old = first.find(r => r.policy_id === 'FLOOR_V1');
    const active = first.find(r => r.policy_id === 'FLOOR_SELECTIVE_V1');
    assert.equal(old.status, 'RETIRED');
    assert.equal(old.entry_policy, 'ENTRY_80_V1');
    assert.ok(old.left_champion_at);
    assert.equal(active.status, 'CHAMPION');
    assert.equal(active.entry_policy, 'ENTRY_SELECTIVE_V1');
    assert.equal(active.exit_policy, 'HOLD_V1');
    assert.equal(new Date(active.prospective_start_at).getTime() % 900000, 0);
    await db.exec(migration);
    assert.deepEqual((await db.query('select * from desk_floor_policy order by policy_id')).rows, first);
    const nextMigration = await readFile(new URL('../migrations/0033_desk_net_risk_policy.sql', import.meta.url), 'utf8');
    await db.exec(nextMigration);
    const next = (await db.query('select * from desk_floor_policy order by policy_id')).rows;
    assert.equal(next.length, 3);
    const v2 = next.find(r => r.policy_id === 'FLOOR_SELECTIVE_V2');
    assert.equal(v2.status, 'CHAMPION');
    assert.equal(v2.entry_policy, 'ENTRY_SELECTIVE_V2');
    assert.equal(v2.exit_policy, 'HOLD_V1');
    assert.equal(new Date(v2.prospective_start_at).getTime() % 900000, 0);
    assert.equal(next.filter(r => r.status === 'CHAMPION').length, 1);
    const v1 = next.find(r => r.policy_id === 'FLOOR_SELECTIVE_V1');
    assert.equal(v1.status, 'RETIRED');
    assert.equal(v1.entry_policy, active.entry_policy);
    assert.deepEqual(v1.prospective_start_at, active.prospective_start_at);
    await db.exec(nextMigration);
    assert.deepEqual((await db.query('select * from desk_floor_policy order by policy_id')).rows, next);
  } finally {
    await db.close();
  }
});
