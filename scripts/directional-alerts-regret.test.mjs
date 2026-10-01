import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
const require = createRequire(import.meta.url);
function loader(overrides = {}) {
  const cache = new Map();
  function load(file) {
    file = resolve(file);
    if (cache.has(file)) return cache.get(file);
    const mod = { exports: {} };
    cache.set(file, mod.exports);
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
    const req = (id) =>
      id in overrides
        ? overrides[id]
        : id.startsWith(".")
          ? load(resolve(dirname(file), id.endsWith(".ts") ? id : id + ".ts"))
          : require(id);
    new Function("require", "module", "exports", code)(req, mod, mod.exports);
    return mod.exports;
  }
  return load;
}
const load = loader();
const copy = load("src/lib/desk/alert-copy.ts");
const model = load("src/lib/desk/directional-regret.ts");
const { RegretJournal } = load("src/lib/desk/regret-journal.server.ts");
const close = Date.parse("2026-10-01T02:00:00Z");
test("approved titles and bodies are exact; tier badges and tags remain distinct", () => {
  const booked = copy.paperAlert("UP", 83, close);
  assert.equal(booked.title, "PAPER POSITION BOOKED · UP");
  assert.equal(
    booked.body,
    "Paper UP position booked at 83¢. Window closes 9:00 PM CT. Paper only — no live order.",
  );
  const read = copy.readAlert("DOWN", "75¢ ask is below the 80¢ paper floor", close);
  assert.equal(read.title, "DIRECTIONAL READ ONLY · DOWN");
  assert.equal(
    read.body,
    "Chair reads DOWN. No paper position booked: 75¢ ask is below the 80¢ paper floor. Window closes 9:00 PM CT. Research read only — not a fill or follower entry signal.",
  );
  assert.notEqual(booked.badge, read.badge);
  assert.equal(booked.badgeLabel, "BOOKED");
  assert.equal(read.badgeLabel, "READ ONLY");
  const sw = readFileSync("public/sw.js", "utf8");
  assert.match(sw, /badge: d.badge/);
  const ui = readFileSync("src/components/desk/AlertsPanel.tsx", "utf8");
  assert.match(ui, /<rect[^>]+fill="currentColor"/);
  assert.match(ui, /<path[^>]+fill="none"/);
});
test("every directional frame can be captured across all prices, exact ask preferred; WAIT and paid positions excluded", () => {
  for (const ask of [5.1, 65, 75, 80, 84, 90.1, 98.6]) {
    const row = model.regretObservation(
      {
        ticker: "T",
        as_of: close - 60000,
        close_time: close,
        yes_ask: Math.round(ask),
        yes_ask_exact: ask,
      },
      { lean: "UP" },
      ["blocked"],
      false,
    );
    assert.equal(row.ask, ask);
    assert.equal(
      model.regretNet("UP", ask, row.fee, "UP"),
      Math.round((100 - ask - row.fee) * 10) / 10,
    );
    assert.equal(
      model.regretNet("UP", ask, row.fee, "DOWN"),
      Math.round((-ask - row.fee) * 10) / 10,
    );
  }
  const paid = [{ ticker: "T", close_time: close, lean: "UP" }];
  assert.equal(
    model.directionAlreadyBooked(paid, { ticker: "T", close_time: close }, { lean: "UP" }),
    true,
  );
  assert.equal(
    model.directionAlreadyBooked(paid, { ticker: "T", close_time: close }, { lean: "DOWN" }),
    false,
    "opposite unbooked reads remain in regret ledger",
  );
  const s = { ticker: "T", as_of: close - 60000, close_time: close, yes_ask: 0, yes_mid: 80 };
  assert.equal(model.regretObservation(s, { lean: "WAIT" }, [], false), null);
  assert.equal(model.regretObservation(s, { lean: "UP" }, [], true), null);
  assert.equal(
    model.regretObservation(s, { lean: "UP" }, [], false).ask,
    null,
    "never substitute midpoint for executable ask",
  );
});
test("journal survives a database failure and restart; replay is idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "regret-journal-"));
  try {
    const j = new RegretJournal(root);
    await j.append({ id: 1 });
    await j.append({ id: 2 });
    await assert.rejects(
      j.drain(async () => {
        throw Error("SQL unavailable");
      }),
    );
    const recovered = new RegretJournal(root);
    const seen = new Set();
    await recovered.drain(async (r) => seen.add(r.id));
    assert.deepEqual([...seen], [1, 2]);
    assert.equal(recovered.pending, 0);
    const again = new RegretJournal(root);
    await again.drain(async (r) => seen.add(r.id));
    assert.equal(seen.size, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("actual report SQL: official settlement, real fees, bands, repeat-frame dedupe, later booking and missing asks", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(
      "create table desk_push_subs(on_read boolean); create table desk_push_delivery_receipts(event_kind text constraint desk_push_delivery_receipts_event_kind_check check(event_kind in ('call','test')));",
    );
    const migration = readFileSync("migrations/0069_directional_regret.sql", "utf8");
    await pg.exec(migration);
    await pg.exec(migration);
    await pg.exec(
      "create table desk_ledger(ticker text, close_time timestamptz, winner text, entry_cents double precision, source text); create view desk_ledger_research as select * from desk_ledger;",
    );
    const sql = async (strings, ...args) =>
      (
        await pg.query(
          strings.reduce((s, p, i) => s + p + (i < args.length ? "$" + (i + 1) : ""), ""),
          args,
        )
      ).rows;
    const reportModule = loader({
      "@/lib/db": { getSql: async () => sql },
      "./push.server": { notifyDirectionalRead: async () => {} },
    })("src/lib/desk/directional-regret.server.ts");
    const cases = [
      ["A", 75, "UP", "UP", false],
      ["B", 65, "DOWN", "UP", false],
      ["C", 85, "UP", "UP", true],
      ["D", null, "DOWN", "DOWN", false],
    ];
    for (const [ticker, ask, side, winner, booked] of cases) {
      const fee =
        ask == null
          ? null
          : model.regretObservation(
              { ticker, as_of: close - 60000, close_time: close, yes_ask: ask, no_ask: ask },
              { lean: side },
              ["blocked"],
              false,
            ).fee;
      for (const t of [close - 60000, close - 30000])
        await pg.query(
          "insert into desk_directional_regret(ticker,close_time,observed_at,side,ask_cents,fee_cents,reasons,build_sha,chair_stage) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [
            ticker,
            new Date(close),
            new Date(t),
            side,
            ask,
            fee,
            JSON.stringify(["75¢ ask is below the 80¢ paper floor"]),
            "sha",
            "final-chair",
          ],
        );
      await pg.query("insert into desk_ledger values($1,$2,$3,$4,$5)", [
        ticker,
        new Date(close),
        winner,
        booked ? 85 : null,
        "kalshi-result",
      ]);
    }
    const r = await reportModule.directionalRegretReport();
    const firstPage = await reportModule.directionalRegretReport(undefined, 1);
    assert.equal(firstPage.observations.length, 1);
    assert.equal(
      firstPage.observation_bands.reduce((s, b) => s + b.observations, 0),
      8,
      "totals cover entire ledger, not receipt page",
    );
    const secondPage = await reportModule.directionalRegretReport(firstPage.next_cursor, 1);
    assert.notDeepEqual(
      secondPage.observations[0],
      firstPage.observations[0],
      "keyset page advances without duplicating a receipt",
    );
    assert.equal(r.windows.length, 4);
    assert.equal(r.observations.length, 8, "every frame exposes its settled shadow result");
    assert.equal(r.observation_bands.find((b) => b.band === "70–79.9¢").net_cents, 46);
    assert.equal(
      r.observations.filter((o) => o.ticker === "D").every((o) => o.net_cents === null),
      true,
    );
    assert.equal(
      r.bands.reduce((s, b) => s + b.observations, 0),
      8,
    );
    assert.equal(r.bands.find((b) => b.band === "70–79.9¢").net_cents, 23);
    assert.equal(r.bands.find((b) => b.band === "<70¢").net_cents, -67);
    const later = r.bands.find((b) => b.band === "85–89.9¢");
    assert.equal(later.booked_later, 1);
    assert.equal(later.never_booked_net_cents, 0);
    assert.equal(r.bands.find((b) => b.band === "missing ask").missing_ask, 1);
    assert.equal(r.historical_complete, false);
  } finally {
    await pg.close();
  }
});
test("production wiring captures after both booking paths and never feeds research back into admission", () => {
  const s = readFileSync("src/lib/desk/server-engine.ts", "utf8");
  assert.ok(
    s.indexOf("void captureDirectionalRegret(snap") >
      s.indexOf("await noteRecoveryPilotCall(e, snap, pilot)"),
  );
  assert.match(
    s,
    /directionAlreadyBooked\(e.riskCalls, snap, chair\) && !e.riskReservationPending/,
  );
  assert.doesNotMatch(s, /await captureDirectionalRegret/);
});

test("real directional dispatch SQL: opt-in only, durable per-window/side dedupe, paper channel independent", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`create table desk_push_subs(id int, endpoint text, p256dh text, auth text, token text, owner boolean, on_call boolean, on_settle boolean, on_read boolean, fails int);
      create table desk_directional_read_events(ticker text,close_time timestamptz,side text,primary key(ticker,close_time,side));
      insert into desk_push_subs values(1,'https://push.invalid','key','auth',null,false,true,false,false,0)`);
    const db = async (strings, ...args) =>
      (
        await pg.query(
          strings.reduce((s, p, i) => s + p + (i < args.length ? "$" + (i + 1) : ""), ""),
          args,
        )
      ).rows;
    const src = readFileSync("src/lib/desk/push.server.ts", "utf8");
    const ast = ts.createSourceFile("push.server.ts", src, ts.ScriptTarget.Latest, true);
    const picked = ["subsFor", "notifyDirectionalRead"]
      .map((name) =>
        ast.statements
          .find((n) => ts.isFunctionDeclaration(n) && n.name?.text === name)
          .getText(ast)
          .replace(/^export /, ""),
      )
      .join("\n");
    const code = ts.transpileModule(picked, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const sent = [];
    const real = new Function(
      "sql",
      "MAX_FAILS",
      "readAlert",
      "fanout",
      code + "\nreturn {subsFor,notifyDirectionalRead};",
    )(
      async () => db,
      8,
      copy.readAlert,
      async (subs, pick) => {
        sent.push(...subs.map((s) => pick(s)));
      },
    );
    assert.equal((await real.subsFor("call")).length, 1);
    await real.notifyDirectionalRead("UP", "75¢ ask is below the 80¢ paper floor", close, "T");
    assert.equal(sent.length, 0, "legacy paper subscriber receives no new research tier");
    await pg.exec("update desk_push_subs set on_call=false,on_read=true");
    assert.equal((await real.subsFor("call")).length, 0);
    await real.notifyDirectionalRead("UP", "75¢ ask is below the 80¢ paper floor", close, "T");
    await real.notifyDirectionalRead("UP", "different blocker", close, "T");
    assert.equal(sent.length, 1, "repeated frames or restart do not send the read twice");
    assert.equal(sent[0].title, "DIRECTIONAL READ ONLY · UP");
    assert.equal(sent[0].tag, "read-T-UP");
    await real.notifyDirectionalRead("DOWN", "other direction", close, "T");
    assert.equal(sent.length, 2, "a genuine direction change has a distinct receipt");
  } finally {
    await pg.close();
  }
});
