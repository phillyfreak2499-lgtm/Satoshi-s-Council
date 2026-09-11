/**
 * Schema sanity: every migration actually applies, twice.
 *
 * Until now nothing executed the SQL in migrations/ before it reached a real
 * database. A typo, a column referenced before it exists, or a non-idempotent
 * statement was found by the deploy, on production, after merge.
 *
 * This applies the whole directory in order against PGLite (the same engine the
 * local fallback uses), then applies it AGAIN. The second pass is the point:
 * `scripts/migrate.mjs` records applied files, but a re-run after a restore, a
 * branch rollback, or a hand-run must not corrupt or fail, so every file has to
 * be written to tolerate being applied to a schema that already has its changes.
 *
 * It also proves the 2026-09-10 quarantine at the database level, which no pure
 * unit test can: a row inside the bad range is stamped excluded, a row outside it
 * is left valid, and the stamp touches no recorded value.
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = join(ROOT, "migrations");

/** The migration files, in the order the app applies them (non-recursive). */
async function files() {
  const names = (await readdir(MIGRATIONS, { withFileTypes: true }))
    .filter((e) => e.isFile() && e.name.endsWith(".sql"))
    .map((e) => e.name)
    .sort();
  assert.ok(names.length > 0, "no migrations found");
  return names;
}

async function freshDb() {
  const { PGlite } = await import("@electric-sql/pglite");
  return new PGlite();
}

async function applyAll(db, names) {
  for (const name of names) {
    const sql = await readFile(join(MIGRATIONS, name), "utf8");
    try {
      await db.exec(sql);
    } catch (err) {
      assert.fail(`${name} failed to apply: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

test("every migration applies to an empty database", async () => {
  const db = await freshDb();
  await applyAll(db, await files());
  const { rows } = await db.query(
    "select table_name from information_schema.tables where table_schema = 'public' order by 1",
  );
  const tables = rows.map((r) => r.table_name);
  // A spot check that the schema is actually there, not that the files merely parsed.
  for (const t of ["desk_ledger", "desk_samples", "desk_replay", "desk_state", "desk_absorption"]) {
    assert.ok(tables.includes(t), `${t} missing after migration; got ${tables.join(", ")}`);
  }
  await db.close();
});

test("every migration is idempotent: the whole directory applies twice", async () => {
  const db = await freshDb();
  const names = await files();
  await applyAll(db, names);
  await applyAll(db, names); // the pass that catches a missing "if not exists"
  await db.close();
});

test("research_quality defaults to valid so nothing is silently dropped", async () => {
  const db = await freshDb();
  await applyAll(db, await files());
  const { rows } = await db.query(
    `select column_name, column_default, is_nullable
       from information_schema.columns
      where table_name = 'desk_ledger' and column_name in ('research_quality','research_quality_rule')
      order by 1`,
  );
  assert.equal(rows.length, 2, "both quality columns must exist");
  const q = rows.find((r) => r.column_name === "research_quality");
  assert.equal(q.is_nullable, "NO", "a row with no verdict would be ambiguous");
  assert.match(String(q.column_default), /valid/, "existing and future rows count unless excluded");
  await db.close();
});

test("the quarantine stamps the bad range and only the bad range", async () => {
  const db = await freshDb();
  const names = await files();
  await applyAll(db, names);

  // Three windows: the legitimate 07:00, one inside the bad block, one after it.
  const insert = `insert into desk_ledger (ticker, close_time, winner, chair_lean, entry_cents, settle_cents, ev_cents)
                  values ($1, $2, 'UP', 'WAIT', $3, $4, $5)`;
  await db.query(insert, ["KXBTC15M-26SEP100300-00", "2026-09-10T07:00:00Z", 87, 100, 12]);
  await db.query(insert, ["KXBTC15M-26SEP100300-00", "2026-09-10T08:45:00Z", 50, 100, 44]);
  await db.query(insert, ["KXBTC15M-26SEP110800-00", "2026-09-11T12:00:00Z", 76, 100, 22]);

  // Re-apply the quality migration, as a restore or a hand-run would.
  await db.exec(await readFile(join(MIGRATIONS, "0024_desk_ledger_quality.sql"), "utf8"));

  const { rows } = await db.query(
    `select to_char(close_time at time zone 'UTC','YYYY-MM-DD HH24:MI') as close_utc,
            research_quality, research_quality_rule, entry_cents, settle_cents, ev_cents, winner
       from desk_ledger order by close_time`,
  );
  assert.equal(rows.length, 3);

  assert.equal(rows[0].close_utc, "2026-09-10 07:00");
  assert.equal(rows[0].research_quality, "valid", "the 07:00 settlement really was its own");

  assert.equal(rows[1].close_utc, "2026-09-10 08:45");
  assert.equal(rows[1].research_quality, "excluded");
  assert.equal(rows[1].research_quality_rule, "2026-09-10-ticker-reuse");

  assert.equal(rows[2].close_utc, "2026-09-11 12:00");
  assert.equal(rows[2].research_quality, "valid");

  // Nothing recorded was rewritten. The fault's evidence is the row itself.
  assert.equal(Number(rows[1].entry_cents), 50);
  assert.equal(Number(rows[1].settle_cents), 100);
  assert.equal(Number(rows[1].ev_cents), 44);
  assert.equal(rows[1].winner, "UP");

  // And the guard every research query carries actually excludes it.
  const { rows: counted } = await db.query(
    "select count(*)::int as n from desk_ledger where research_quality = 'valid'",
  );
  assert.equal(counted[0].n, 2, "the excluded window must not reach an aggregate");
  await db.close();
});

test("the research view exists, excludes, and has not drifted from the table", async () => {
  const db = await freshDb();
  await applyAll(db, await files());

  // `select *` freezes the column list when the view is created. A later
  // migration that adds a desk_ledger column would leave the view behind, and
  // research would silently stop seeing that column. Fail loudly instead.
  const cols = async (rel) =>
    (
      await db.query(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = $1 order by 1`,
        [rel],
      )
    ).rows.map((r) => r.column_name);
  const table = await cols("desk_ledger");
  const view = await cols("desk_ledger_research");
  assert.ok(table.length > 0, "desk_ledger must exist");
  assert.deepEqual(
    view,
    table,
    "desk_ledger_research has drifted from desk_ledger — a migration that adds a " +
      "ledger column must drop and recreate the view too",
  );

  // And it must actually exclude.
  const insert = `insert into desk_ledger (ticker, close_time, winner, chair_lean)
                  values ($1, $2, 'UP', 'WAIT')`;
  await db.query(insert, ["KXBTC15M-26SEP100300-00", "2026-09-10T08:30:00Z"]);
  await db.query(insert, ["KXBTC15M-26SEP110800-00", "2026-09-11T12:00:00Z"]);
  await db.exec(await readFile(join(MIGRATIONS, "0024_desk_ledger_quality.sql"), "utf8"));

  const all = (await db.query("select count(*)::int as n from desk_ledger")).rows[0].n;
  const research = (await db.query("select count(*)::int as n from desk_ledger_research")).rows[0].n;
  assert.equal(all, 2, "both rows remain in the table, for forensics");
  assert.equal(research, 1, "only the valid row is visible to research");
  await db.close();
});

test("the two migrations spell the evidence predicate identically", () => {
  // 0025 repeats 0024's predicate instead of layering on its view, so that each
  // migration is independently re-runnable. The cost is a second spelling, and the
  // risk is drift: the Lab counting a different set of windows than the rest of
  // research. Both must match VALID_ONLY_SQL in research-quality.ts exactly.
  const PREDICATE = "research_quality = 'valid'";
  const q = readFileSync(join(MIGRATIONS, "0024_desk_ledger_quality.sql"), "utf8");
  const lab = readFileSync(join(MIGRATIONS, "0025_desk_policy_lab.sql"), "utf8");
  const registry = readFileSync(join(ROOT, "src/lib/desk/research-quality.ts"), "utf8");
  assert.ok(q.includes(PREDICATE), "0024 must use the predicate");
  assert.ok(lab.includes(PREDICATE), "0025 must use the identical predicate");
  assert.ok(
    registry.includes(`VALID_ONLY_SQL = "${PREDICATE}"`),
    "the registry must declare the same predicate the migrations apply",
  );
  // And 0025 must NOT depend on 0024's view, or 0024 stops being re-runnable.
  assert.doesNotMatch(lab, /join\s+desk_ledger_research/, "0025 must stand alone");
});

test("the Lab seeds FLOOR_V1 as the only Champion and starts every candidate at zero", async () => {
  const db = await freshDb();
  await applyAll(db, await files());

  const champs = await db.query(
    `select policy_id, version, signal_policy, entry_policy, exit_policy, risk_policy, status
       from desk_floor_policy where status = 'CHAMPION'`,
  );
  assert.equal(champs.rows.length, 1, "exactly one Champion");
  const c = champs.rows[0];
  // The unchanged desk, named: Chair + 80c floor + hold to settlement.
  assert.equal(c.policy_id, "FLOOR_V1");
  assert.equal(c.signal_policy, "CHAIR_V1");
  assert.equal(c.entry_policy, "ENTRY_80_V1");
  assert.equal(c.exit_policy, "HOLD_V1");
  assert.equal(c.risk_policy, "RISK_NONE_V1");

  // No observation exists yet: every candidate's prospective N starts at zero, and
  // no historical window has been backfilled into it.
  const obs = await db.query("select count(*)::int as n from desk_policy_observations");
  assert.equal(obs.rows[0].n, 0, "prospective N must start at zero for every candidate");
  await db.close();
});

test("a second Champion is refused by the database", async () => {
  const db = await freshDb();
  await applyAll(db, await files());
  // Two live Champions is not a state the desk can answer from, so it must be
  // impossible rather than resolved by whichever row is read first.
  await assert.rejects(
    db.query(
      `insert into desk_floor_policy
         (policy_id, version, signal_policy, entry_policy, exit_policy, risk_policy, status)
       values ('FLOOR_V2', 2, 'CHAIR_V1', 'ENTRY_80_V1', 'PROVE180_V1', 'RISK_NONE_V1', 'CHAMPION')`,
    ),
  );
  // A shadow alongside the Champion is fine.
  await db.query(
    `insert into desk_floor_policy
       (policy_id, version, signal_policy, entry_policy, exit_policy, risk_policy, status)
     values ('FLOOR_V2', 2, 'CHAIR_V1', 'ENTRY_80_V1', 'PROVE180_V1', 'RISK_NONE_V1', 'SHADOW')`,
  );
  const n = await db.query("select count(*)::int as n from desk_floor_policy");
  assert.equal(n.rows[0].n, 2);
  await db.close();
});

test("an observation is written once per candidate per window and never overwritten", async () => {
  const db = await freshDb();
  await applyAll(db, await files());
  await db.query(
    `insert into desk_policy_fills
       (fill_key, ticker, close_time, entry_side, entry_t, entry_cents, entry_fee_cents,
        signal_policy, entry_policy, risk_policy)
     values ('F1','KXBTC15M-26SEP110900-00','2026-09-11T13:00:00Z','UP','2026-09-11T12:50:00Z',80,2,
             'CHAIR_V1','ENTRY_80_V1','RISK_NONE_V1')`,
  );
  const ins = `insert into desk_policy_observations
      (fill_key, ticker, close_time, candidate_id, candidate_kind, candidate_version,
       signal_policy, entry_policy, exit_policy, risk_policy,
       entry_side, entry_t, entry_cents, entry_fee_cents, exit_reason, net_cents)
    values ('F1', 'KXBTC15M-26SEP110900-00', '2026-09-11T13:00:00Z', $1, 'exit', 1,
            'CHAIR_V1','ENTRY_80_V1','HOLD_V1','RISK_NONE_V1',
            'UP', '2026-09-11T12:50:00Z', 80, 2, $2, $3)
    on conflict (candidate_id, ticker, close_time) do nothing`;
  await db.query(ins, ["HOLD_V1", "SETTLEMENT", 18]);
  // A restart mid-settle replays the write. It must not double-count or revise.
  await db.query(ins, ["HOLD_V1", "DEADLINE", -99]);
  const rows = await db.query(
    "select exit_reason, net_cents from desk_policy_observations where candidate_id = 'HOLD_V1'",
  );
  assert.equal(rows.rows.length, 1, "one observation per candidate per window");
  assert.equal(rows.rows[0].exit_reason, "SETTLEMENT", "the recorded result is not revised");
  assert.equal(Number(rows.rows[0].net_cents), 18);

  // A different candidate on the same window is a separate observation.
  await db.query(ins, ["PROVE180_V1", "DEADLINE", -9]);
  const all = await db.query("select count(*)::int as n from desk_policy_observations");
  assert.equal(all.rows[0].n, 2);
  await db.close();
});

test("the Lab research view excludes quarantined windows and DATA_INVALID rows", async () => {
  const db = await freshDb();
  await applyAll(db, await files());

  const led = `insert into desk_ledger (ticker, close_time, winner, chair_lean) values ($1, $2, 'UP', 'WAIT')`;
  const mkFill = (tk, close) =>
    db.query(
      `insert into desk_policy_fills
         (fill_key, ticker, close_time, entry_side, entry_t, entry_cents, entry_fee_cents,
          signal_policy, entry_policy, risk_policy)
       values ($1, $1, $2, 'UP', $2, 80, 2, 'CHAIR_V1','ENTRY_80_V1','RISK_NONE_V1')`,
      [tk, close],
    );
  const obs = `insert into desk_policy_observations
      (fill_key, ticker, close_time, candidate_id, candidate_kind, candidate_version,
       signal_policy, entry_policy, exit_policy, risk_policy,
       entry_side, entry_t, entry_cents, entry_fee_cents, exit_reason, net_cents, data_invalid)
    values ($1, $1, $2, 'HOLD_V1', 'exit', 1,
            'CHAIR_V1','ENTRY_80_V1','HOLD_V1','RISK_NONE_V1',
            'UP', $2, 80, 2, $3, $4, $5)`;

  // A good window, a quarantined window, and a good window whose book was unusable.
  await db.query(led, ["GOOD-1", "2026-09-11T13:00:00Z"]);
  await mkFill("GOOD-1", "2026-09-11T13:00:00Z");
  await db.query(obs, ["GOOD-1", "2026-09-11T13:00:00Z", "SETTLEMENT", 18, false]);
  await db.query(led, ["BAD-1", "2026-09-10T08:30:00Z"]);
  await mkFill("BAD-1", "2026-09-10T08:30:00Z");
  await db.query(obs, ["BAD-1", "2026-09-10T08:30:00Z", "SETTLEMENT", 18, false]);
  await db.query(led, ["GOOD-2", "2026-09-11T13:15:00Z"]);
  await mkFill("GOOD-2", "2026-09-11T13:15:00Z");
  await db.query(obs, ["GOOD-2", "2026-09-11T13:15:00Z", "DATA_INVALID", null, true]);
  // Re-apply the quality stamp, as the real deploy does.
  await db.exec(await readFile(join(MIGRATIONS, "0024_desk_ledger_quality.sql"), "utf8"));

  const all = await db.query("select count(*)::int as n from desk_policy_observations");
  const research = await db.query("select count(*)::int as n from desk_policy_observations_research");
  assert.equal(all.rows[0].n, 3, "all three rows remain readable for forensics");
  assert.equal(research.rows[0].n, 1, "only the good, priceable window counts");
  const kept = await db.query("select ticker from desk_policy_observations_research");
  assert.equal(kept.rows[0].ticker, "GOOD-1");
  await db.close();
});

test("all candidates reference ONE source fill, and a dangling reference is refused", async () => {
  const db = await freshDb();
  await applyAll(db, await files());

  const TK = "KXBTC15M-26SEP110900-00";
  const CLOSE = "2026-09-11T13:00:00Z";
  const KEY = `${TK}|1789131600000|1789131000000`;

  await db.query(
    `insert into desk_policy_fills
       (fill_key, ticker, close_time, entry_side, entry_t, entry_cents, entry_fee_cents,
        signal_policy, entry_policy, risk_policy)
     values ($1, $2, $3, 'UP', '2026-09-11T12:50:00Z', 80, 2, 'CHAIR_V1','ENTRY_80_V1','RISK_NONE_V1')`,
    [KEY, TK, CLOSE],
  );

  const obs = (cand, reason, net) =>
    db.query(
      `insert into desk_policy_observations
         (fill_key, ticker, close_time, candidate_id, candidate_kind, candidate_version,
          signal_policy, entry_policy, exit_policy, risk_policy,
          entry_side, entry_t, entry_cents, entry_fee_cents, exit_reason, net_cents)
       values ($1,$2,$3,$4,'exit',1,'CHAIR_V1','ENTRY_80_V1',$4,'RISK_NONE_V1',
               'UP','2026-09-11T12:50:00Z',80,2,$5,$6)`,
      [KEY, TK, CLOSE, cand, reason, net],
    );
  await obs("HOLD_V1", "SETTLEMENT", -82);
  await obs("PROVE120_V1", "DEADLINE", -6);
  await obs("PROVE180_V1", "DEADLINE", -11);
  await obs("PROVE240_V1", "DEADLINE", -25);
  await obs("TAKE90_V1", "SETTLEMENT", -82);

  // Exactly five, sharing exactly one source fill. Same-entry parity is a property
  // of the schema here, not a coincidence between five copied tuples.
  const agg = await db.query(
    `select count(*)::int as n, count(distinct fill_key)::int as fills
       from desk_policy_observations where ticker = $1 and close_time = $2`,
    [TK, CLOSE],
  );
  assert.equal(agg.rows[0].n, 5, "five candidates");
  assert.equal(agg.rows[0].fills, 1, "one source fill");

  // And they agree on everything they are not allowed to choose.
  const parity = await db.query(
    `select count(distinct entry_side)::int  as sides,
            count(distinct entry_t)::int     as times,
            count(distinct entry_cents)::int as prices,
            count(distinct entry_fee_cents)::int as fees,
            count(distinct signal_policy)::int   as signals,
            count(distinct entry_policy)::int    as entries,
            count(distinct exit_policy)::int     as exits
       from desk_policy_observations where fill_key = $1`,
    [KEY],
  );
  const p = parity.rows[0];
  for (const k of ["sides", "times", "prices", "fees", "signals", "entries"]) {
    assert.equal(p[k], 1, `candidates must not differ on ${k}`);
  }
  assert.equal(p.exits, 5, "and must each carry their own exit policy");

  // An observation cannot reference a fill that was never recorded.
  await assert.rejects(
    obs.call(null, "GHOST_V1", "SETTLEMENT", 0) && db.query(
      `insert into desk_policy_observations
         (fill_key, ticker, close_time, candidate_id, candidate_kind, candidate_version,
          signal_policy, entry_policy, exit_policy, risk_policy,
          entry_side, entry_t, entry_cents, entry_fee_cents, exit_reason)
       values ('NO-SUCH-FILL',$1,$2,'ORPHAN_V1','exit',1,'CHAIR_V1','ENTRY_80_V1','ORPHAN_V1','RISK_NONE_V1',
               'UP','2026-09-11T12:50:00Z',80,2,'SETTLEMENT')`,
      [TK, CLOSE],
    ),
    "a dangling fill reference must be refused",
  );
  await db.close();
});

test("one fill per window: a second position in the same window is refused", async () => {
  const db = await freshDb();
  await applyAll(db, await files());
  const ins = (key) =>
    db.query(
      `insert into desk_policy_fills
         (fill_key, ticker, close_time, entry_side, entry_t, entry_cents, entry_fee_cents,
          signal_policy, entry_policy, risk_policy)
       values ($1, 'TK-1', '2026-09-11T13:00:00Z', 'UP', '2026-09-11T12:50:00Z', 80, 2,
               'CHAIR_V1','ENTRY_80_V1','RISK_NONE_V1')`,
      [key],
    );
  await ins("A");
  // The exit competition has no defined meaning for two positions in one window.
  await assert.rejects(ins("B"));
  await db.close();
});

test("0026 normalises observations that predate fill_key, inventing nothing", async () => {
  // The race this guards: the code deployed with 0025 writes observations with no
  // fill_key, so a Chair fill landing before 0026 deploys leaves rows behind — and
  // `add column ... not null` on a non-empty table fails. Apply everything up to
  // 0025, write a pre-0026 window, then apply 0026 and check it recovers.
  const db = await freshDb();
  const names = await files();
  const upTo25 = names.filter((n) => n < "0026");
  assert.ok(upTo25.length < names.length, "0026 must exist and be excluded here");
  await applyAll(db, upTo25);

  const TK = "KXBTC15M-26SEP110900-00";
  const CLOSE = "2026-09-11T13:00:00Z";
  const ENTRY = "2026-09-11T12:50:00Z";
  await db.query(`insert into desk_ledger (ticker, close_time, winner, chair_lean) values ($1,$2,'UP','UP')`, [TK, CLOSE]);
  for (const [cand, reason, net] of [
    ["HOLD_V1", "SETTLEMENT", -82],
    ["PROVE180_V1", "DEADLINE", -11],
  ]) {
    await db.query(
      `insert into desk_policy_observations
         (ticker, close_time, candidate_id, candidate_kind, candidate_version,
          signal_policy, entry_policy, exit_policy, risk_policy,
          entry_side, entry_t, entry_cents, entry_fee_cents, exit_reason, net_cents)
       values ($1,$2,$3,'exit',1,'CHAIR_V1','ENTRY_80_V1',$3,'RISK_NONE_V1','UP',$4,82,2,$5,$6)`,
      [TK, CLOSE, cand, ENTRY, reason, net],
    );
  }

  // Now apply 0026 on a NON-empty table.
  await db.exec(await readFile(join(MIGRATIONS, "0026_desk_policy_fills.sql"), "utf8"));

  // One fill row, derived from what the observations already carried.
  const fills = await db.query(
    `select fill_key, ticker, entry_side, entry_cents, entry_fee_cents from desk_policy_fills`,
  );
  assert.equal(fills.rows.length, 1, "one source fill for the window");
  const f = fills.rows[0];
  assert.equal(f.ticker, TK);
  assert.equal(f.entry_side, "UP");
  assert.equal(Number(f.entry_cents), 82, "the price already on the rows, not a guess");
  assert.equal(Number(f.entry_fee_cents), 2);
  // And the key is exactly what the writer computes, so a replayed write matches.
  assert.equal(f.fill_key, `${TK}|${Date.parse(CLOSE)}|${Date.parse(ENTRY)}`);

  // Both observations now reference it, and the column is required.
  const obs = await db.query(
    `select count(*)::int as n, count(distinct fill_key)::int as fills,
            count(*) filter (where fill_key is null)::int as orphans
       from desk_policy_observations`,
  );
  assert.equal(obs.rows[0].n, 2, "no observation was added or removed");
  assert.equal(obs.rows[0].fills, 1);
  assert.equal(obs.rows[0].orphans, 0);

  const col = await db.query(
    `select is_nullable from information_schema.columns
      where table_name = 'desk_policy_observations' and column_name = 'fill_key'`,
  );
  assert.equal(col.rows[0].is_nullable, "NO", "the constraint is applied after normalising");

  // Re-applying is still safe.
  await db.exec(await readFile(join(MIGRATIONS, "0026_desk_policy_fills.sql"), "utf8"));
  const again = await db.query("select count(*)::int as n from desk_policy_fills");
  assert.equal(again.rows[0].n, 1, "a re-run does not duplicate the fill");
  await db.close();
});
