// QUIET_CALL_LEDGER_V1 — unit tests (spec rev 3 §11, items 1–27).
//
// RESEARCH ONLY, authority NONE. Every fixture here is SYNTHETIC. The module
// under test records one directional "quiet call" per seat per window, grades
// it at settlement, and diagnoses; it never votes, weighs, gates or books.
//
// Loaded through Vite like the other learner-adjacent rails: quiet-call.ts
// reaches the seat readers through the extensionless desk import graph, which
// the pure strip-types runner cannot resolve (learner-quality-gate.test.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

let vite;
let mods;
async function load() {
  if (mods) return mods;
  const { createServer } = await import("vite");
  vite = await createServer({ envDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  const [q, learner, skills, clock, structure, tape, derivs, context, patterns, types] = await Promise.all([
    "quiet-call", "learner", "skills", "clock", "structure", "tape", "derivs", "context", "patterns", "types",
  ].map((n) => vite.ssrLoadModule(`/src/lib/desk/${n}.ts`)));
  mods = { q, learner, skills, clock, structure, tape, derivs, context, patterns, types };
  return mods;
}
test.after(async () => { await vite?.close(); });

const CLOSE = Date.parse("2026-10-05T14:00:00Z");
const TICKER = "KXBTC15M-26OCT051000-00";

/** A neutral, fully-formed SYNTHETIC snapshot. Readers see flat inputs. */
function snap(over = {}) {
  const asOf = over.as_of ?? CLOSE - 11.5 * 60_000;
  return {
    as_of: asOf, close_time: CLOSE, ticker: TICKER, mins_left: (CLOSE - asOf) / 60_000, secs_left: (CLOSE - asOf) / 1000,
    phase: "MID", kalshi_host: "", kalshi_trade_n: 0, kalshi_taker_yes: 0, official_settles: [],
    spot: 80_000, spot_source: "x", strike: 80_000, spot_age_s: 1, quote_age_s: 1, print_age_s: 1, quote_seq: 1,
    yes_ask: 52, yes_bid: 50, no_ask: 50, no_bid: 48, yes_mid: 51, yes_mid_path: [], spread_cents: 2,
    leftover_cents: 2, combined_ask_cents: 102, chalk: false, yes_bid_size: 5, no_bid_size: 5,
    health: { spot_ok: true, kalshi_ok: true, spot: "LIVE", kalshi: "LIVE", derivs: "LIVE", spot_divergent: false, basis_wide: false },
    regime_key: "US_AM_MID", clock_key: "US_AM_1", session: "US_AM", demo: false,
    ret5: 0, ret15: 0, ret30: 0, ret1h: 0, atr: 40, atr_pct: 0.15,
    vol_median: 1, vol_last: 1, vol_percentile: 50, location: "MID", range_pos: 0.5,
    imbalance: 0, imbalance_hist: [], candles_1m: [], candles_5m: [], window_memory: { prior_settles: [] },
    funding_rate: 0, funding_apr: 0, funding_time: asOf, funding_history: [], funding_series: [],
    open_interest: 1, oi_usd: 1, oi_history: [], oi_series: [], oi_usd_series: [],
    oi_delta_3m: 0, oi_delta_10m: 0, oi_delta_1h: 0, oi_usd_delta_10m: 0,
    liq_long_usd: 0, liq_short_usd: 0, liq_n: 0, liq_source: "DOWN", force_n: 0, cascade_proxy: false,
    fear_greed: 50, fear_greed_label: "Neutral", fng_history: [], spot_lead_bps: 0,
    ...over,
  };
}

/** A SYNTHETIC vote with the pipeline's raw-read fields. */
function vote(seat, over = {}) {
  return {
    seat, lean: "WAIT", confidence: 0, features: {}, reasoning: "SYNTHETIC", skill_used: "SIT", skill_status: "SIT",
    shadow: null, paper: [], thresh_used: [], skill_n: 0, skill_hits: 0, skill_wilson: 0, hypothesis: "", evidence: [],
    counter: "", invalidate_if: "", health: "LIVE", feed_age_s: 1, eyes: "", phase: "MID", raw_lean: "WAIT", raw_conf: 0,
    ...over,
  };
}

const learnerOf = (m) => m.skills.freshLearner();

// ---------------------------------------------------------------- selection

test("#1 RAW: a pre-filter UP read is the quiet call, whatever happened to the admitted vote", async () => {
  const m = await load();
  const L = learnerOf(m);
  const cases = [
    vote("DRIFT", { lean: "UP", confidence: 64, raw_lean: "UP", raw_conf: 64, skill_used: "DRIFT.aligned_3h", skill_status: "LIVE" }),
    vote("DRIFT", { lean: "WAIT", forced_sit: true, confidence: 70, raw_lean: "UP", raw_conf: 64 }),
    vote("ODDS", { lean: "WAIT", forced_sit: true, confidence: 70, raw_lean: "UP", raw_conf: 64 }),
    vote("TAPE", { lean: "WAIT", forced_sit: true, confidence: 70, raw_lean: "UP", raw_conf: 64, reasoning: "x · benched by COACH" }),
  ];
  for (const v of cases) {
    const c = m.q.selectQuietCall(v.seat, v, snap(), L, []);
    assert.equal(c.side, "UP");
    assert.equal(c.conf_raw, 64);
    assert.equal(c.p, 0.64);
    assert.equal(c.source, "RAW");
  }
});

test("#2 RAW falls back to confidence when raw_conf is absent", async () => {
  const m = await load();
  const c = m.q.selectQuietCall("DRIFT", vote("DRIFT", { lean: "DOWN", confidence: 61, raw_lean: "DOWN", raw_conf: undefined }), snap(), learnerOf(m), []);
  assert.deepEqual([c.side, c.conf_raw, c.source], ["DOWN", 61, "RAW"]);
});

test("#3 PAPER: strongest firing paper card, lexical tiebreak, closed cards tagged", async () => {
  const m = await load();
  const L = learnerOf(m);
  const v = vote("DRIFT", { paper: [
    { id: "DRIFT.b", lean: "DOWN", confidence: 58, status: "SHADOW" },
    { id: "DRIFT.c", lean: "UP", confidence: 61, status: "BENCH" },
    { id: "DRIFT.a", lean: "WAIT", confidence: 90, status: "SHADOW" },
  ] });
  const c = m.q.selectQuietCall("DRIFT", v, snap(), L, []);
  assert.deepEqual([c.side, c.conf_raw, c.source, c.paper_card_id, c.closed_card], ["UP", 61, "PAPER", "DRIFT.c", false]);
  const tie = vote("DRIFT", { paper: [
    { id: "DRIFT.z", lean: "DOWN", confidence: 60, status: "SHADOW" },
    { id: "DRIFT.m", lean: "UP", confidence: 60, status: "SHADOW" },
  ] });
  assert.equal(m.q.selectQuietCall("DRIFT", tie, snap(), L, []).paper_card_id, "DRIFT.m");
  const closed = vote("FADE", { paper: [{ id: "FADE.60s_rip", lean: "DOWN", confidence: 59, status: "BENCH" }] });
  const cc = m.q.selectQuietCall("FADE", closed, snap(), L, []);
  assert.deepEqual([cc.source, cc.closed_card], ["PAPER", true]);
});

/** The fallback each judged seat must produce, derived independently from the seat's reader. */
function expectedTilt(m, seat, s, L) {
  const sign = (x) => (x > 0 ? "UP" : x < 0 ? "DOWN" : null);
  const dir = (l) => (l === "UP" || l === "DOWN" ? l : null);
  switch (seat) {
    case "WICK": {
      const c1 = s.candles_1m.filter((c) => c.closed);
      if (!c1.length) return null;
      const r5 = m.patterns.readWick(s.candles_5m);
      return dir(m.patterns.readWick(c1, r5.structure.trend).structure.trend);
    }
    case "DRIFT": return dir(m.structure.readDrift(s).lean);
    case "STREAK": return dir(m.structure.readStreak(s).side);
    case "EXHAUST": return s.ret1h > 0 ? "DOWN" : s.ret1h < 0 ? "UP" : null;
    case "PULSE": return dir(m.tape.readPulse(s).lean);
    case "TAPE": return sign(m.tape.readTape(s).imb);
    case "WHALE": return dir(m.tape.readWhale(s).lean);
    case "VEL": return sign(m.tape.readVel(s).lead);
    case "CARRY": return dir(m.derivs.readCarry(s).lean);
    case "CHAIN": return dir(m.derivs.readChain(s).lean);
    case "CASCADE": return dir(m.derivs.readCascade(s).lean);
    case "VOLT": return dir(m.derivs.readVolt(s).lean);
    case "ODDS": case "CHEAP": return s.yes_ask > 0 && s.yes_ask < 50 ? "UP" : s.yes_ask > 50 && s.yes_ask < 100 ? "DOWN" : null;
    case "STRIKE": case "INDEX": return dir(m.clock.readClock(s).itm);
    case "FADE": {
      const p = s.yes_mid_path;
      const d60 = p.length >= 6 ? p[p.length - 1] - p[p.length - 6] : 0;
      return d60 > 0 ? "DOWN" : d60 < 0 ? "UP" : null;
    }
    case "CLOCK": {
      const card = L.skills["CLOCK.session_prior"];
      const ck = s.clock_key || `${s.session}_${new Date(s.as_of).getUTCDay()}`;
      const pk = card?.pocket?.[ck];
      if (!pk || !pk.n) return null;
      return pk.hits / pk.n > 0.5 ? "UP" : pk.hits / pk.n < 0.5 ? "DOWN" : null;
    }
    case "WIRE": return dir(m.context.readWire(s).lean);
    default: throw new Error(`no expectation for ${seat}`);
  }
}

/** A SYNTHETIC frame where most readers have something to say. */
function busySnap() {
  const bars = [];
  for (let i = 0; i < 20; i++) {
    const o = 80_000 + i * 12;
    bars.push({ t: CLOSE - (40 - i) * 60_000, open: o, high: o + 15, low: o - 3, close: o + 12, volume: i === 19 ? 30 : 5, closed: true });
  }
  return snap({
    candles_1m: bars, candles_5m: bars.slice(-12), ret5: 0.003, ret15: 0.004, ret1h: 0.009, atr_pct: 0.25,
    vol_percentile: 85, vol_last: 3, vol_median: 1, imbalance: 0.4, spot_lead_bps: 6, yes_ask: 44, no_ask: 58, yes_mid: 43,
    yes_mid_path: [30, 32, 34, 36, 38, 41], spot: 80_400, strike: 80_000,
    official_settles: [{ lean: "UP" }, { lean: "UP" }], fear_greed: 86, fear_greed_label: "Extreme Greed", fng_history: [70, 86],
    liq_long_usd: 0, liq_short_usd: 40_000, liq_n: 3, liq_source: "live", force_n: 3,
    funding_rate: 0.0003, funding_series: [0, 1, 2, 3].map((i) => ({ t: CLOSE - (4 - i) * 8 * 3_600_000, v: 0.0003 })),
    oi_delta_10m: 5,
  });
}

test("#4 TILT: every judged seat's fallback equals its own reader's direction (19 seats, two frames)", async () => {
  const m = await load();
  const L = learnerOf(m);
  L.skills["CLOCK.session_prior"].pocket.US_AM_1 = { n: 10, hits: 7 };
  assert.equal(m.q.QUIET_JUDGED_SEATS.length, 19, "SEAT_IDS minus WARDEN minus ORBIT (erratum ER-1)");
  let nonNull = 0;
  for (const frame of [snap(), busySnap()]) {
    for (const seat of m.q.QUIET_JUDGED_SEATS) {
      const want = expectedTilt(m, seat, frame, L);
      assert.equal(m.q.quietTilt(seat, frame, L), want, `${seat} tilt`);
      const c = m.q.selectQuietCall(seat, vote(seat), frame, L, []);
      if (want) { nonNull++; assert.deepEqual([c.side, c.source, c.conf_raw], [want, "TILT", 50], `${seat} TILT call`); }
      else assert.equal(c.source, "NONE", `${seat} flat reader → NONE`);
    }
  }
  assert.ok(nonNull >= 12, `the busy frame should exercise most readers (got ${nonNull})`);
});

test("#4a EXHAUST TILT fades the 1h run", async () => {
  const m = await load();
  const L = learnerOf(m);
  assert.equal(m.q.quietTilt("EXHAUST", snap({ ret1h: 0.009 }), L), "DOWN");
  assert.equal(m.q.quietTilt("EXHAUST", snap({ ret1h: -0.009 }), L), "UP");
  assert.equal(m.q.quietTilt("EXHAUST", snap({ ret1h: 0 }), L), null);
});

test("#4b FADE TILT fades the 60s YES move, using fadeBot's own d60", async () => {
  const m = await load();
  const L = learnerOf(m);
  assert.equal(m.q.quietTilt("FADE", snap({ yes_mid_path: [40, 42, 44, 46, 48, 50] }), L), "DOWN");
  assert.equal(m.q.quietTilt("FADE", snap({ yes_mid_path: [60, 58, 56, 54, 52, 50] }), L), "UP");
  assert.equal(m.q.quietTilt("FADE", snap({ yes_mid_path: [40, 42, 44, 46, 48] }), L), null);
  // Parity rail: the d60 expression is fadeBot's, verbatim.
  const bots = readFileSync(new URL("../src/lib/desk/bots.ts", import.meta.url), "utf8");
  const quiet = readFileSync(new URL("../src/lib/desk/quiet-call.ts", import.meta.url), "utf8");
  const d60 = "path.length >= 6 ? path[path.length - 1]! - path[path.length - 6]! : 0";
  assert.ok(bots.includes(`const d60 = ${d60}`), "fadeBot d60 expression moved — re-pin the quiet TILT");
  assert.ok(quiet.includes(`const d60 = ${d60}`), "quiet FADE TILT must use fadeBot's d60 verbatim");
});

test("#4c CARRY TILT mirrors readCarry: fade extremes, follow moderate carry, else NONE", async () => {
  const m = await load();
  const L = learnerOf(m);
  const series = (v) => [0, 1, 2, 3].map((i) => ({ t: CLOSE - (4 - i) * 8 * 3_600_000, v }));
  const up = snap({ funding_rate: 0.0003, funding_series: series(0.0003) });
  const dn = snap({ funding_rate: -0.0003, funding_series: series(-0.0003) });
  const moderate = snap({ funding_rate: 0.0001, ret15: 0.002, oi_delta_10m: 4 });
  for (const s of [up, dn, moderate, snap()]) assert.equal(m.q.quietTilt("CARRY", s, L), (l => (l === "WAIT" ? null : l))(m.derivs.readCarry(s).lean));
  assert.equal(m.q.quietTilt("CARRY", snap(), L), null);
});

test("#4d retired seats (ODDS, CHEAP, FADE) are in the ledger and carry their own read", async () => {
  const m = await load();
  const L = learnerOf(m);
  for (const seat of ["ODDS", "CHEAP", "FADE"]) assert.ok(m.q.QUIET_SEATS.includes(seat));
  const v = vote("ODDS", { lean: "WAIT", forced_sit: true, confidence: 70, raw_lean: "UP", raw_conf: 66, skill_used: "ODDS.cheap_yes" });
  const c = m.q.selectQuietCall("ODDS", v, snap(), L, []);
  assert.deepEqual([c.source, c.side, c.admitted_state], ["RAW", "UP", "RETIRED"]);
  const cap = m.q.buildCapture(snap(), [], L, [], "sha");
  assert.deepEqual(["ODDS", "CHEAP", "FADE"].map((s) => cap.calls.some((c) => c.seat === s)), [true, true, true]);
});

test("#4e VOLT and PULSE are judged and mirror their readers; a firing card is RAW/PAPER, never CONTROL", async () => {
  const m = await load();
  const L = learnerOf(m);
  const expand = snap({ atr_pct: 0.25, ret15: 0.004 });
  assert.equal(m.q.quietTilt("VOLT", expand, L), "UP");
  assert.equal(m.q.quietTilt("VOLT", snap({ atr_pct: 0.05, vol_percentile: 10 }), L), null);
  const bars = Array.from({ length: 6 }, (_, i) => ({ t: CLOSE - (10 - i) * 60_000, open: 100, high: 101, low: 95, close: 96, volume: 1, closed: true }));
  const spike = snap({ candles_1m: bars, vol_last: 3, vol_median: 1 });
  assert.equal(m.q.quietTilt("PULSE", spike, L), "DOWN");
  assert.equal(m.q.quietTilt("PULSE", snap(), L), null);
  for (const seat of ["VOLT", "PULSE"]) {
    assert.ok(m.q.QUIET_JUDGED_SEATS.includes(seat));
    const raw = m.q.selectQuietCall(seat, vote(seat, { raw_lean: "DOWN", raw_conf: 57 }), snap(), L, []);
    assert.deepEqual([raw.source, raw.control], ["RAW", false]);
  }
});

test("#5 NONE and CONTROL: ORBIT is always a tagged coin; a judged seat with nothing is NONE; coin is deterministic and balanced", async () => {
  const m = await load();
  const L = learnerOf(m);
  assert.deepEqual(m.q.QUIET_CONTROL_SEATS, ["ORBIT"]);
  const o = m.q.selectQuietCall("ORBIT", vote("ORBIT", { raw_lean: "UP", raw_conf: 80, paper: [{ id: "ORBIT.x", lean: "UP", confidence: 90, status: "LIVE" }] }), snap(), L, []);
  assert.deepEqual([o.source, o.conf_raw, o.p, o.control], ["CONTROL", 50, 0.5, true]);
  assert.equal(o.side, m.q.quietCoin("ORBIT", TICKER, CLOSE));
  const n = m.q.selectQuietCall("TAPE", vote("TAPE"), snap(), L, []);
  assert.deepEqual([n.source, n.conf_raw], ["NONE", 50]);
  assert.equal(n.side, m.q.quietCoin("TAPE", TICKER, CLOSE));
  assert.equal(m.q.quietCoin("TAPE", TICKER, CLOSE), m.q.quietCoin("TAPE", TICKER, CLOSE));
  let up = 0;
  for (let i = 0; i < 10_000; i++) if (m.q.quietCoin("WIRE", `KX-${i}`, CLOSE + i * 900_000) === "UP") up++;
  assert.ok(Math.abs(up - 5000) <= 100, `coin balance ${up}/10000`);
});

test("#5a ORBIT is excluded from judgment; VOLT and PULSE are judged", async () => {
  const m = await load();
  assert.ok(!m.q.QUIET_JUDGED_SEATS.includes("ORBIT"));
  assert.ok(m.q.QUIET_JUDGED_SEATS.includes("VOLT") && m.q.QUIET_JUDGED_SEATS.includes("PULSE"));
  // Flag/kill exclusion is exercised in #16–#25 with ORBIT carrying the worst record.
});

test("#6 WARDEN is excluded: every capture holds exactly 20 calls (19 judged + 1 control)", async () => {
  const m = await load();
  const L = learnerOf(m);
  const votes = m.types.SEAT_IDS.map((s) => vote(s));
  const cap = m.q.buildCapture(snap(), votes, L, [], "sha");
  assert.equal(cap.calls.length, 20, "SEAT_IDS has 21 ids including WARDEN (erratum ER-1)");
  assert.deepEqual(cap.calls.map((c) => c.seat), m.types.SEAT_IDS.filter((s) => s !== "WARDEN"));
  assert.ok(!cap.calls.some((c) => c.seat === "WARDEN"));
  assert.equal(cap.calls.filter((c) => c.control).length, 1);
  assert.equal(cap.v, "QUIET_CALL_V1");
  assert.deepEqual([cap.ticker, cap.close_time, cap.yes_ask, cap.no_ask, cap.yes_mid, cap.regime_key], [TICKER, CLOSE, 52, 50, 51, "US_AM_MID"]);
});

test("#7 admitted state precedence: FEED_DOWN > RETIRED > MUTED > FORCED_SIT > SIT > WAIT > SPOKE", async () => {
  const m = await load();
  const s = (seat, over, mutes = []) => m.q.admittedState(seat, vote(seat, over), mutes);
  assert.equal(s("ODDS", { health: "DOWN", forced_sit: true }), "FEED_DOWN");
  assert.equal(s("ODDS", { forced_sit: true }, ["ODDS"]), "RETIRED");
  assert.equal(s("TAPE", { lean: "UP", forced_sit: true }, ["TAPE"]), "MUTED");
  assert.equal(s("TAPE", { forced_sit: true, skill_used: "SIT" }), "FORCED_SIT");
  assert.equal(s("TAPE", { skill_used: "SIT" }), "SIT");
  assert.equal(s("TAPE", { skill_used: "TAPE.x" }), "WAIT");
  assert.equal(s("TAPE", { lean: "DOWN", skill_used: "TAPE.x" }), "SPOKE");
  assert.equal(m.q.admittedState("TAPE", undefined, []), "SIT");
});

test("#8 p is the stated side's probability, clamped to [0.50, 0.99]", async () => {
  const m = await load();
  const L = learnerOf(m);
  const p = (conf) => m.q.selectQuietCall("DRIFT", vote("DRIFT", { raw_lean: "UP", raw_conf: conf }), snap(), L, []).p;
  assert.equal(p(30), 0.5);
  assert.equal(p(92), 0.92);
  assert.equal(p(120), 0.99);
});

// ---------------------------------------------------------------- grading

function capWith(m, calls, over = {}) {
  return { v: "QUIET_CALL_V1", ticker: TICKER, close_time: CLOSE, as_of: CLOSE - 11.5 * 60_000, mins_left: 11.5,
    regime_key: "US_AM_MID", yes_ask: 55, no_ask: 47, yes_mid: 54, build_sha: "sha", calls, ...over };
}
function call(seat, side, over = {}) {
  return { seat, side, conf_raw: 60, p: 0.6, source: "RAW", control: seat === "ORBIT", admitted_lean: "WAIT",
    admitted_state: "FORCED_SIT", skill_used: "SIT", ...over };
}
const gradeSnap = (over = {}) => snap({ as_of: CLOSE - 2_000, mins_left: 0.03, yes_ask: 97, no_ask: 4, yes_mid: 96, ...over });

test("#9 grading math: hit, cents via centsOf at capture asks, coin baseline, Brier, EV-vs-coin", async () => {
  const m = await load();
  const book = m.q.freshQuietBook(1);
  const capture = capWith(m, [call("DRIFT", "UP"), call("TAPE", "DOWN", { p: 0.7, conf_raw: 70 })]);
  const input = { book, capture };
  const r = m.q.gradeQuiet(input, gradeSnap(), "UP", "GRADE", m.learner.creditDirectional);
  assert.equal(r.status, "GRADED");
  const cs = { yes_ask: 55, no_ask: 47, yes_mid: 54 };
  const upC = m.clock.centsOf("UP", cs, "UP");
  const dnC = m.clock.centsOf("DOWN", cs, "UP");
  const coin = (upC + dnC) / 2;
  const d = book.seats.DRIFT, t = book.seats.TAPE;
  assert.deepEqual([d.all.n, d.all.hits, d.all.ev_sum], [1, 1, upC]);
  assert.deepEqual([t.all.n, t.all.hits, t.all.ev_sum], [1, 0, dnC]);
  assert.ok(Math.abs(d.all.brier - 0.16) < 1e-12);
  assert.ok(Math.abs(t.all.brier - 0.49) < 1e-12);
  assert.equal(d.coin_sum, coin);
  assert.equal(t.coin_sum, coin);
  assert.deepEqual(r.rows.find((x) => x.seat === "DRIFT"), { seat: "DRIFT", finish: "UP", hit: 1, cents: upC, coin_cents: coin });
  assert.equal(book.graded_windows, 1);
});

test("#10 centsOf reads only yes_ask / no_ask / yes_mid (field pin)", async () => {
  const m = await load();
  const full = busySnap();
  for (const [ya, na, ym] of [[55, 47, 54], [0, 47, 30], [62, 0, 60], [0, 0, 0]]) {
    const s = { ...full, yes_ask: ya, no_ask: na, yes_mid: ym };
    const mini = m.q.captureSnap({ yes_ask: ya, no_ask: na, yes_mid: ym });
    for (const side of ["UP", "DOWN"]) for (const fin of ["UP", "DOWN"])
      assert.equal(m.clock.centsOf(side, mini, fin), m.clock.centsOf(side, s, fin));
  }
  const src = readFileSync(new URL("../src/lib/desk/clock.ts", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("export function centsOf"));
  const fields = new Set([...body.slice(0, body.indexOf("\n}") + 2).matchAll(/snap\.(\w+)/g)].map((x) => x[1]));
  assert.deepEqual([...fields].sort(), ["no_ask", "yes_ask", "yes_mid"], "centsOf now reads another field — extend the capture");
});

test("#11 creditDirectional is reused: a QuietRecord stat block and a real SkillCard evolve identically", async () => {
  const m = await load();
  const card = m.skills.freshLearner().skills["DRIFT.aligned_3h"];
  const stats = m.q.freshStats();
  const seq = [[1, 62, "A", 45], [0, 55, "B", -53], [1, 70, "A", 30], [1, 51, "A", 12], [0, 80, "B", -60]];
  for (const [hit, conf, pk, cents] of seq) {
    m.learner.creditDirectional(card, hit, conf, pk, cents);
    m.learner.creditDirectional(stats, hit, conf, pk, cents);
  }
  for (const k of ["n", "hits", "wilson", "brier_sum", "brier_n", "brier", "ev_sum", "ev_n", "ev", "streak_wrong", "last20", "pocket"])
    assert.deepEqual(stats[k], card[k], k);
});

test("#12 rolling buffer is capped at 50; L20/L50 are computed on the slice", async () => {
  const m = await load();
  const book = m.q.freshQuietBook(1);
  for (let i = 0; i < 60; i++) {
    const capture = capWith(m, [call("DRIFT", i < 30 ? "DOWN" : "UP")], { close_time: CLOSE + i * 900_000, ticker: `KX-${i}` });
    m.q.gradeQuiet({ book, capture }, gradeSnap({ close_time: CLOSE + i * 900_000, ticker: `KX-${i}` }), "UP", "GRADE", m.learner.creditDirectional);
  }
  const rec = book.seats.DRIFT;
  assert.equal(rec.roll.length, 50);
  const board = m.q.quietBoard(book);
  const row = board.seats.find((r) => r.seat === "DRIFT");
  assert.equal(row.L20.n, 20);
  assert.equal(row.L20.hits, 20);
  assert.equal(row.L50.hits, 30);
  assert.equal(row.ALL.n, 60);
  assert.equal(row.ALL.hits, 30);
});

test("#13 pockets accumulate by the CAPTURE regime, not the grade-frame regime", async () => {
  const m = await load();
  const book = m.q.freshQuietBook(1);
  m.q.gradeQuiet({ book, capture: capWith(m, [call("DRIFT", "UP")], { regime_key: "ASIA_ENTRY" }) },
    gradeSnap({ regime_key: "ASIA_FINAL" }), "UP", "GRADE", m.learner.creditDirectional);
  const rec = book.seats.DRIFT;
  assert.deepEqual(rec.all.pocket, { ASIA_ENTRY: { n: 1, hits: 1 } });
  assert.ok(Number.isFinite(rec.pocket_ev.ASIA_ENTRY));
  assert.equal(rec.pocket_ev.ASIA_FINAL, undefined);
});

/** Build a book directly from per-seat (n, hits, centsPerHit, centsPerMiss) records. */
function bookWith(m, spec, { windows } = {}) {
  const book = m.q.freshQuietBook(1);
  const N = windows ?? Math.max(...Object.values(spec).map((s) => s.n));
  for (let w = 0; w < N; w++) {
    const calls = [];
    for (const [seat, s] of Object.entries(spec)) {
      if (w >= s.n) continue;
      const hit = s.pattern ? s.pattern(w) : w < s.hits;
      calls.push(call(seat, hit ? "UP" : "DOWN", { source: s.source ?? "RAW" }));
    }
    const capture = capWith(m, calls, { close_time: CLOSE + w * 900_000, ticker: `KX-${w}` });
    m.q.gradeQuiet({ book, capture }, gradeSnap({ close_time: CLOSE + w * 900_000, ticker: `KX-${w}` }), "UP", "GRADE", m.learner.creditDirectional);
  }
  return book;
}

test("#14 ranks: Wilson desc → EV desc → seat id; EV-vs-coin rank; n=0 last; ORBIT never takes a judged slot", async () => {
  const m = await load();
  const book = bookWith(m, {
    DRIFT: { n: 40, hits: 30 }, TAPE: { n: 40, hits: 30 }, WICK: { n: 40, hits: 20 }, ORBIT: { n: 40, hits: 39 },
  });
  const board = m.q.quietBoard(book);
  const judged = board.seats.filter((r) => !r.control);
  const byW = [...judged].sort((a, b) => a.ALL.rank_wilson - b.ALL.rank_wilson).map((r) => r.seat);
  assert.deepEqual(byW.slice(0, 3), ["DRIFT", "TAPE", "WICK"]);
  for (const r of judged.filter((x) => x.ALL.n === 0)) assert.ok(r.ALL.rank_wilson > 3 && r.ALL.rank_ev > 3, `${r.seat}: n=0 ranks below every seat with data`);
  const empties = judged.filter((x) => x.ALL.n === 0).sort((a, b) => a.ALL.rank_wilson - b.ALL.rank_wilson).map((r) => r.seat);
  assert.deepEqual(empties, [...empties].sort(), "n=0 seats tie-break on seat id");
  const orbit = board.seats.find((r) => r.seat === "ORBIT");
  assert.equal(orbit.control, true);
  assert.equal(orbit.ALL.rank_wilson, null);
  assert.equal(orbit.ALL.would_rank_wilson, 1, "a hot coin shows where it would place");
  assert.deepEqual(judged.map((r) => r.ALL.rank_wilson).sort((a, b) => a - b), Array.from({ length: 19 }, (_, i) => i + 1));
  assert.deepEqual(judged.map((r) => r.ALL.rank_ev).sort((a, b) => a - b), Array.from({ length: 19 }, (_, i) => i + 1));
});

test("#15 warm-up: WARMING at 199 graded windows, TRUSTWORTHY at 200; seat warming while n < 200", async () => {
  const m = await load();
  const book = m.q.freshQuietBook(1);
  book.graded_windows = 199;
  assert.equal(m.q.quietBoard(book).trust, "WARMING");
  book.graded_windows = 200;
  assert.equal(m.q.quietBoard(book).trust, "TRUSTWORTHY");
  assert.equal(m.q.quietBoard(book).seats.find((r) => r.seat === "DRIFT").warming, true);
});

test("#15a luck band is the analytic binomial 95% interval around 0.5", async () => {
  const m = await load();
  const book = bookWith(m, { DRIFT: { n: 200, hits: 100 } });
  const band = m.q.quietBoard(book).luck_band;
  assert.deepEqual([band.ALL.n, band.ALL.lo, band.ALL.hi], [200, 0.431, 0.569]);
  assert.deepEqual([band.L20.lo, band.L20.hi], [0.299, 0.701]);
});

// ---------------------------------------------------------------- huddle review

const L0 = (m) => m.skills.freshLearner();

test("#16 flag trigger A: Wilson upper < 0.50 flags (reason A, INVERT?); 90/200 does not", async () => {
  const m = await load();
  const book = bookWith(m, { DRIFT: { n: 200, hits: 70 }, TAPE: { n: 200, hits: 90 }, WICK: { n: 200, hits: 120 } }, { windows: 200 });
  const r = m.q.quietHuddleReview(book, L0(m), Date.UTC(2026, 9, 6, 8));
  assert.equal(book.flags.DRIFT.state, "FLAGGED");
  assert.equal(book.flags.DRIFT.reason, "A");
  assert.match(r.line, /DRIFT\(A/);
  assert.match(r.line, /INVERT\?/);
  assert.notEqual(book.flags.TAPE?.state, "FLAGGED");
});

test("#17 flag trigger B: bottom quartile + L50 < 50% + L50 EV-vs-coin < 0 at 3 consecutive huddles", async () => {
  const m = await load();
  // 8 eligible seats: bottom quartile = ranks 7 and 8. WICK is bottom, L50 losing, but A does not fire.
  const spec = {};
  for (const [seat, hits] of [["DRIFT", 125], ["TAPE", 124], ["VEL", 123], ["CHAIN", 122], ["CARRY", 121], ["WHALE", 120], ["STREAK", 110]])
    spec[seat] = { n: 200, hits, pattern: (w) => w % 200 < hits };
  spec.WICK = { n: 200, hits: 96, pattern: (w) => w < 96 }; // last 50 all misses → L50 0%
  const book = bookWith(m, spec, { windows: 200 });
  assert.ok(m.q.wilsonUpper(96, 200) >= 0.5, "fixture must not trip A");
  for (let i = 0; i < 2; i++) { m.q.quietHuddleReview(book, L0(m), Date.UTC(2026, 9, 6, 8 + i)); assert.notEqual(book.flags.WICK?.state, "FLAGGED"); }
  m.q.quietHuddleReview(book, L0(m), Date.UTC(2026, 9, 6, 11));
  assert.equal(book.flags.WICK.state, "FLAGGED");
  assert.equal(book.flags.WICK.reason, "B");
  // Two consecutive then a recovery: never flags.
  const b2 = bookWith(m, spec, { windows: 200 });
  m.q.quietHuddleReview(b2, L0(m), 1); m.q.quietHuddleReview(b2, L0(m), 2);
  b2.seats.WICK.roll = b2.seats.WICK.roll.map((x) => ({ ...x, hit: 1, cents: 40 }));
  m.q.quietHuddleReview(b2, L0(m), 3);
  b2.seats.WICK.roll = b2.seats.WICK.roll.map((x) => ({ ...x, hit: 0, cents: -55 }));
  m.q.quietHuddleReview(b2, L0(m), 4);
  assert.notEqual(b2.flags.WICK?.state, "FLAGGED", "the B streak restarts after a clean huddle");
});

test("#18 hysteresis: a flag clears only after 2 consecutive clean huddles", async () => {
  const m = await load();
  const book = bookWith(m, { DRIFT: { n: 200, hits: 70 }, TAPE: { n: 200, hits: 110 } }, { windows: 200 });
  m.q.quietHuddleReview(book, L0(m), 1);
  assert.equal(book.flags.DRIFT.state, "FLAGGED");
  book.seats.DRIFT.all.hits = 120; // now clean on A
  book.seats.DRIFT.roll = book.seats.DRIFT.roll.map((x) => ({ ...x, hit: 1, cents: 40 }));
  m.q.quietHuddleReview(book, L0(m), 2);
  assert.equal(book.flags.DRIFT.state, "FLAGGED");
  const r = m.q.quietHuddleReview(book, L0(m), 3);
  assert.equal(book.flags.DRIFT.state, "CLEAR");
  assert.match(r.line, /CLEAR DRIFT/);
});

test("#19 cap: five seats trailing at once → 3 newly flagged (lowest Wilson LB), the rest next huddle", async () => {
  const m = await load();
  const spec = {};
  for (const [seat, hits] of [["DRIFT", 60], ["TAPE", 62], ["VEL", 64], ["CHAIN", 66], ["CARRY", 68], ["WICK", 120]]) spec[seat] = { n: 200, hits };
  const book = bookWith(m, spec, { windows: 200 });
  m.q.quietHuddleReview(book, L0(m), 1);
  const flagged = () => Object.entries(book.flags).filter(([, f]) => f.state === "FLAGGED").map(([s]) => s).sort();
  assert.deepEqual(flagged(), ["DRIFT", "TAPE", "VEL"]);
  m.q.quietHuddleReview(book, L0(m), 2);
  assert.deepEqual(flagged(), ["CARRY", "CHAIN", "DRIFT", "TAPE", "VEL"]);
});

test("#20 eligibility: no flags before 200 graded windows, seat n ≥ 200 and a full roll; ORBIT never flags", async () => {
  const m = await load();
  const early = bookWith(m, { DRIFT: { n: 199, hits: 40 } }, { windows: 199 });
  m.q.quietHuddleReview(early, L0(m), 1);
  assert.notEqual(early.flags.DRIFT?.state, "FLAGGED");
  const orbit = bookWith(m, { ORBIT: { n: 200, hits: 40 }, DRIFT: { n: 200, hits: 110 } }, { windows: 200 });
  m.q.quietHuddleReview(orbit, L0(m), 1);
  assert.notEqual(orbit.flags.ORBIT?.state, "FLAGGED");
  const thin = bookWith(m, { DRIFT: { n: 200, hits: 40 } }, { windows: 200 });
  thin.seats.DRIFT.roll = thin.seats.DRIFT.roll.slice(-49);
  m.q.quietHuddleReview(thin, L0(m), 1);
  assert.notEqual(thin.flags.DRIFT?.state, "FLAGGED");
});

test("#21 rethink_eligible mirrors spawnRethink preconditions; the review never touches learner.skills", async () => {
  const m = await load();
  const book = bookWith(m, { DRIFT: { n: 200, hits: 60 }, VOLT: { n: 200, hits: 60 }, TAPE: { n: 200, hits: 110 } }, { windows: 200 });
  const L = L0(m);
  for (const id of Object.keys(L.skills)) if (L.skills[id].owner === "VOLT") delete L.skills[id];
  L.skills["DRIFT.rethink_aaaa"] = { ...L.skills["DRIFT.aligned_3h"], id: "DRIFT.rethink_aaaa" };
  L.skills["DRIFT.rethink_bbbb"] = { ...L.skills["DRIFT.aligned_3h"], id: "DRIFT.rethink_bbbb" };
  const before = JSON.stringify(L);
  m.q.quietHuddleReview(book, L, 1);
  assert.equal(JSON.stringify(L), before, "learner untouched");
  assert.equal(book.flags.DRIFT.rethink_eligible, false, "two rethink cards already");
  assert.equal(book.flags.VOLT.rethink_eligible, false, "no cards to rethink from");
  const L2 = L0(m);
  m.q.quietHuddleReview(bookWith(m, { DRIFT: { n: 200, hits: 60 } }, { windows: 200 }), L2, 1);
  const b3 = bookWith(m, { DRIFT: { n: 200, hits: 60 } }, { windows: 200 });
  m.q.quietHuddleReview(b3, L2, 1);
  assert.equal(b3.flags.DRIFT.rethink_eligible, true);
});

// ---------------------------------------------------------------- kill criteria

/** SYNTHETIC graded table rows for kill evaluation. */
function rowsFor(spec, windows) {
  const rows = [];
  for (let w = 0; w < windows; w++) {
    for (const [seat, s] of Object.entries(spec)) {
      const hit = s.pattern ? s.pattern(w) : (w % 1000) < s.rate * 1000 ? 1 : 0;
      const source = s.source ? (typeof s.source === "function" ? s.source(w) : s.source) : "RAW";
      rows.push({ ticker: `KX-${w}`, close_time: CLOSE + w * 900_000, seat, source, grade_status: "GRADED",
        hit: hit ? 1 : 0, cents: hit ? 45 : -55, coin_cents: -5 });
    }
  }
  return rows;
}
/** Deterministic Bernoulli(0.5)-like sequence that is exactly balanced every 2 windows. */
const alt = (offset = 0) => (w) => ((w + offset) % 2 === 0 ? 1 : 0);

function bookFromRows(m, rows, missed = 0) {
  const book = m.q.rebuildBookFromRows(rows, m.learner.creditDirectional, 1);
  book.missed_windows = missed;
  return book;
}

test("#22 kill K1: all-coin judged seats → RETIRE; one judged seat at 0.58 → continue; 0.42 too; ORBIT at 0.58 does not count", async () => {
  const m = await load();
  const base = {};
  m.q.QUIET_JUDGED_SEATS.forEach((s, i) => { base[s] = { pattern: alt(i), source: "RAW" }; });
  base.ORBIT = { pattern: alt(), source: "CONTROL" };
  const run = (spec) => { const rows = rowsFor(spec, 500); return m.q.evaluateKill(rows, bookFromRows(m, rows)); };
  const coin = run(base);
  assert.equal(coin.k1.fires, true);
  assert.equal(coin.verdict, "RETIRE");
  const hot = run({ ...base, DRIFT: { pattern: (w) => (w % 50) < 29 ? 1 : 0 } }); // 0.58
  assert.equal(hot.k1.fires, false);
  const cold = run({ ...base, DRIFT: { pattern: (w) => (w % 50) < 21 ? 1 : 0 } }); // 0.42
  assert.equal(cold.k1.fires, false, "a contrarian seat discriminates");
  const orbitHot = run({ ...base, ORBIT: { pattern: (w) => (w % 50) < 29 ? 1 : 0, source: "CONTROL" } });
  assert.equal(orbitHot.k1.fires, true, "the control never counts toward K1");
  // χ² homogeneity, hand-computed: two seats 300/500 and 200/500 → p̄ = 0.5, χ² = 2·(50²/125) = 40.
  const chi = m.q.chi2Homogeneity([{ n: 500, hits: 300 }, { n: 500, hits: 200 }]);
  assert.ok(Math.abs(chi.stat - 40) < 1e-9);
  assert.equal(chi.df, 1);
  assert.ok(Math.abs(m.q.chi2Survival(30.1435, 19) - 0.05) < 0.001);
  assert.ok(Math.abs(m.q.chi2Survival(28.8693, 18) - 0.05) < 0.001, "df 18 = 19 judged seats");
});

test("#23 kill K2: novel subset at coin while RAW is strong → RETIRE; strong novel → continue; window clustering", async () => {
  const m = await load();
  const spec = {};
  m.q.QUIET_JUDGED_SEATS.forEach((s, i) => {
    // RAW on even windows (strong, already carded), TILT on odd windows (coin).
    spec[s] = { source: (w) => (w % 2 === 0 ? "RAW" : "TILT"), pattern: (w) => (w % 2 === 0 ? ((w / 2) % 10 < 8 ? 1 : 0) : (((w - 1) / 2 + i) % 2)) };
  });
  spec.ORBIT = { pattern: alt(), source: "CONTROL" };
  let rows = rowsFor(spec, 500);
  const carded = m.q.evaluateKill(rows, bookFromRows(m, rows));
  assert.equal(carded.k1.fires, false, "RAW strength makes K1 pass");
  assert.equal(carded.k2.fires, true, "but the novel subset adds nothing");
  assert.equal(carded.verdict, "RETIRE");
  const novelSpec = {};
  m.q.QUIET_JUDGED_SEATS.forEach((s, i) => { novelSpec[s] = { source: "TILT", pattern: (w) => ((w + i) % 10 < 7 ? 1 : 0) }; });
  novelSpec.ORBIT = { pattern: alt(), source: "CONTROL" };
  rows = rowsFor(novelSpec, 500);
  const novel = m.q.evaluateKill(rows, bookFromRows(m, rows));
  assert.equal(novel.k2.fires, false);
  assert.equal(novel.verdict, "CONTINUE");
  // Clustering: the pooled tests use windows as the unit — duplicating seats on a window cannot shrink n.
  const cl = m.q.clusterByWindow(rowsFor({ DRIFT: { source: "TILT", pattern: alt() }, TAPE: { source: "TILT", pattern: alt() } }, 100));
  assert.equal(cl.hit.n, 100);
});

test("#24 kill K0: low coverage → EXTEND; table↔book drift → EXTEND; ORBIT drift → EXTEND (CONTROL_DRIFT)", async () => {
  const m = await load();
  const spec = {};
  m.q.QUIET_JUDGED_SEATS.forEach((s, i) => { spec[s] = { pattern: alt(i) }; });
  spec.ORBIT = { pattern: alt(), source: "CONTROL" };
  const rows = rowsFor(spec, 500);
  const low = m.q.evaluateKill(rows, bookFromRows(m, rows, 89)); // 500/589 = 84.9%
  assert.equal(low.verdict, "EXTEND");
  assert.match(low.k0.reasons.join(","), /COVERAGE/);
  const drifted = bookFromRows(m, rows);
  drifted.seats.DRIFT.all.n += 1;
  assert.match(m.q.evaluateKill(rows, drifted).k0.reasons.join(","), /DRIFT/);
  const orbitRows = rowsFor({ ...spec, ORBIT: { pattern: (w) => (w % 50) < 29 ? 1 : 0, source: "CONTROL" } }, 500);
  const o = m.q.evaluateKill(orbitRows, bookFromRows(m, orbitRows));
  assert.equal(o.verdict, "EXTEND");
  assert.ok(o.k0.reasons.includes("CONTROL_DRIFT"));
});

test("#25 kill is one-shot: due once at ≥ 500; a final verdict is never re-evaluated or overwritten", async () => {
  const m = await load();
  const book = m.q.freshQuietBook(1);
  book.graded_windows = 499;
  assert.equal(m.q.quietHuddleReview(book, L0(m), 1).kill_due, false);
  book.graded_windows = 500;
  assert.equal(m.q.quietHuddleReview(book, L0(m), 2).kill_due, true);
  m.q.recordKill(book, { verdict: "CONTINUE", at_windows: 500 });
  book.graded_windows = 900;
  assert.equal(m.q.quietHuddleReview(book, L0(m), 3).kill_due, false);
  m.q.recordKill(book, { verdict: "RETIRE", at_windows: 900 });
  assert.equal(book.kill.verdict, "CONTINUE", "final verdict is not overwritten");
  const ext = m.q.freshQuietBook(1);
  ext.graded_windows = 500;
  m.q.recordKill(ext, { verdict: "EXTEND", at_windows: 500 });
  assert.equal(ext.kill.next_check_at, 1000);
  assert.equal(m.q.quietHuddleReview(ext, L0(m), 1).kill_due, false);
  ext.graded_windows = 1000;
  assert.equal(m.q.quietHuddleReview(ext, L0(m), 2).kill_due, true);
});

// ---------------------------------------------------------------- persistence helpers

test("#26 sanitize: garbage → fresh book, no throw; valid round-trips; captures trimmed oldest-first with settlement capacity", async () => {
  const m = await load();
  for (const junk of [null, undefined, 42, "x", [], { v: "OTHER" }, { v: "QUIET_CALL_V1", graded_windows: -4 }, { v: "QUIET_CALL_V1", seats: 7 }]) {
    const b = m.q.sanitizeQuietBook(junk);
    assert.equal(b.v, "QUIET_CALL_V1");
    assert.equal(b.graded_windows, 0);
  }
  const book = bookWith(m, { DRIFT: { n: 30, hits: 20 } });
  m.q.quietHuddleReview(book, L0(m), 1);
  assert.deepEqual(m.q.sanitizeQuietBook(JSON.parse(JSON.stringify(book))), JSON.parse(JSON.stringify(book)));
  const caps = {};
  for (let i = 0; i < m.q.QUIET_CAPTURE_CAP+3; i++) caps[`KX-${i}:${CLOSE + i}`] = capWith(m, [call("DRIFT", "UP")], { ticker: `KX-${i}`, close_time: CLOSE + i });
  caps.bad = { v: "nope" };
  const kept = m.q.sanitizeQuietCaptures(caps);
  assert.equal(Object.keys(kept).length, m.q.QUIET_CAPTURE_CAP);
  assert.ok(!("KX-0:" + CLOSE in kept) && `KX-${m.q.QUIET_CAPTURE_CAP+2}:${CLOSE+m.q.QUIET_CAPTURE_CAP+2}` in kept);
  assert.deepEqual(m.q.sanitizeQuietCaptures("junk"), {});
});

test("#27 rebuildBookFromRows equals the incrementally built book over a 300-window stream", async () => {
  const m = await load();
  const book = m.q.freshQuietBook(1);
  const rows = [];
  for (let w = 0; w < 300; w++) {
    const calls = ["DRIFT", "TAPE", "ORBIT", "VOLT"].map((seat, i) =>
      call(seat, (w * 7 + i * 3) % 5 < 3 ? "UP" : "DOWN", { source: seat === "ORBIT" ? "CONTROL" : ["RAW", "PAPER", "TILT", "NONE"][(w + i) % 4],
        p: 0.5 + ((w + i) % 9) / 20, conf_raw: 50 + ((w + i) % 9) * 5, admitted_state: (w + i) % 3 ? "WAIT" : "SPOKE",
        regime_key: undefined }));
    const close = CLOSE + w * 900_000;
    const capture = capWith(m, calls, { close_time: close, ticker: `KX-${w}`, regime_key: ["A", "B", "C"][w % 3], yes_ask: 40 + (w % 20), no_ask: 62 - (w % 20) });
    const finish = w % 3 ? "UP" : "DOWN";
    const r = m.q.gradeQuiet({ book, capture }, gradeSnap({ close_time: close, ticker: `KX-${w}` }), finish, "GRADE", m.learner.creditDirectional);
    for (const c of calls) {
      const g = r.rows.find((x) => x.seat === c.seat);
      rows.push({ ticker: capture.ticker, close_time: close, seat: c.seat, source: c.source, p_used: c.p, admitted_state: c.admitted_state,
        regime_key: capture.regime_key, grade_status: "GRADED", finish, hit: g.hit, cents: g.cents, coin_cents: g.coin_cents, captured_at: capture.as_of });
    }
  }
  const rebuilt = m.q.rebuildBookFromRows(rows, m.learner.creditDirectional, book.activated_at);
  const strip = (b) => JSON.parse(JSON.stringify({ seats: b.seats, graded_windows: b.graded_windows }));
  assert.deepEqual(strip(rebuilt), strip(book));
});

test('#28 K0 coverage includes captured skips without including them in statistical grades',async()=>{const m=await load(),book=m.q.freshQuietBook(1);book.graded_windows=500;book.missed_windows=60;book.skipped={chalk:40,uncountable:40,identity:20};const result=m.q.evaluateKill([],book,1);assert.equal(result.k0.coverage,600/660);assert.ok(!result.k0.reasons.includes('COVERAGE'));assert.equal(result.k1.seats.length,0);});
