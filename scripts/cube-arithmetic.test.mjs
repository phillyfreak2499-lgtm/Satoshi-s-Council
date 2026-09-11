/**
 * The cube's arithmetic, checked against the same arithmetic written in SQL.
 *
 * The cube's whole job is to be trusted with a slice of the ledger, and its
 * failure mode is silent: a cell that counts the wrong rows still prints a
 * plausible rate. So the counts, the net, the breakeven and the Wilson bounds
 * are all recomputed in Postgres over the same rows and required to agree.
 *
 * It also pins the cube's win definition to the one BOOKS already ships — a win
 * is a call that made money after fees, `ev_cents > 0`. The two surfaces
 * disagreeing about what a win is would be worse than either being wrong alone,
 * because the page would contradict itself and both numbers would look right.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

/** Deterministic rows spanning both eras and every price shelf. */
function makeRows(n, seed = 987) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const entry = Math.round((40 + rnd() * 58) * 100) / 100;
    const fee = Math.ceil(7 * (entry / 100) * (1 - entry / 100) * 100) / 100;
    const settled = rnd() > 0.25;
    const won = rnd() < entry / 100;
    const ev = settled
      ? won
        ? Math.round((100 - entry - fee) * 100) / 100
        : Math.round(-(entry + fee) * 100) / 100
      : Math.round((rnd() - 0.45) * 30 * 100) / 100;
    rows.push({
      i,
      entry,
      fee,
      ev,
      settled,
      legs: settled ? 1 : 2 + Math.floor(rnd() * 4),
      winner: won ? "UP" : "DOWN",
      side: settled ? (won ? "UP" : "DOWN") : null,
    });
  }
  return rows;
}

async function sqlSide(rows, minN) {
  const db = new PGlite();
  await db.exec(`create table r (i int, entry float8, fee float8, ev float8, settled bool)`);
  for (const r of rows) {
    await db.query(`insert into r values ($1,$2,$3,$4,$5)`, [r.i, r.entry, r.fee, r.ev, r.settled]);
  }
  const z = 1.959964;
  const res = await db.query(`
    with b as (
      select case when entry < 60 then '<60¢' when entry < 70 then '60-69¢'
                  when entry < 80 then '70-79¢' when entry < 90 then '80-89¢' else '90¢+' end as band,
             entry, fee, ev, (ev > 0)::int as win, entry + fee as cost
      from r
    ),
    g as (
      select band, count(*)::int as calls, sum(win)::int as wins,
             sum(ev) as net, avg(cost) as needs, avg(entry) as avg_entry
      from b group by band
    )
    select band, calls, wins, net, needs, avg_entry,
           100.0*wins/calls as hit,
           100.0 * ((wins::float/calls + ${z}*${z}/(2*calls))
                    - ${z}*sqrt(((wins::float/calls)*(1-wins::float/calls))/calls + ${z}*${z}/(4*calls*calls)))
                 / (1 + ${z}*${z}/calls) as lo,
           (calls >= ${minN}) as readable
    from g order by band
  `);
  await db.close();
  return res.rows;
}

test("every cell's counts, net, breakeven and Wilson bound match the same sums in SQL", async () => {
  const { MIN_CELL_N, cubeDim, priceBand } = await import("../src/lib/desk/cube.ts");
  const raw = makeRows(400);
  const rows = raw.map((r) => ({
    close_time: r.i * 900_000,
    side: r.side,
    legs: r.legs,
    settled: r.settled,
    winner: r.winner,
    entry: r.entry,
    ev: r.ev,
    conf: 70,
    score: 0.5,
    bar: 0.4,
    regime: null,
    secs_left: null,
    fair_yes: null,
    spread: null,
    leftover: null,
    touch: null,
    fee: r.fee,
    seats: {},
  }));
  const dim = cubeDim("price", rows, (r) => priceBand(r.entry));
  const want = await sqlSide(raw, MIN_CELL_N);
  assert.equal(dim.cells.length, want.length);
  const near = (a, b, what) => assert.ok(Math.abs(Number(a) - Number(b)) < 0.06, `${what}: module ${a} vs SQL ${b}`);
  for (const w of want) {
    const c = dim.cells.find((x) => x.key === w.band);
    assert.ok(c, `band ${w.band} missing`);
    assert.equal(c.calls, w.calls, `${w.band} calls`);
    assert.equal(c.wins, w.wins, `${w.band} wins`);
    near(c.net, w.net, `${w.band} net`);
    near(c.hit, w.hit, `${w.band} hit`);
    near(c.needs, w.needs, `${w.band} needs`);
    near(c.avg_entry, w.avg_entry, `${w.band} avg entry`);
    near(c.lo, w.lo, `${w.band} Wilson lower bound`);
    assert.equal(c.thin, !w.readable, `${w.band} readable`);
    // The rule the cube claims: a cell clears only when the whole interval is
    // above its own breakeven.
    assert.equal(c.clears, Boolean(w.readable) && Number(w.lo) > Number(w.needs), `${w.band} clears`);
  }
});

test("the cube counts a win the same way BOOKS does", () => {
  // BOOKS ships `count(*) filter (where entry_cents is not null and ev_cents > 0)`.
  // If the cube ever counted a side match instead, the two surfaces would print
  // different win rates off the same ledger and both would look correct.
  const books = read("src/lib/desk/books.server.ts");
  assert.match(books, /filter \(where entry_cents is not null and ev_cents > 0\)/, "BOOKS changed how it counts a win");
  const cube = read("src/lib/desk/cube.ts");
  assert.match(cube, /const wins = filled\.filter\(\(r\) => \(r\.ev \?\? 0\) > 0\)\.length;/);
  // And it must not have quietly gone back to comparing the side.
  assert.ok(!/r\.side === r\.winner/.test(cube), "the cube is counting wins by side again");
});

test("a side is only recovered from a settlement that actually is one", () => {
  // bookedSideOf reads 0/100 as "the side it held won / lost". Run on a position
  // exited at 68¢ that rule invents a side out of a number that carries none.
  const srv = read("src/lib/desk/cube.server.ts");
  assert.match(srv, /const settled = \(settle === 0 \|\| settle === 100\) && legs === 1;/);
  assert.match(srv, /const decided = settled \? chairDecisionOf\(/);
  // Those rows keep their cents: dropping them would hide the era that lost most.
  const cube = read("src/lib/desk/cube.ts");
  assert.match(cube, /const filled = rows\.filter\(\(r\) => r\.entry != null && r\.ev != null\);/);
});

test("the look-elsewhere count is in the payload and cannot be dropped", async () => {
  const { buildCube, cubeDim } = await import("../src/lib/desk/cube.ts");
  const rows = makeRows(60).map((r) => ({
    close_time: r.i * 900_000, side: r.side, legs: r.legs, settled: r.settled, winner: r.winner,
    entry: r.entry, ev: r.ev, conf: 70, score: 0.5, bar: 0.4, regime: null, secs_left: null,
    fair_yes: null, spread: null, leftover: null, touch: null, fee: r.fee, seats: {},
  }));
  const c = buildCube(rows, [cubeDim("all", rows, () => "cell")]);
  assert.ok(c.look_elsewhere.verdict.length > 20);
  assert.equal(typeof c.look_elsewhere.expected_by_chance, "number");
  const srv = read("src/lib/desk/cube.server.ts");
  assert.match(srv, /Read look_elsewhere before any cell/);
});
