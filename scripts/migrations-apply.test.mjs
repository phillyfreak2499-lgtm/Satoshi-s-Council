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
      assert.fail(
        `${name} failed to apply: ${err instanceof Error ? err.message : String(err)}`,
      );
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
  for (const t of [
    "desk_ledger",
    "desk_samples",
    "desk_replay",
    "desk_state",
    "desk_absorption",
  ]) {
    assert.ok(
      tables.includes(t),
      `${t} missing after migration; got ${tables.join(", ")}`,
    );
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
  assert.match(
    String(q.column_default),
    /valid/,
    "existing and future rows count unless excluded",
  );
  await db.close();
});

test("the quarantine stamps the bad range and only the bad range", async () => {
  const db = await freshDb();
  const names = await files();
  await applyAll(db, names);

  // Three windows: the legitimate 07:00, one inside the bad block, one after it.
  const insert = `insert into desk_ledger (ticker, close_time, winner, chair_lean, entry_cents, settle_cents, ev_cents)
                  values ($1, $2, 'UP', 'WAIT', $3, $4, $5)`;
  await db.query(insert, [
    "KXBTC15M-26SEP100300-00",
    "2026-09-10T07:00:00Z",
    87,
    100,
    12,
  ]);
  await db.query(insert, [
    "KXBTC15M-26SEP100300-00",
    "2026-09-10T08:45:00Z",
    50,
    100,
    44,
  ]);
  await db.query(insert, [
    "KXBTC15M-26SEP110800-00",
    "2026-09-11T12:00:00Z",
    76,
    100,
    22,
  ]);

  // Re-apply the quality migration, as a restore or a hand-run would.
  await db.exec(
    await readFile(join(MIGRATIONS, "0024_desk_ledger_quality.sql"), "utf8"),
  );

  const { rows } = await db.query(
    `select to_char(close_time at time zone 'UTC','YYYY-MM-DD HH24:MI') as close_utc,
            research_quality, research_quality_rule, entry_cents, settle_cents, ev_cents, winner
       from desk_ledger order by close_time`,
  );
  assert.equal(rows.length, 3);

  assert.equal(rows[0].close_utc, "2026-09-10 07:00");
  assert.equal(
    rows[0].research_quality,
    "valid",
    "the 07:00 settlement really was its own",
  );

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
  assert.equal(
    counted[0].n,
    2,
    "the excluded window must not reach an aggregate",
  );
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
  await db.exec(
    await readFile(join(MIGRATIONS, "0024_desk_ledger_quality.sql"), "utf8"),
  );

  const all = (await db.query("select count(*)::int as n from desk_ledger"))
    .rows[0].n;
  const research = (
    await db.query("select count(*)::int as n from desk_ledger_research")
  ).rows[0].n;
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
  const q = readFileSync(
    join(MIGRATIONS, "0024_desk_ledger_quality.sql"),
    "utf8",
  );
  const lab = readFileSync(
    join(MIGRATIONS, "0025_desk_policy_lab.sql"),
    "utf8",
  );
  const registry = readFileSync(
    join(ROOT, "src/lib/desk/research-quality.ts"),
    "utf8",
  );
  assert.ok(q.includes(PREDICATE), "0024 must use the predicate");
  assert.ok(lab.includes(PREDICATE), "0025 must use the identical predicate");
  assert.ok(
    registry.includes(`VALID_ONLY_SQL = "${PREDICATE}"`),
    "the registry must declare the same predicate the migrations apply",
  );
  // And 0025 must NOT depend on 0024's view, or 0024 stops being re-runnable.
  assert.doesNotMatch(
    lab,
    /join\s+desk_ledger_research/,
    "0025 must stand alone",
  );
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
  const obs = await db.query(
    "select count(*)::int as n from desk_policy_observations",
  );
  assert.equal(
    obs.rows[0].n,
    0,
    "prospective N must start at zero for every candidate",
  );
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
  assert.equal(
    rows.rows[0].exit_reason,
    "SETTLEMENT",
    "the recorded result is not revised",
  );
  assert.equal(Number(rows.rows[0].net_cents), 18);

  // A different candidate on the same window is a separate observation.
  await db.query(ins, ["PROVE180_V1", "DEADLINE", -9]);
  const all = await db.query(
    "select count(*)::int as n from desk_policy_observations",
  );
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
  await db.query(obs, [
    "GOOD-1",
    "2026-09-11T13:00:00Z",
    "SETTLEMENT",
    18,
    false,
  ]);
  await db.query(led, ["BAD-1", "2026-09-10T08:30:00Z"]);
  await mkFill("BAD-1", "2026-09-10T08:30:00Z");
  await db.query(obs, [
    "BAD-1",
    "2026-09-10T08:30:00Z",
    "SETTLEMENT",
    18,
    false,
  ]);
  await db.query(led, ["GOOD-2", "2026-09-11T13:15:00Z"]);
  await mkFill("GOOD-2", "2026-09-11T13:15:00Z");
  await db.query(obs, [
    "GOOD-2",
    "2026-09-11T13:15:00Z",
    "DATA_INVALID",
    null,
    true,
  ]);
  // Re-apply the quality stamp, as the real deploy does.
  await db.exec(
    await readFile(join(MIGRATIONS, "0024_desk_ledger_quality.sql"), "utf8"),
  );

  const all = await db.query(
    "select count(*)::int as n from desk_policy_observations",
  );
  const research = await db.query(
    "select count(*)::int as n from desk_policy_observations_research",
  );
  assert.equal(
    all.rows[0].n,
    3,
    "all three rows remain readable for forensics",
  );
  assert.equal(research.rows[0].n, 1, "only the good, priceable window counts");
  const kept = await db.query(
    "select ticker from desk_policy_observations_research",
  );
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
    obs.call(null, "GHOST_V1", "SETTLEMENT", 0) &&
      db.query(
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
  assert.ok(
    upTo25.length < names.length,
    "0026 must exist and be excluded here",
  );
  await applyAll(db, upTo25);

  const TK = "KXBTC15M-26SEP110900-00";
  const CLOSE = "2026-09-11T13:00:00Z";
  const ENTRY = "2026-09-11T12:50:00Z";
  await db.query(
    `insert into desk_ledger (ticker, close_time, winner, chair_lean) values ($1,$2,'UP','UP')`,
    [TK, CLOSE],
  );
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
  await db.exec(
    await readFile(join(MIGRATIONS, "0026_desk_policy_fills.sql"), "utf8"),
  );

  // One fill row, derived from what the observations already carried.
  const fills = await db.query(
    `select fill_key, ticker, entry_side, entry_cents, entry_fee_cents from desk_policy_fills`,
  );
  assert.equal(fills.rows.length, 1, "one source fill for the window");
  const f = fills.rows[0];
  assert.equal(f.ticker, TK);
  assert.equal(f.entry_side, "UP");
  assert.equal(
    Number(f.entry_cents),
    82,
    "the price already on the rows, not a guess",
  );
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
  assert.equal(
    col.rows[0].is_nullable,
    "NO",
    "the constraint is applied after normalising",
  );

  // Re-applying is still safe.
  await db.exec(
    await readFile(join(MIGRATIONS, "0026_desk_policy_fills.sql"), "utf8"),
  );
  const again = await db.query(
    "select count(*)::int as n from desk_policy_fills",
  );
  assert.equal(again.rows[0].n, 1, "a re-run does not duplicate the fill");
  await db.close();
});

test("0027 stores the three legacy outcomes as three distinct rows", async () => {
  // The whole point of the shadow table: "0", NULL and NaN must not arrive in the
  // database meaning the same thing. A flat tape, production's short-path zero and a
  // non-finite reading are three different operational facts.
  const db = await freshDb();
  await applyAll(db, await files());

  const close = "2026-09-11T16:00:00.000Z";
  await db.query(
    `insert into desk_ledger (ticker, close_time, winner, chair_lean, entry_cents, settle_cents, ev_cents)
     values ('KXBTC15M-26SEP111200-00', $1, 'UP', 'UP', 80, 100, 18)`,
    [close],
  );

  const row = (key, horizon, legacy, legacyState, trueD, trueState, divState) =>
    db.query(
      `insert into desk_path_parity (
         sample_key, ticker, close_time, sampled_at, sample_minute,
         horizon, want_ms, legacy_back,
         legacy_delta, legacy_state, true_delta, true_state,
         signed_divergence, abs_divergence, divergence_state,
         available_ms, coverage_ok, source_mix, points_used, research_version
       ) values ($1, 'KXBTC15M-26SEP111200-00', $2, $2, 1, $3, 60000, 6,
                 $4, $5, $6, $7, null, null, $8, 600000, true, 'candle', 11, 'path-1')`,
      [key, close, horizon, legacy, legacyState, trueD, trueState, divState],
    );

  // A genuinely flat tape and production's short-path branch are both the NUMBER 0.
  await row("k-flat", "d60", 0, "numeric", 1, "numeric", "measured");
  await row("k-short", "d30", 0, "short-path", 1, "numeric", "measured");
  // A NaN cannot be stored as a number, so the delta is NULL and the state says why.
  await row(
    "k-nan",
    "d120",
    null,
    "non-finite",
    1,
    "numeric",
    "legacy-non-finite",
  );

  const { rows } = await db.query(
    `select sample_key, legacy_delta, legacy_state, divergence_state
       from desk_path_parity order by sample_key`,
  );
  assert.equal(rows.length, 3);
  const by = Object.fromEntries(rows.map((r) => [r.sample_key, r]));

  assert.equal(Number(by["k-flat"].legacy_delta), 0);
  assert.equal(
    Number(by["k-short"].legacy_delta),
    0,
    "the zero consumers actually receive",
  );
  assert.equal(by["k-nan"].legacy_delta, null);

  const states = rows.map((r) => r.legacy_state);
  assert.equal(new Set(states).size, 3, "three outcomes stayed three outcomes");

  // The counter the operator wants, as a query.
  const { rows: counted } = await db.query(
    `select count(*)::int as n from desk_path_parity where legacy_state = 'non-finite'`,
  );
  assert.equal(counted[0].n, 1);

  await db.close();
});

test("0027's research view excludes quarantined windows on the same rule", async () => {
  const db = await freshDb();
  await applyAll(db, await files());

  // One valid window and one quarantined. The quality is set explicitly rather than
  // relying on 0024's one-time UPDATE: that stamp runs at migration time, so a row
  // inserted afterwards takes the 'valid' default. The stamp has its own test above;
  // this one is about whether the VIEW honours the flag.
  const good = "2026-09-11T16:00:00.000Z";
  const bad = "2026-09-10T08:00:00.000Z";
  for (const [t, close, quality] of [
    ["KXBTC15M-26SEP111200-00", good, "valid"],
    ["KXBTC15M-26SEP100400-00", bad, "excluded"],
  ]) {
    await db.query(
      `insert into desk_ledger
         (ticker, close_time, winner, chair_lean, entry_cents, settle_cents, ev_cents,
          research_quality, research_quality_rule)
       values ($1, $2, 'UP', 'UP', 80, 100, 18, $3, $4)`,
      [
        t,
        close,
        quality,
        quality === "excluded" ? "2026-09-10-ticker-reuse" : "",
      ],
    );
    await db.query(
      `insert into desk_path_parity (
         sample_key, ticker, close_time, sampled_at, sample_minute,
         horizon, want_ms, legacy_back, legacy_delta, legacy_state,
         true_delta, true_state, divergence_state,
         available_ms, coverage_ok, source_mix, points_used, research_version
       ) values ($1 || '|d60', $1, $2, $2, 1, 'd60', 60000, 6, 5, 'numeric',
                 1, 'numeric', 'measured', 600000, true, 'candle', 11, 'path-1')`,
      [t, close],
    );
  }

  const { rows: all } = await db.query(
    `select count(*)::int as n from desk_path_parity`,
  );
  assert.equal(all[0].n, 2, "both rows are kept for forensics");

  const { rows: view } = await db.query(
    `select ticker from desk_path_parity_research order by ticker`,
  );
  assert.equal(view.length, 1, "only the valid window is countable");
  assert.equal(view[0].ticker, "KXBTC15M-26SEP111200-00");

  await db.close();
});

test("0027 stores overshoot and end-staleness, the two facts that qualify a reading", async () => {
  // A true-time reading is not the number on its label. `overshoot_ms` says how far
  // the measured span sat from the requested horizon; `newest_age_ms` says how stale
  // the reading's END was at the decision tick. Without both, a row looks like a
  // measurement of the present over the requested interval, when it may be neither.
  const db = await freshDb();
  await applyAll(db, await files());

  const close = "2026-09-11T16:00:00.000Z";
  await db.query(
    `insert into desk_ledger (ticker, close_time, winner, chair_lean, entry_cents, settle_cents, ev_cents)
     values ('KXBTC15M-26SEP111200-00', $1, 'UP', 'UP', 80, 100, 18)`,
    [close],
  );

  // The real candle-feed shape: a 30s request lands on a 60s span (100% overshoot),
  // and the index offset labelled d30 spans 3 minutes.
  await db.query(
    `insert into desk_path_parity (
       sample_key, ticker, close_time, sampled_at, sample_minute,
       horizon, want_ms, legacy_back, legacy_delta, legacy_state,
       true_delta, true_state, divergence_state,
       span_ms, overshoot_ms, legacy_span_ms, legacy_overshoot_ms,
       available_ms, coverage_ok, newest_t, newest_age_ms,
       source_mix, points_used, research_version
     ) values ('k30', 'KXBTC15M-26SEP111200-00', $1, $1, 1, 'd30', 30000, 4, 3, 'numeric',
               1, 'numeric', 'measured',
               60000, 30000, 180000, 150000,
               600000, true, $1, 55000, 'candle', 11, 'path-1')`,
    [close],
  );

  const { rows } = await db.query(
    `select want_ms, span_ms, overshoot_ms, legacy_span_ms, legacy_overshoot_ms, newest_age_ms
       from desk_path_parity where sample_key = 'k30'`,
  );
  const r = rows[0];
  assert.equal(Number(r.want_ms), 30000);
  assert.equal(Number(r.span_ms), 60000, "what was actually measured");
  assert.notEqual(
    Number(r.span_ms),
    Number(r.want_ms),
    "never assume the span is the request",
  );
  assert.equal(Number(r.overshoot_ms), Number(r.span_ms) - Number(r.want_ms));
  assert.equal(
    Number(r.overshoot_ms),
    30000,
    "100% overshoot: 30s is unsupportable here",
  );
  assert.equal(
    Number(r.legacy_overshoot_ms),
    Number(r.legacy_span_ms) - Number(r.want_ms),
  );
  assert.equal(
    Number(r.newest_age_ms),
    55000,
    "the reading ended 55s before the tick",
  );

  // Overshoot is queryable directly, which is the question a consumer flip turns on.
  const { rows: unsupportable } = await db.query(
    `select horizon from desk_path_parity where overshoot_ms >= want_ms`,
  );
  assert.deepEqual(
    unsupportable.map((x) => x.horizon),
    ["d30"],
    "a horizon whose overshoot is at least its own length is not honestly supportable",
  );

  await db.close();
});

test("0027 self-heals a database that applied an earlier version of the same file", async () => {
  // THE SILENT FAILURE THIS PREVENTS. `scripts/migrate.mjs` records applied files by
  // NAME, and `create table if not exists` is a no-op once the table exists. So a
  // column added to 0027 after it had already been applied somewhere would never
  // arrive — and the shadow writer's errors are deliberately silent, so every row
  // would be lost with no error anywhere. Each column is therefore also added
  // idempotently, and this proves it by simulating the older table shape.
  const db = await freshDb();
  const names = await files();
  await applyAll(
    db,
    names.filter((n) => n !== "0027_desk_path_parity.sql"),
  );

  // The first-committed shape of the table: no overshoot, no staleness, no alignment.
  await db.exec(`
    create table desk_path_parity (
      sample_key text primary key,
      ticker text not null,
      close_time timestamptz not null,
      sampled_at timestamptz not null,
      sample_minute bigint not null,
      horizon text not null,
      want_ms integer not null,
      legacy_back integer not null,
      legacy_delta double precision,
      legacy_state text not null,
      true_delta double precision,
      true_state text not null,
      signed_divergence double precision,
      abs_divergence double precision,
      divergence_state text not null,
      span_ms integer,
      legacy_span_ms integer,
      available_ms integer not null,
      coverage_ok boolean not null,
      source_mix text not null,
      points_used integer not null,
      points_dropped_non_finite integer not null default 0,
      points_dropped_non_positive integer not null default 0,
      points_collapsed_duplicate integer not null default 0,
      candle_rows_priced integer not null default 0,
      candle_rows_timed integer not null default 0,
      candle_ts_fields text not null default '',
      candle_ts_absent integer not null default 0,
      candle_ts_bad integer not null default 0,
      window_phase text not null default '',
      secs_left integer,
      chair_decision text not null default '',
      research_version text not null,
      created_at timestamptz not null default now()
    );
  `);

  // Now apply the current 0027 on top. The create is a no-op; the alters must land.
  const sql = await readFile(
    join(MIGRATIONS, "0027_desk_path_parity.sql"),
    "utf8",
  );
  await db.exec(sql);

  const { rows } = await db.query(
    `select column_name from information_schema.columns
      where table_name = 'desk_path_parity' order by 1`,
  );
  const cols = rows.map((r) => r.column_name);
  for (const c of [
    "overshoot_ms",
    "legacy_overshoot_ms",
    "legacy_span_aligned",
    "newest_t",
    "newest_age_ms",
    "candle_ts_start_adjusted",
    "anchor_t",
    "anchor_age_ms",
    "decision_overshoot_ms",
    "decision_fidelity",
  ]) {
    assert.ok(
      cols.includes(c),
      `${c} never arrived: the writer would fail silently`,
    );
  }

  // And every column the writer names must now exist, which is the real guarantee.
  const writer = readFileSync(
    join(ROOT, "src/lib/desk/path-parity.server.ts"),
    "utf8",
  );
  const i = writer.indexOf("insert into desk_path_parity (");
  const j = writer.indexOf(") values (", i);
  const named = writer
    .slice(i + "insert into desk_path_parity (".length, j)
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x && !x.startsWith("--"));
  for (const c of named) {
    assert.ok(
      cols.includes(c),
      `writer names "${c}" but the healed table has no such column`,
    );
  }

  await db.close();
});

test("0027 keeps a shifted interval distinguishable from a fresh one at the DB level", async () => {
  // The distinction that span_ms alone cannot carry. Both rows below have
  // span_ms = 60000 and overshoot_ms = 0. One is the last 60 seconds; the other is a
  // 60-second interval that ended a minute before the decision. If the schema could not
  // tell them apart, a zero span overshoot would later be read as exact horizon coverage.
  const db = await freshDb();
  await applyAll(db, await files());

  const close = "2026-09-11T16:00:00.000Z";
  await db.query(
    `insert into desk_ledger (ticker, close_time, winner, chair_lean, entry_cents, settle_cents, ev_cents)
     values ('KXBTC15M-26SEP111200-00', $1, 'UP', 'UP', 80, 100, 18)`,
    [close],
  );

  const put = (key, newestAge, anchorAge, decOver, fidelity) =>
    db.query(
      `insert into desk_path_parity (
         sample_key, ticker, close_time, sampled_at, sample_minute,
         horizon, want_ms, legacy_back, legacy_delta, legacy_state,
         true_delta, true_state, divergence_state,
         span_ms, overshoot_ms, available_ms, coverage_ok,
         newest_age_ms, anchor_age_ms, decision_overshoot_ms, decision_fidelity,
         source_mix, points_used, research_version
       ) values ($1, 'KXBTC15M-26SEP111200-00', $2, $2, 1, 'd60', 60000, 6, 5, 'numeric',
                 1, 'numeric', 'measured',
                 60000, 0, 600000, true,
                 $3, $4, $5, $6, 'candle', 11, 'path-1')`,
      [key, close, newestAge, anchorAge, decOver, fidelity],
    );

  // as_of = 120s, newest = 60s, anchor = 0s: a valid 60s move over t-120s..t-60s.
  await put("shifted", 60000, 120000, 60000, "end-shifted");
  // as_of = 120s, newest = 120s, anchor = 60s: genuinely the last 60 seconds.
  await put("fresh", 0, 60000, 0, "decision-aligned");

  const { rows } = await db.query(
    `select sample_key, span_ms, overshoot_ms, newest_age_ms, anchor_age_ms,
            decision_overshoot_ms, decision_fidelity
       from desk_path_parity order by sample_key`,
  );
  const by = Object.fromEntries(rows.map((r) => [r.sample_key, r]));

  // Identical on span coverage…
  assert.equal(Number(by.shifted.span_ms), Number(by.fresh.span_ms));
  assert.equal(Number(by.shifted.overshoot_ms), Number(by.fresh.overshoot_ms));
  // …and opposite on decision fidelity.
  assert.notEqual(
    Number(by.shifted.anchor_age_ms),
    Number(by.fresh.anchor_age_ms),
  );
  assert.notEqual(by.shifted.decision_fidelity, by.fresh.decision_fidelity);

  // The identities a reader is told they can rely on, checked in SQL.
  for (const r of rows) {
    assert.equal(
      Number(r.anchor_age_ms),
      Number(r.newest_age_ms) + Number(r.span_ms),
      "anchor_age_ms = newest_age_ms + span_ms",
    );
    assert.equal(
      Number(r.decision_overshoot_ms),
      Number(r.newest_age_ms) + Number(r.overshoot_ms),
      "decision_overshoot_ms = newest_age_ms + overshoot_ms",
    );
  }

  // The query that separates "exact span" from "exact horizon" — the whole point.
  const { rows: exactSpan } = await db.query(
    `select sample_key from desk_path_parity where overshoot_ms = 0 order by 1`,
  );
  assert.deepEqual(
    exactSpan.map((r) => r.sample_key),
    ["fresh", "shifted"],
  );
  const { rows: exactHorizon } = await db.query(
    `select sample_key from desk_path_parity
      where overshoot_ms = 0 and decision_overshoot_ms = 0 order by 1`,
  );
  assert.deepEqual(
    exactHorizon.map((r) => r.sample_key),
    ["fresh"],
    "only one of the two is actually a measurement of the last 60 seconds",
  );

  await db.close();
});

/**
 * S2-2B: desk_replay's persisted identity is the WINDOW, and migrating to it loses
 * nothing.
 *
 * A ticker is not a window -- the ledger has been unique on (ticker, close_time) since
 * 0005, while desk_replay was keyed on the ticker alone. On 2026-09-10 nine closes
 * carried one ticker, and under the old key only the first could ever be stored.
 *
 * These run against the real migration files on PGLite, which is the only place the
 * DDL is actually executed before production.
 */
test("desk_replay's primary key is the window, not the ticker", async () => {
  const db = await freshDb();
  await applyAll(db, await files());
  const { rows } = await db.query(
    `select pg_get_constraintdef(c.oid) as def
       from pg_constraint c join pg_class t on t.oid = c.conrelid
      where t.relname = 'desk_replay' and c.contype = 'p'`,
  );
  assert.equal(rows.length, 1, "exactly one primary key");
  assert.equal(rows[0].def, "PRIMARY KEY (ticker, close_time)");
  await db.close();
});

test("two closes sharing one ticker both persist; an exact duplicate does not", async () => {
  const db = await freshDb();
  await applyAll(db, await files());
  // The real 2026-09-10 reuse shape: one ticker, the first two closes it spanned.
  const T = "KXBTC15M-26SEP100300-00";
  const C1 = "2026-09-10T07:00:00Z";
  const C2 = "2026-09-10T07:15:00Z";
  const ins = async (close) =>
    db.query(
      `insert into desk_replay (ticker, close_time, strike, winner, n, step_ms, partial, cols)
       values ($1, $2, 78100, 'UP', 3, 4000, false, '{"t0":1,"t":[0,4,8]}'::jsonb)
       on conflict (ticker, close_time) do nothing`,
      [T, close],
    );

  await ins(C1);
  await ins(C2);
  const both = await db.query(
    `select close_time from desk_replay where ticker = $1 order by close_time`,
    [T],
  );
  assert.equal(
    both.rows.length,
    2,
    "BOTH closes persist — neither displaced the other",
  );

  // The exact same window again is still a single immutable row.
  await ins(C1);
  const again = await db.query(
    `select count(*)::int as n from desk_replay where ticker = $1`,
    [T],
  );
  assert.equal(
    again.rows[0].n,
    2,
    "an exact duplicate adds nothing and overwrites nothing",
  );
  await db.close();
});

test("today's production rows migrate with no loss and no invented close_time", async () => {
  // A fixture shaped like production as audited at 2026-09-11T22:05:25Z: every row has
  // a non-null close_time, every (ticker, close_time) pair is distinct, and no row
  // needs identity inferred. Seeded under the OLD key, then migrated.
  const db = await freshDb();
  const names = await files();
  const before = names.filter((n) => n < "0028_");
  assert.ok(
    before.length > 0 && before.length < names.length,
    "there is a pre-0028 prefix to seed on",
  );
  await applyAll(db, before);

  const pre = await db.query(
    `select pg_get_constraintdef(c.oid) as def
       from pg_constraint c join pg_class t on t.oid = c.conrelid
      where t.relname = 'desk_replay' and c.contype = 'p'`,
  );
  assert.equal(
    pre.rows[0].def,
    "PRIMARY KEY (ticker)",
    "seeded under the ticker-only key",
  );

  const seed = [
    ["KXBTC15M-26SEP111800-00", "2026-09-11T22:00:00Z"],
    ["KXBTC15M-26SEP111745-45", "2026-09-11T21:45:00Z"],
    ["KXBTC15M-26SEP100245-45", "2026-09-10T06:45:00Z"],
  ];
  for (const [t, c] of seed) {
    await db.query(
      `insert into desk_replay (ticker, close_time, strike, winner, n, step_ms, partial, cols)
       values ($1, $2, 78100, 'UP', 3, 4000, false, '{"t0":1,"t":[0,4,8]}'::jsonb)`,
      [t, c],
    );
  }
  const countBefore = (
    await db.query(`select count(*)::int as n from desk_replay`)
  ).rows[0].n;
  const digest = async () =>
    (
      await db.query(
        `select ticker, close_time::text as close_time, strike, winner, n, step_ms, partial, cols::text
           from desk_replay order by ticker`,
      )
    ).rows;
  const rowsBefore = await digest();

  await applyAll(db, names); // applies 0028 over the seeded data

  const post = await db.query(
    `select pg_get_constraintdef(c.oid) as def
       from pg_constraint c join pg_class t on t.oid = c.conrelid
      where t.relname = 'desk_replay' and c.contype = 'p'`,
  );
  assert.equal(
    post.rows[0].def,
    "PRIMARY KEY (ticker, close_time)",
    "identity is now the window",
  );
  assert.equal(
    (await db.query(`select count(*)::int as n from desk_replay`)).rows[0].n,
    countBefore,
    "no row was lost",
  );
  assert.deepEqual(
    await digest(),
    rowsBefore,
    "and not one recorded value changed",
  );
  assert.equal(
    (
      await db.query(
        `select count(*)::int as n from desk_replay where close_time is null`,
      )
    ).rows[0].n,
    0,
    "no close_time was invented or nulled",
  );
  // The close_time index survives, and the ticker-only lookup is still index-led.
  const idx = await db.query(
    `select indexname from pg_indexes where tablename = 'desk_replay' order by 1`,
  );
  const names2 = idx.rows.map((r) => r.indexname);
  assert.ok(
    names2.includes("desk_replay_close_idx"),
    "the close_time index is untouched",
  );
  await db.close();
});

/**
 * The reader predicates, proved on the reuse shape at the database level.
 *
 * A rail pins each production query to matching on BOTH halves. These tests prove why
 * that matters: on one ticker spanning two closes, the both-halves predicate gives the
 * right answer and the ticker-only predicate gives a wrong one. Without this, the rail
 * would only be asserting that some text is present.
 */
test("both-halves predicates resolve the reuse shape; ticker-only ones do not", async () => {
  const db = await freshDb();
  await applyAll(db, await files());

  // One ticker, two ledger windows -- the 2026-09-10 shape -- with a replay for the
  // FIRST close only.
  const T = "KXBTC15M-26SEP100300-00";
  const C1 = "2026-09-10T07:00:00Z";
  const C2 = "2026-09-10T07:15:00Z";
  for (const [c, ev] of [
    [C1, 7],
    [C2, -3],
  ]) {
    await db.query(
      `insert into desk_ledger (ticker, close_time, source, winner, chair_lean, entry_cents, settle_cents, ev_cents, calls)
       values ($1, $2, 'kalshi-result', 'UP', 'UP', 80, 100, $3, 1)`,
      [T, c, ev],
    );
  }
  await db.query(
    `insert into desk_replay (ticker, close_time, strike, winner, n, step_ms, partial, cols)
     values ($1, $2, 78100, 'UP', 3, 4000, false, '{"t0":1,"t":[0,4,8]}'::jsonb)`,
    [T, C1],
  );

  // 3 · VIEWER association: the replay joins ITS ledger row, never the other close's.
  const viewer = await db.query(
    `select r.close_time::text as rc, l.close_time::text as lc, l.ev_cents
       from desk_replay r
       left join desk_ledger l on l.ticker = r.ticker and l.close_time = r.close_time
      where r.ticker = $1`,
    [T],
  );
  assert.equal(viewer.rows.length, 1, "one replay, one joined row");
  assert.equal(
    viewer.rows[0].rc,
    viewer.rows[0].lc,
    "joined to its own window",
  );
  assert.equal(Number(viewer.rows[0].ev_cents), 7, "c1's numbers, not c2's");
  // Ticker-only would have produced two rows, one of them the wrong window.
  const viewerBad = await db.query(
    `select l.close_time::text as lc from desk_replay r
       left join desk_ledger l on l.ticker = r.ticker where r.ticker = $1`,
    [T],
  );
  assert.equal(
    viewerBad.rows.length,
    2,
    "ticker-only multiplies — this is what was fixed",
  );

  // 4 · BOOKS flag: true for the exact window only.
  const flags = await db.query(
    `select l.close_time::text as lc,
            exists (select 1 from desk_replay r
                     where r.ticker = l.ticker and r.close_time = l.close_time) as replay
       from desk_ledger l where l.ticker = $1 order by l.close_time`,
    [T],
  );
  assert.deepEqual(
    flags.rows.map((r) => r.replay),
    [true, false],
    "only the window that HAS a replay is flagged",
  );
  const flagsBad = await db.query(
    `select exists (select 1 from desk_replay r where r.ticker = l.ticker) as replay
       from desk_ledger l where l.ticker = $1 order by l.close_time`,
    [T],
  );
  assert.deepEqual(
    flagsBad.rows.map((r) => r.replay),
    [true, true],
    "ticker-only lights both",
  );

  // 5 · EXCURSION: one replay cannot multiply across the ledger rows sharing a ticker.
  const exc = await db.query(
    `select count(*)::int as n from desk_ledger l
       join desk_replay r on r.ticker = l.ticker and r.close_time = l.close_time
      where l.ticker = $1`,
    [T],
  );
  assert.equal(exc.rows[0].n, 1, "one study row per replay");
  const excBad = await db.query(
    `select count(*)::int as n from desk_ledger l
       join desk_replay r on r.ticker = l.ticker where l.ticker = $1`,
    [T],
  );
  assert.equal(excBad.rows[0].n, 2, "ticker-only doubles the sample");

  // 6 · PIT: the strike comes from the intended close. Give c2 its own replay with a
  // different strike, so picking the wrong window is visible rather than coincidental.
  await db.query(
    `insert into desk_replay (ticker, close_time, strike, winner, n, step_ms, partial, cols)
     values ($1, $2, 79900, 'UP', 3, 4000, false, '{"t0":1,"t":[0,4,8]}'::jsonb)`,
    [T, C2],
  );
  for (const [want, strike] of [
    [C1, 78100],
    [C2, 79900],
  ]) {
    const pit = await db.query(
      `select r.strike from desk_ledger l
         left join desk_replay r on r.ticker = l.ticker and r.close_time = l.close_time
        where l.ticker = $1 and l.close_time = $2 limit 1`,
      [T, want],
    );
    assert.equal(
      Number(pit.rows[0].strike),
      strike,
      `the strike of ${want}, not the other close`,
    );
  }

  // 7 · PUBLIC ticker-only probe: two closes for one ticker must read as ambiguous.
  const probe = await db.query(
    `select close_time from desk_replay where ticker = $1 limit 2`,
    [T],
  );
  assert.equal(
    probe.rows.length,
    2,
    "the probe sees two — replayFor's `!== 1` then refuses",
  );
  const lone = await db.query(
    `select close_time from desk_replay where ticker = $1 limit 2`,
    ["KXBTC15M-26SEP100245-45"],
  );
  assert.equal(lone.rows.length, 0, "a ticker with no replay reads as none");
  await db.close();
});

/*
 * S2-5: the Chair's decision-time snapshot is identified by the WINDOW and its
 * semantic kind, insert-once, and a later tick or a restart can never rewrite it.
 * The event RULE (which kind a tick writes) is proven purely in
 * src/lib/desk/decision-snapshot.test.ts; these assert the DATABASE half the rule
 * relies on: exact (ticker, close_time, snapshot_kind) identity, on-conflict
 * idempotence, neighbour isolation, and the exact-window read-back a restart uses
 * to recover the persisted OPENING lean.
 */
const DECISION_COLS =
  "(ticker, close_time, snapshot_kind, decision_at, chair_lean, yes_ask)";
function decisionInsert(db, ticker, closeIso, kind, lean, yesAsk, decisionIso) {
  // The writer's exact idempotent insert, minimised to the asserted columns.
  return db.query(
    `insert into desk_decision_snapshots ${DECISION_COLS}
       values ($1, $2, $3, $4, $5, $6)
       on conflict (ticker, close_time, snapshot_kind) do nothing`,
    [ticker, closeIso, kind, decisionIso, lean, yesAsk],
  );
}

test("0029 only permits the two bounded kinds", async () => {
  const db = await freshDb();
  await applyAll(db, await files());
  const T = "KXBTC15M-26SEP111800-00";
  const c = "2026-09-11T18:00:00.000Z";
  await decisionInsert(
    db,
    T,
    c,
    "OPENING",
    "WAIT",
    62,
    "2026-09-11T17:45:01.000Z",
  );
  await assert.rejects(
    () =>
      decisionInsert(
        db,
        T,
        c,
        "MIDWINDOW",
        "UP",
        70,
        "2026-09-11T17:50:00.000Z",
      ),
    /check|constraint/i,
    "a third snapshot_kind must be refused by the check constraint",
  );
  await db.close();
});

test("0029 stores OPENING and FIRST_DIRECTIONAL for one window; duplicates are no-ops", async () => {
  const db = await freshDb();
  await applyAll(db, await files());
  const T = "KXBTC15M-26SEP111800-00";
  const c = "2026-09-11T18:00:00.000Z";

  // M2/M9: a WAIT OPENING persists, and a second OPENING attempt writes nothing.
  await decisionInsert(
    db,
    T,
    c,
    "OPENING",
    "WAIT",
    62,
    "2026-09-11T17:45:01.000Z",
  );
  await decisionInsert(
    db,
    T,
    c,
    "OPENING",
    "UP",
    80,
    "2026-09-11T17:50:00.000Z",
  ); // later, conflicts
  const opening = await db.query(
    `select chair_lean, yes_ask from desk_decision_snapshots
      where ticker=$1 and close_time=$2 and snapshot_kind='OPENING'`,
    [T, c],
  );
  assert.equal(opening.rows.length, 1, "exactly one OPENING row");
  assert.equal(
    opening.rows[0].chair_lean,
    "WAIT",
    "the first-observed WAIT read is never overwritten",
  );
  assert.equal(
    Number(opening.rows[0].yes_ask),
    62,
    "M7: a later quote (80) does not rewrite the 62 it first read",
  );

  // M3/M9: the first directional turn persists once; a later flip's duplicate is a no-op.
  await decisionInsert(
    db,
    T,
    c,
    "FIRST_DIRECTIONAL",
    "UP",
    64,
    "2026-09-11T17:52:00.000Z",
  );
  await decisionInsert(
    db,
    T,
    c,
    "FIRST_DIRECTIONAL",
    "DOWN",
    41,
    "2026-09-11T17:55:00.000Z",
  );
  const fd = await db.query(
    `select chair_lean from desk_decision_snapshots
      where ticker=$1 and close_time=$2 and snapshot_kind='FIRST_DIRECTIONAL'`,
    [T, c],
  );
  assert.equal(fd.rows.length, 1, "exactly one FIRST_DIRECTIONAL row");
  assert.equal(
    fd.rows[0].chair_lean,
    "UP",
    "the first directional read stands; a later DOWN flip does not replace it",
  );

  const all = await db.query(
    `select count(*)::int as n from desk_decision_snapshots where ticker=$1 and close_time=$2`,
    [T, c],
  );
  assert.equal(all.rows[0].n, 2, "one window, at most two rows");
  await db.close();
});

test("0029 keeps two closes sharing one ticker apart; neither resolves by ticker alone", async () => {
  const db = await freshDb();
  await applyAll(db, await files());
  const T = "KXBTC15M-26SEP100300-00"; // the 2026-09-10 reused ticker
  const c1 = "2026-09-10T03:00:00.000Z";
  const c2 = "2026-09-10T03:15:00.000Z";

  // M8: c1's OPENING and c2's OPENING coexist; writing c1 never touches c2.
  await decisionInsert(
    db,
    T,
    c1,
    "OPENING",
    "UP",
    70,
    "2026-09-10T02:45:01.000Z",
  );
  await decisionInsert(
    db,
    T,
    c2,
    "OPENING",
    "WAIT",
    55,
    "2026-09-10T03:00:01.000Z",
  );
  const both = await db.query(
    `select close_time, chair_lean from desk_decision_snapshots where ticker=$1 order by close_time`,
    [T],
  );
  assert.equal(
    both.rows.length,
    2,
    "both closes persist under the composite key",
  );

  // The restart read-back is EXACT-window, so c2's lookup never reads c1's lean.
  const exactC2 = await db.query(
    `select snapshot_kind, chair_lean from desk_decision_snapshots where ticker=$1 and close_time=$2`,
    [T, c2],
  );
  assert.equal(exactC2.rows.length, 1, "the exact-window probe sees only c2");
  assert.equal(
    exactC2.rows[0].chair_lean,
    "WAIT",
    "c2's OPENING lean, not c1's",
  );

  // M10/M11 DB half: after a restart the writer recovers the PERSISTED opening lean
  // for the exact window, which is what lets FIRST_DIRECTIONAL fire (c2 was WAIT) or
  // stay suppressed (c1 was UP).
  const c1lean = await db.query(
    `select chair_lean from desk_decision_snapshots where ticker=$1 and close_time=$2 and snapshot_kind='OPENING'`,
    [T, c1],
  );
  assert.equal(
    c1lean.rows[0].chair_lean,
    "UP",
    "c1's opening was directional → no FIRST_DIRECTIONAL on restart",
  );
  await db.close();
});

test("0029 writes no historical rows: the migration creates structure only", async () => {
  const db = await freshDb();
  await applyAll(db, await files());
  const n = await db.query(
    `select count(*)::int as n from desk_decision_snapshots`,
  );
  assert.equal(
    n.rows[0].n,
    0,
    "no INSERT or INSERT-SELECT backfill — the table starts empty",
  );
  await db.close();
});

test("0031 records only prospective, valid booked-decision mirrors", async () => {
  const db = await freshDb();
  const names = await files();
  const before = names.filter((name) => name < "0031_");
  await applyAll(db, before);

  const legacyTicker = "KXBTC15M-26SEP131900-00";
  const legacyClose = "2026-09-13T23:00:00Z";
  await db.query(
    `insert into desk_ledger
       (ticker, close_time, source, winner, chair_lean, chair_conf, score, bar,
        entry_cents, entry_conf, entry_score, entry_bar, settle_cents, ev_cents)
     values ($1, $2, 'kalshi-result', 'UP', 'WAIT', 70, 0, 0.61,
             84, 82, 0.71, 0.60, 100, 14)`,
    [legacyTicker, legacyClose],
  );

  await applyAll(
    db,
    names.filter((name) => name >= "0031_"),
  );

  const legacy = await db.query(
    `select entry_lean, entry_build_sha from desk_ledger
      where ticker = $1 and close_time = $2`,
    [legacyTicker, legacyClose],
  );
  assert.equal(
    legacy.rows[0].entry_lean,
    null,
    "the migration does not reconstruct a side",
  );
  assert.equal(
    legacy.rows[0].entry_build_sha,
    null,
    "the migration does not invent provenance",
  );

  const build = "0123456789abcdef0123456789abcdef01234567";
  await db.query(
    `insert into desk_ledger
       (ticker, close_time, source, winner, chair_lean, chair_conf, score, bar,
        entry_lean, entry_build_sha, entry_cents, entry_conf, entry_score, entry_bar,
        settle_cents, ev_cents)
     values
       ('VALID-BOOKED', '2026-09-14T00:00:00Z', 'kalshi-result', 'UP', 'WAIT', 70, 0, 0.61,
        'UP', $1, 84, 82, 0.71, 0.60, 100, 14),
       ('VALID-WAIT', '2026-09-14T00:15:00Z', 'kalshi-result', 'DOWN', 'WAIT', 70, 0, 0.61,
        null, $1, null, null, null, null, null, null),
       ('EXCLUDED-BOOKED', '2026-09-14T00:30:00Z', 'kalshi-result', 'UP', 'WAIT', 70, 0, 0.61,
        'UP', $1, 84, 82, 0.71, 0.60, 100, 14)`,
    [build],
  );
  await db.query(
    `update desk_ledger
        set research_quality = 'excluded', research_quality_rule = 'test'
      where ticker = 'EXCLUDED-BOOKED'`,
  );

  const mirror = await db.query(
    `select ticker, entry_build_sha, lean, confidence, score, bar, hit, brier, ev_cents
       from desk_booked_chair_mirror order by close_time`,
  );
  assert.equal(
    mirror.rows.length,
    1,
    "legacy, WAIT, and excluded rows cannot enter the mirror",
  );
  assert.equal(mirror.rows[0].ticker, "VALID-BOOKED");
  assert.equal(mirror.rows[0].entry_build_sha, build);
  assert.equal(mirror.rows[0].lean, "UP");
  assert.equal(Number(mirror.rows[0].confidence), 82);
  assert.equal(Number(mirror.rows[0].score), 0.71);
  assert.equal(Number(mirror.rows[0].bar), 0.6);
  assert.equal(mirror.rows[0].hit, true);
  assert.ok(Math.abs(Number(mirror.rows[0].brier) - 0.0324) < 1e-9);
  assert.equal(Number(mirror.rows[0].ev_cents), 14);
  await db.close();
});
