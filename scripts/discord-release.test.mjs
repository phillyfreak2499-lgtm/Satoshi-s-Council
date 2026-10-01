// Durable owner-set Discord release (0072) + one research-outlook post per 15-minute window.
// Synthetic endpoints only; no test makes a network request or writes to the repo tree.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
const require = createRequire(import.meta.url);
function loader(overrides = {}) {
  const cache = new Map();
  return function load(file) {
    file = resolve(file);
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const req = (id) => {
      if (id in overrides) return overrides[id];
      if (id.startsWith(".")) {
        const path = resolve(dirname(file), id);
        return load(existsSync(path) ? path : path + ".ts");
      }
      return require(id);
    };
    new Function("require", "exports", code)(req, exports);
    return exports;
  };
}
const load = loader();
const lib = load("src/lib/desk/discord-posts.ts");
const { DiscordOutbox } = load("src/lib/desk/discord-outbox.server.ts");
const release = load("src/lib/desk/discord-release.server.ts");
const verification = load("src/lib/desk/alert-verification.server.ts");
const buildA = "a".repeat(40), buildB = "b".repeat(40);
const url = (id) => `https://discord.com/api/webhooks/${id}/${"fake-token-".repeat(4)}`;
const paper = lib.webhookTarget(url("111111111111111111"));
const read = lib.webhookTarget(url("222222222222222222"));
const accepted = { ok: true, status: 200, retryMs: 0, terminal: false, message: "fake-message", code: "accepted" };
const sqlOf = (pg) => {
  const db = async (parts, ...args) => (await pg.query(parts.reduce((s, p, i) => s + p + (i < args.length ? `$${i + 1}` : ""), ""), args)).rows;
  db.query = async (sql, args = []) => (await pg.query(sql, args)).rows;
  return db;
};
const releaseSql = readFileSync("migrations/0072_discord_release.sql", "utf8");
async function fixture(t, { push = false } = {}) {
  const pg = new PGlite(); t.after(() => pg.close());
  if (push) for (const m of ["0015_desk_push.sql", "0018_desk_push_owner.sql", "0066_desk_push_delivery_receipts.sql", "0069_directional_regret.sql"])
    await pg.exec(readFileSync("migrations/" + m, "utf8"));
  await pg.exec(readFileSync("migrations/0070_discord_outbox.sql", "utf8"));
  await pg.exec(releaseSql);
  await pg.exec(`create table desk_ledger(ticker text,close_time timestamptz,entry_lean text,entry_source text,winner text,ev_cents double precision,graded_at timestamptz,research_quality text,entry_cents double precision default 83);
    create view desk_ledger_research as select * from desk_ledger where research_quality='valid';`);
  const db = sqlOf(pg);
  let now = Date.now();
  const calls = [];
  const outbox = (build) => new DiscordOutbox(db, { build, paper, read }, () => release.discordReleased(db), () => now,
    async (u, p) => { calls.push({ u, p }); return accepted; }, () => {});
  return { pg, db, calls, outbox, time: () => now, advance: (ms) => (now += ms),
    rows: () => db.query("select * from desk_discord_outbox order by event_key") };
}
const leanOf = (seat, score, w, extra = {}) => ({ seat, score, direction: score == null ? "NO_READ" : score > 50 ? "BULLISH" : score < 50 ? "BEARISH" : "NEUTRAL",
  window: w, statusPlain: "Research only", stale: false, ...extra });
const paperAt = (f, build, ticker, close, side = "UP", source = null) => lib.paperEvent(side, 83, close, f.time(), ticker, source, build, paper.hash);

test("0072 is one new table only, applies repeatedly, and seeds nothing (default HELD)", async (t) => {
  const body = releaseSql.replace(/--[^\n]*/g, "");
  assert.doesNotMatch(body, /\balter\b|\bdrop\b|\bupdate\b|\bdelete\b|\binsert\b/i);
  const f = await fixture(t);
  await f.pg.exec(releaseSql);
  assert.equal((await f.db.query("select count(*)::int n from desk_discord_release"))[0].n, 0);
  assert.equal(await release.discordReleased(f.db), false);
  const s = await release.discordReleaseControl(f.db, { action: "status" });
  assert.equal(s.ok, true); assert.equal(s.held, true);
  // Held by default: a booked paper call is queued as held and nothing is posted.
  const o = f.outbox(buildA);
  await o.enqueue(paperAt(f, buildA, "W1", f.time() + 600000)); await o.drain();
  assert.equal(f.calls.length, 0);
  assert.equal((await f.rows())[0].state, "held");
  assert.equal((await f.rows())[0].error_code, null);
  await o.enqueue({ ...paperAt(f, buildA, "W2", f.time() + 600000) }); await o.drain();
  assert.equal((await f.rows()).every((r) => r.state === "held"), true);
});

test("owner release survives a new deployed commit: no per-commit row is needed for Discord", async (t) => {
  const f = await fixture(t);
  const r = await release.discordReleaseControl(f.db, { action: "release" }, f.time());
  assert.equal(r.ok, true); assert.equal(r.held, false);
  f.advance(1000);
  const a = f.outbox(buildA);
  await a.enqueue(paperAt(f, buildA, "W1", f.time() + 600000)); await a.drain();
  assert.equal(f.calls.length, 1);
  // Simulated deploy: a different RENDER_GIT_COMMIT, and no desk_alert_rollout table exists at all.
  assert.equal((await f.db.query("select to_regclass('desk_alert_rollout') t"))[0].t, null);
  f.advance(1000);
  const b = f.outbox(buildB);
  await b.enqueue(paperAt(f, buildB, "W2", f.time() + 600000)); await b.drain();
  assert.equal(f.calls.length, 2);
  assert.deepEqual((await f.rows()).map((x) => x.state), ["sent", "sent"]);
  // Re-release keeps the original release time; hold then stops delivery durably.
  const before = (await f.db.query("select released_at from desk_discord_release"))[0].released_at;
  await release.discordReleaseControl(f.db, { action: "release" }, f.time());
  assert.deepEqual((await f.db.query("select released_at from desk_discord_release"))[0].released_at, before);
  await release.discordReleaseControl(f.db, { action: "hold" }, f.time());
  await b.enqueue(paperAt(f, buildB, "W3", f.time() + 600000)); await b.drain();
  assert.equal(f.calls.length, 2);
  assert.equal((await release.discordReleaseControl(f.db, { action: "bogus" })).ok, false);
});

test("web push still requires the per-commit two-tier rollout row even when Discord is released", async (t) => {
  const f = await fixture(t, { push: true });
  await f.pg.exec("insert into desk_push_subs(endpoint,p256dh,auth,owner,on_call,on_settle,fails) values ('https://push.invalid/owner','k','a',true,true,true,0)");
  await release.discordReleaseControl(f.db, { action: "release" }, f.time());
  assert.equal(await release.discordReleased(f.db), true);
  assert.equal(await verification.rolloutReady(f.db, buildA), false);
  assert.equal(await verification.rolloutReady(f.db, buildB), false);
  // The existing owner two-tier flow still releases web push for exactly one commit.
  const send = async () => ({ outcome: "accepted", statusCode: 201, errorCode: null });
  const owner = { endpoint: "https://push.invalid/owner" };
  const v = await verification.ownerVerification(f.db, send, buildA, { ...owner, action: "verify", confirm_test_fixtures: true });
  const rel = await verification.ownerVerification(f.db, send, buildA, { ...owner, action: "release", verification_id: v.verification_id, confirm_device_display: true });
  assert.equal(rel.held, false);
  assert.equal(await verification.rolloutReady(f.db, buildA), true);
  assert.equal(await verification.rolloutReady(f.db, buildB), false);
  // Holding Discord does not touch the web-push row, and vice versa.
  await release.discordReleaseControl(f.db, { action: "hold" }, f.time());
  assert.equal(await verification.rolloutReady(f.db, buildA), true);
  await verification.ownerVerification(f.db, send, buildA, { ...owner, action: "hold" });
  await release.discordReleaseControl(f.db, { action: "release" }, f.time());
  assert.equal(await verification.rolloutReady(f.db, buildA), false);
  assert.equal(await release.discordReleased(f.db), true);
  // Web push's gate code is not coupled to the Discord flag in either direction.
  const av = readFileSync("src/lib/desk/alert-verification.server.ts", "utf8");
  const push = readFileSync("src/lib/desk/push.server.ts", "utf8");
  assert.doesNotMatch(av + push, /desk_discord_release|discord-release/);
  assert.match(av, /where r\.build_sha=\$\{build\} and a\.build_sha=\$\{build\} and r\.device_display_confirmed/);
  assert.match(push, /subscriberAlertsReleased/);
  const discordSrc = readFileSync("src/lib/desk/discord-outbox.server.ts", "utf8") + readFileSync("src/lib/desk/discord-posts.server.ts", "utf8");
  assert.doesNotMatch(discordSrc, /rolloutReady|desk_alert_rollout/);
});

test("at most one directional-read post per 15-minute window, however often leans change", async (t) => {
  const f = await fixture(t);
  await release.discordReleaseControl(f.db, { action: "release" }, f.time() - 1);
  const o = f.outbox(buildA);
  const start = f.time();
  const seats = ["DRIFT", "TAPE", "WICK", "INDEX", "CASCADE"];
  for (const k of [0, 1]) {
    const close = start + (k + 1) * 900000;
    for (let at = close - 900000; at < close; at += 5000) {
      const w = { ticker: `KX-W${k}`, close_time: close, as_of: at };
      const leans = seats.map((s, i) => leanOf(s, 20 + ((at / 5000 + i * 7) % 60)|0, w));
      const e = lib.readSummaryEvent(leans, "WAIT", w, buildA, read.hash);
      if (e) await o.enqueue(e);
    }
    f.advance(close - 60000 - f.time()); // the worker drains in real time, before the window closes
    await o.drain(); await o.drain();
  }
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every((c) => c.u === read.url));
  assert.equal((await f.rows()).filter((r) => r.kind === "read").length, 2);
  // Summary is never taken earlier than 10 minutes before close, nor without a directional lean.
  const w = { ticker: "X", close_time: start + 900000, as_of: start };
  assert.equal(lib.readSummaryDue(w, [leanOf("DRIFT", 30, w)]), false);
  const late = { ...w, as_of: w.close_time - lib.READ_SUMMARY_MS_LEFT };
  assert.equal(lib.readSummaryDue(late, [leanOf("DRIFT", 30, late)]), true);
  assert.equal(lib.readSummaryDue(late, [leanOf("DRIFT", 50, late), leanOf("TAPE", null, late)]), false);
});

test("live publication hook journals one summary per window across ~180 ticks", async () => {
  const appended = [];
  class FakeJournal { constructor() {} async append(e) { appended.push(e); } async drain() {} }
  let leansNow = [];
  const env = { ...process.env };
  process.env.DISCORD_DIRECTIONAL_READS_WEBHOOK = url("222222222222222222");
  process.env.DISCORD_PAPER_CALLS_WEBHOOK = url("111111111111111111");
  process.env.RENDER_GIT_COMMIT = buildA;
  const server = loader({
    "@/lib/db": { getSql: async () => { throw Error("no db in test"); } },
    "./regret-journal.server": { RegretJournal: FakeJournal },
    "./pro-floor": { seatFacts: () => [] },
    "./seat-lean": { seatDirectionalLeans: () => leansNow },
  })("src/lib/desk/discord-posts.server.ts");
  const errors = console.error; console.error = () => {};
  const t0 = Date.now() + 3600000;
  try {
    for (const k of [0, 1]) {
      const close = t0 + (k + 1) * 900000;
      for (let at = close - 900000; at < close; at += 5000) {
        const w = { ticker: `KX-L${k}`, close_time: close, as_of: at };
        leansNow = [leanOf("DRIFT", 20 + (at / 5000) % 25, w), leanOf("TAPE", 80 - (at / 5000) % 25, w)];
        server.publishDiscordLeans({ ticker: w.ticker, close_time: close, as_of: at, demo: false }, [], { lean: "WAIT" }, {});
      }
    }
    await new Promise((r) => setTimeout(r, 50));
  } finally { console.error = errors; process.env = env; }
  assert.equal(appended.length, 2);
  assert.deepEqual(appended.map((e) => e.key), [`readwin|KX-L0|${t0 + 900000}`, `readwin|KX-L1|${t0 + 1800000}`]);
  // Taken on the first eligible frame: exactly 10 minutes before close.
  assert.deepEqual(appended.map((e) => e.close - e.observed), [lib.READ_SUMMARY_MS_LEFT, lib.READ_SUMMARY_MS_LEFT]);
  assert.ok(appended.every((e) => e.kind === "read" && e.key.startsWith(lib.READ_SUMMARY_PREFIX)));
});

test("one post per booked paper call: no aggregation, duplicates deduped, held call delivered once on release", async (t) => {
  const f = await fixture(t);
  const o = f.outbox(buildA);
  const held = paperAt(f, buildA, "W0", f.time() + 600000, "DOWN");
  await o.enqueue(held); await o.drain();
  f.advance(1000);
  await release.discordReleaseControl(f.db, { action: "release" }, f.time());
  f.advance(1000);
  const calls = ["W1", "W2", "W3"].map((w, i) => paperAt(f, buildA, w, f.time() + 600000 + i, i % 2 ? "DOWN" : "UP"));
  for (const e of calls) { await o.enqueue(e); await o.enqueue(e); }
  // The same window can carry a separately sourced pilot call; it is its own post.
  await o.enqueue(paperAt(f, buildA, "W1", calls[0].close, "UP", "RECOVERY_FAV85_V1"));
  for (let i = 0; i < 3; i++) await o.drain();
  const posted = f.calls.filter((c) => c.u === paper.url);
  assert.equal(posted.length, 5);
  assert.equal(new Set(posted.map((c) => JSON.stringify(c.p))).size, 5);
  assert.ok(posted.every((c) => c.p.embeds.length === 1));
  // The call held before release posts once, labelled late; the four booked after release are normal.
  assert.equal(posted.filter((c) => c.p.embeds[0].title.startsWith("LATE · ")).length, 1);
  assert.equal(posted.filter((c) => /^■ PAPER POSITION BOOKED · (UP|DOWN)$/.test(c.p.embeds[0].title)).length, 4);
});

test("release does not flood: 1,049 held reads collapse, held unexpired paper calls post once, expired ones do not", async (t) => {
  const f = await fixture(t);
  const now = f.time();
  // Mirror the steward-reported backlog: per-seat read rows held under older builds.
  await f.db.query(`insert into desk_discord_outbox(event_key,kind,ticker,close_time,seat,side,source,observed_at,build_sha,target_hash,payload,state,expires_at,error_code)
    select 'read|KX-'||g||'|DRIFT','read','KX-'||g,$1::timestamptz - (g||' minutes')::interval,'DRIFT','UP',null,$1::timestamptz - (g||' minutes')::interval - interval '5 minutes',
      $2,$3,'{"username":"x","allowed_mentions":{"parse":[]},"embeds":[]}'::jsonb,'held',$1::timestamptz - (g||' minutes')::interval,'rollout_held'
    from generate_series(1,1049) g`, [new Date(now), "c".repeat(40), read.hash]);
  const fresh = { ...paperAt(f, "c".repeat(40), "KX-FRESH", now - 3600000), observed: now - 3700000 };
  const stale = { ...paperAt(f, "c".repeat(40), "KX-STALE", now - 2 * 86400000), observed: now - 2 * 86400000 - 60000, expires: now - 86400000 };
  const o = f.outbox(buildA);
  await o.enqueue(fresh); await o.enqueue(stale);
  assert.equal((await f.db.query("select count(*)::int n from desk_discord_outbox where state='held'"))[0].n, 1051);
  const r = await release.discordReleaseControl(f.db, { action: "release" }, now);
  assert.deepEqual(r.backlog, { reads_collapsed: 1049, paper_requeued: 1, paper_expired: 1 });
  for (let i = 0; i < 5; i++) { f.advance(1000); await o.drain(); }
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].u, paper.url);
  assert.equal(f.calls.filter((c) => c.u === read.url).length, 0);
  const byState = await f.db.query("select kind,state,error_code,count(*)::int n from desk_discord_outbox group by 1,2,3 order by 1,2,3");
  assert.deepEqual(byState, [
    { kind: "paper", state: "expired", error_code: "expired_while_held", n: 1 },
    { kind: "paper", state: "sent", error_code: "accepted", n: 1 },
    { kind: "read", state: "expired", error_code: "collapsed_on_release", n: 1049 },
  ]);
  // A second release finds nothing left to replay.
  const again = await release.discordReleaseControl(f.db, { action: "release" }, f.time());
  assert.deepEqual(again.backlog, { reads_collapsed: 0, paper_requeued: 0, paper_expired: 0 });
});

test("post copy keeps research outlook, SATOSHI decision and paper position distinct; nothing reads like a real trade", () => {
  const now = Date.now(), w = { ticker: "KX-X", close_time: now + 300000, as_of: now };
  const leans = [leanOf("DRIFT", 35, w), leanOf("TAPE", 71, w, { stale: true }), leanOf("WICK", 50, w), leanOf("INDEX", null, w)];
  const field = (p, name) => p.embeds[0].fields.find((x) => x.name === name)?.value;
  const wait = lib.readSummaryEvent(leans, "WAIT", w, buildA, read.hash).payload;
  const up = lib.readSummaryEvent(leans, "UP", w, buildA, read.hash).payload;
  assert.equal(field(wait, "Research outlook · seat leans"), "TAPE 71 · Bullish (stale feed)\nDRIFT 35 · Bearish");
  assert.equal(field(wait, "Seat count"), "1 bullish · 1 bearish · 2 neutral or no read");
  assert.match(field(wait, "SATOSHI decision · Chair"), /^WAIT — SATOSHI is not making a call/);
  assert.match(field(up, "SATOSHI decision · Chair"), /^UP — the Chair's call on this frame\. It is a paper position only if booked\./);
  assert.match(field(up, "Paper position"), /^None in this post\. Booked paper calls post separately/);
  assert.match(wait.embeds[0].description, /Research only.*not probabilities.*Not a SATOSHI call and not a paper position.*no real trades/);
  const chairCall = lib.paperEvent("UP", 83, now + 60000, now, "KX-X", null, buildA, paper.hash).payload;
  const pilot = lib.paperEvent("DOWN", 85, now + 60000, now, "KX-X", "RECOVERY_FAV85_V1", buildA, paper.hash).payload;
  assert.match(chairCall.embeds[0].title, /^■ PAPER POSITION BOOKED · UP$/);
  assert.match(chairCall.embeds[0].description, /No live trade: paper only, no real order or money/);
  assert.equal(field(chairCall, "SATOSHI decision"), "UP — the Chair decision at the original booking time.");
  assert.equal(field(pilot, "SATOSHI decision"), "Not recorded here. RECOVERY_FAV85_V1 is a paper pilot, not a SATOSHI Chair decision.");
  assert.notEqual(wait.embeds[0].color, chairCall.embeds[0].color);
  for (const p of [wait, up, chairCall, pilot]) {
    const text = JSON.stringify(p);
    assert.doesNotMatch(text, /\b(buy|sell|bought|sold|executed|live position|real position)\b/i);
    assert.match(p.embeds[0].footer.text, /Paper-only/);
  }
});

test("owner route: admin key required; release/hold/status only through it", async (t) => {
  const f = await fixture(t);
  const env = { ...process.env };
  process.env.DESK_ADMIN_KEY = "owner-test-key";
  t.after(() => { process.env = env; });
  const route = loader({
    "../../../src/lib/desk/admin.server": load("src/lib/desk/admin.server.ts"),
    "../../../src/lib/db": { getSql: async () => f.db },
    "../../../src/lib/desk/discord-release.server": release,
  })("server/routes/api/discord-release.post.ts");
  const call = async (body) => { const r = await route.default({ req: new Request("http://x/api/discord-release", { method: "POST", body: JSON.stringify(body) }) }); return { status: r.status, body: await r.json() }; };
  assert.equal((await call({ action: "release" })).status, 401);
  assert.equal((await call({ key: "wrong-key-same-len", action: "release" })).status, 401);
  assert.equal(await release.discordReleased(f.db), false);
  const ok = await call({ key: "owner-test-key", action: "release" });
  assert.equal(ok.status, 200); assert.equal(ok.body.held, false);
  assert.equal(await release.discordReleased(f.db), true);
  assert.equal((await call({ key: "owner-test-key", action: "status" })).body.held, false);
  assert.equal((await call({ key: "owner-test-key", action: "hold" })).body.held, true);
  assert.equal((await call({ key: "owner-test-key", action: "nope" })).status, 400);
  delete process.env.DESK_ADMIN_KEY;
  assert.equal((await call({ key: "owner-test-key", action: "release" })).status, 503);
  assert.equal(await release.discordReleased(f.db), false);
});

// ---- Late (held, posted after release) paper calls and settlements ----
const field = (p, name) => p.embeds[0].fields.find((x) => x.name === name)?.value;
const LIVE_WORDS = /\b(now|live|new call)\b/i;
async function lateFixture(t, { bookedAgo = 3 * 3600000, closeAgo = 2 * 3600000, ledger = null, source = null } = {}) {
  const f = await fixture(t);
  const now = f.time();
  const booked = now - bookedAgo, close = now - closeAgo;
  const e = { ...lib.paperEvent("UP", 83, close, booked, "KX-LATE", source, "c".repeat(40), paper.hash) };
  const o = f.outbox(buildA);
  await o.enqueue(e); // held: Discord flag not yet released
  if (ledger) await f.db.query("insert into desk_ledger(ticker,close_time,entry_lean,entry_source,winner,ev_cents,graded_at,research_quality) values ($1,$2,'UP',$3,$4,$5,$6,'valid')",
    ["KX-LATE", new Date(close), source, ledger.winner, ledger.net, new Date(close + 60000)]);
  await release.discordReleaseControl(f.db, { action: "release" }, now);
  return { ...f, o, e, booked, close, now };
}

test("late paper call: label leads the title, booked time in CT, grey embed, recorded outcome shown, layers separate", async (t) => {
  const f = await lateFixture(t, { ledger: { winner: "UP", net: 17 } });
  f.advance(1000); await f.o.drain();
  const late = f.calls.find((c) => c.u === paper.url).p;
  assert.equal(late.embeds[0].title, "LATE · ALREADY SETTLED · posted after release, not a current call");
  assert.equal(late.embeds[0].fields[0].name, "Originally booked (CT)");
  assert.equal(late.embeds[0].fields[0].value, lib.centralTime(f.booked));
  assert.match(late.embeds[0].fields[0].value, /^[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2} (AM|PM) CT$/);
  assert.equal(field(late, "Settled outcome"), "UP · paper WIN · +17.0¢ net after fees");
  assert.equal(late.embeds[0].color, lib.LATE_COLOR);
  assert.notEqual(late.embeds[0].color, 0x16a34a);
  assert.doesNotMatch(JSON.stringify(late), LIVE_WORDS);
  assert.match(late.embeds[0].description, /^■ Paper position booked earlier · UP\. .*Paper only, no real order or money\.$/);
  assert.equal(field(late, "SATOSHI decision"), "UP — the Chair decision at the original booking time.");
  assert.match(field(late, "Research outlook"), /^Not recorded in this post\. Seat leans are research only/);
  assert.equal(field(late, "Entry"), "83.0¢");
  // Embed timestamp stays the original booking time, never the posting time.
  assert.equal(late.embeds[0].timestamp, new Date(f.booked).toISOString());
  // Its settlement follow-up (graded before release) is late too: label first, booked time from the parent.
  f.advance(1000); await f.o.drain();
  const settle = f.calls.filter((c) => c.u === paper.url)[1].p;
  assert.equal(settle.embeds[0].title, lib.LATE_LABEL);
  assert.equal(field(settle, "Originally booked (CT)"), lib.centralTime(f.booked));
  assert.equal(field(settle, "Settled outcome"), "UP · paper WIN · +17.0¢ net after fees");
  assert.match(settle.embeds[0].description, /^■ Paper position settled · WIN\./);
  assert.equal(settle.embeds[0].color, lib.LATE_COLOR);
  assert.doesNotMatch(JSON.stringify(settle), LIVE_WORDS);
});

test("late paper call with no recorded settlement says so plainly and invents no outcome", async (t) => {
  const f = await lateFixture(t);
  f.advance(1000); await f.o.drain();
  const late = f.calls[0].p;
  assert.equal(late.embeds[0].title, lib.LATE_LABEL);
  assert.equal(field(late, "Settled outcome"), "Not known: no recorded settlement for this window was found when this was posted.");
  assert.doesNotMatch(JSON.stringify(late), /\bWIN\b|\bLOSS\b/);
  // A loss is reported as a loss when recorded.
  const g = await lateFixture(t, { ledger: { winner: "DOWN", net: -83 } });
  g.advance(1000); await g.o.drain();
  assert.equal(field(g.calls[0].p, "Settled outcome"), "DOWN · paper LOSS · -83.0¢ net after fees");
  // A window that has not closed yet is never called settled.
  const h = await lateFixture(t, { bookedAgo: 120000, closeAgo: -300000 });
  h.advance(1000); await h.o.drain();
  assert.equal(h.calls[0].p.embeds[0].title, lib.LATE_OPEN_LABEL);
  assert.equal(field(h.calls[0].p, "Settled outcome"), `Not settled yet: the window closes ${lib.centralTime(h.close)}.`);
  assert.doesNotMatch(JSON.stringify(h.calls[0].p), LIVE_WORDS);
});

test("late marking survives a restart: derived from durable outbox and release rows only", async (t) => {
  const f = await lateFixture(t);
  let attempts = 0; const posted = [];
  const flaky = new DiscordOutbox(f.db, { build: buildA, paper, read }, () => release.discordReleased(f.db), f.time,
    async (u, p) => { posted.push(p); return ++attempts === 1 ? { ...accepted, ok: false, status: 429, retryMs: 1000, code: "rate_limited" } : accepted; }, () => {});
  f.advance(1000); await flaky.drain();
  // New process (and new deploy) retries the same row: still late.
  const restarted = new DiscordOutbox(f.db, { build: buildB, paper, read }, () => release.discordReleased(f.db), f.time,
    async (u, p) => { posted.push(p); return accepted; }, () => {});
  f.advance(2000); await restarted.drain();
  assert.equal(posted.length, 2);
  assert.ok(posted.every((p) => p.embeds[0].title === lib.LATE_LABEL));
  assert.equal((await f.rows()).find((r) => r.event_key === f.e.key).state, "sent");
});

test("normal (non-late) paper calls and settlements are byte-identical to the stored payload", async (t) => {
  const f = await fixture(t);
  await release.discordReleaseControl(f.db, { action: "release" }, f.time() - 1000);
  const o = f.outbox(buildA);
  const e = paperAt(f, buildA, "KX-NORMAL", f.time() + 600000);
  await o.enqueue(e); f.advance(5000); await o.drain(); // queued rows default next_attempt to DB now()
  assert.deepEqual(f.calls[0].p, e.payload);
  assert.equal(f.calls[0].p.embeds[0].title, "■ PAPER POSITION BOOKED · UP");
  assert.equal(f.calls[0].p.embeds[0].color, 0x16a34a);
  assert.equal(f.calls[0].p.embeds[0].description, "Recorded paper fill. No live trade: paper only, no real order or money.");
  assert.equal(field(f.calls[0].p, "Originally booked (CT)"), undefined);
  await f.db.query("insert into desk_ledger(ticker,close_time,entry_lean,entry_source,winner,ev_cents,graded_at,research_quality) values ($1,$2,'UP',null,'UP',17,$3,'valid')",
    [e.ticker, new Date(e.close), new Date(f.time() + 1000)]);
  f.advance(30000); await o.drain(); await o.drain(); // settle rows default next_attempt to DB now()
  assert.match(f.calls[1].p.embeds[0].title, /^■ PAPER POSITION SETTLED · WIN$/);
  assert.notEqual(f.calls[1].p.embeds[0].color, lib.LATE_COLOR);
});

test("24h cutoff unchanged: held paper past close+24h expires on release; just inside posts once, late", async (t) => {
  const f = await fixture(t);
  const now = f.time(), day = 86400000;
  const e = lib.paperEvent("UP", 83, now, now, "KX", null, buildA, paper.hash);
  assert.equal(e.expires - e.close, day);
  const inside = lib.paperEvent("UP", 83, now - day + 60000, now - day, "KX-IN", null, buildA, paper.hash);
  const outside = lib.paperEvent("DOWN", 83, now - day - 60000, now - day - 120000, "KX-OUT", null, buildA, paper.hash);
  const o = f.outbox(buildA);
  await o.enqueue(inside); await o.enqueue(outside);
  const r = await release.discordReleaseControl(f.db, { action: "release" }, now);
  assert.deepEqual(r.backlog, { reads_collapsed: 0, paper_requeued: 1, paper_expired: 1 });
  f.advance(1000); await o.drain(); await o.drain();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].p.embeds[0].title, lib.LATE_LABEL);
  assert.equal(field(f.calls[0].p, "Window"), "KX-IN");
});

