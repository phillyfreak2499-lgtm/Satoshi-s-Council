/**
 * The Pro Floor read model — presentation-purity tests.
 *
 * These are about honesty, not about the desk being right: the same frame must
 * always produce the same facts, nothing may be mutated, a missing number must
 * never render as a zero, a gate confidence must never be dressed as a
 * probability, a RAW seat read must never merge with a FINAL vote, and no WAIT
 * explanation may imply that clearing one blocker produces a call.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SUPPRESSION_LABEL,
  VOICE_LABEL,
  balanceFacts,
  familyFacts,
  fmtCentsFact,
  fmtDistance,
  fmtScore,
  fmtSigned,
  fmtUsd,
  gateFacts,
  marketPosition,
  modelFacts,
  proFloorFacts,
  quoteFacts,
  seatFacts,
  standardFacts,
  waitFacts,
  type ProFloorFacts,
} from "./pro-floor.ts";
import { whyFacts } from "./floor-clarity.ts";
// SEAT_IDS is a runtime value, so this import keeps its extension; the rest are
// types and are erased before Node ever resolves them.
import { SEAT_IDS } from "./types.ts";
import type { ChairResult, Gate, SeatId, SeatRow, Snapshot, Vote } from "./types";
import { CHAIR_NON_VOTER_IDS, RETIRED_SEAT_IDS, SEAT_BY_ID, TAB_SEATS } from "./seats.ts";
import { SPEAK_CONF } from "./math.ts";
import { emptyTally } from "./candle-time.ts";

// ---------------------------------------------------------------------------
// Fixtures. Deliberately explicit: a test that shares a mutable frame cannot
// prove the read model leaves its inputs alone.
// ---------------------------------------------------------------------------

const AS_OF = 1_764_600_000_000;

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    as_of: AS_OF,
    phase: "MID",
    mins_left: 7,
    secs_left: 420,
    close_time: AS_OF + 420_000,
    ticker: "KXBTC15M-26SEP2114-T85000",
    kalshi_host: "api",
    kalshi_trade_n: 3,
    kalshi_taker_yes: 1,
    official_settles: [],
    spot: 85_963,
    spot_source: "coinbase",
    spot_age_s: 1.2,
    spot_backup: 85_960,
    spot_backup_source: "binance",
    spot_div_bps: 1,
    perp: 85_970,
    perp_source: "binance",
    index_px: 85_950,
    basis_bps: -1.5,
    candles_1m: [],
    candles_5m: [],
    candles_15m: [],
    candles_1h: [],
    strike: 85_921,
    strike_source: "kalshi",
    yes_bid: 59,
    yes_ask: 61,
    no_bid: 38,
    no_ask: 40,
    leftover_cents: -1,
    combined_ask_cents: 101,
    spread_cents: 2,
    quote_age_s: 6.4,
    quote_ts: AS_OF - 6_400,
    quote_seq: 12,
    print_age_s: 3,
    last_trade_id: "t1",
    obs: {
      quote_last_change_at: AS_OF - 6_400,
      receipt_ts: AS_OF - 1_200,
      last_ok_ts: AS_OF - 1_200,
      seq: 12,
      gap: "ok",
      source: "kalshi",
      ticker: "KXBTC15M-26SEP2114-T85000",
    },
    yes_mid: 60,
    yes_mid_path: [],
    yes_mid_path_pts: [],
    candle_ts: emptyTally(),
    funding_rate: 0.0001,
    funding_apr: 1,
    funding_time: AS_OF,
    funding_history: [],
    funding_series: [],
    open_interest: 1,
    oi_usd: 1,
    oi_history: [],
    oi_series: [],
    oi_usd_series: [],
    oi_delta_3m: 0,
    oi_delta_10m: 0,
    oi_delta_1h: 0,
    oi_usd_delta_10m: 0,
    liq_long_usd: 0,
    liq_short_usd: 0,
    liq_n: 0,
    liq_source: "none",
    force_n: 0,
    cascade_proxy: false,
    fear_greed: 50,
    fear_greed_label: "neutral",
    fng_history: [],
    health: {
      spot_ok: true,
      kalshi_ok: true,
      derivs_ok: true,
      derivs_source: "binance",
      spot: "LIVE",
      kalshi: "LIVE",
      derivs: "LIVE",
      spot_divergent: false,
      basis_wide: false,
    },
    window_memory: { prior_settles: [], path_since_entry: [], streak_n: 0, streak_side: null, entry_spot: 0, entry_lean: null, tapes: [] },
    regime_key: "r",
    clock_key: "c",
    session: "US_AM",
    demo: false,
    ret5: 0.001,
    ret15: 0.002,
    ret30: 0.003,
    ret1h: 0.004,
    atr: 40,
    atr_pct: 0.2,
    vol_median: 1,
    vol_last: 1,
    vol_percentile: 50,
    location: "MID",
    range_pos: 0.6,
    imbalance: 0,
    imbalance_hist: [],
    yes_bid_size: 84,
    no_bid_size: 51,
    spot_lead_bps: 0,
    chalk: false,
    fair_yes: 66,
    edge_up: 3.3,
    edge_down: -5,
    fee_yes: 1.7,
    fee_no: 1.7,
    lab_fair_yes: 65,
    lab_locked: 12,
    lab_age_s: 3,
    ...over,
  } as Snapshot;
}

const gate = (id: string, pass: boolean, hard: boolean, value = ""): Gate => ({
  id,
  label: `${id} gate`,
  pass,
  hard,
  value,
});

function seatRow(seat: SeatId, over: Partial<SeatRow> = {}): SeatRow {
  return {
    rank: 1,
    wilson_rank: 1,
    contrib_rank: 1,
    scalp_avg: null,
    scalp_n: 0,
    calib_n: 20,
    calib: 1,
    calls: 0,
    seat,
    callsign: SEAT_BY_ID[seat].callsign,
    lean: "WAIT",
    forced_sit: false,
    conf: 0,
    skill_used: "SIT",
    base_w: 0.1,
    weight: 0.1,
    listen: 1,
    health: "LIVE",
    signed: 0,
    contribution: 0,
    shadow_lean: null,
    why: "no pattern fired",
    status: "LIVE",
    folded: false,
    ...over,
  };
}

function vote(seat: SeatId, over: Partial<Vote> = {}): Vote {
  return {
    seat,
    lean: "WAIT",
    confidence: 0,
    features: {},
    reasoning: "no pattern fired",
    skill_used: "SIT",
    skill_status: "SIT",
    shadow: null,
    paper: [],
    thresh_used: [],
    skill_n: 0,
    skill_hits: 0,
    skill_wilson: 0,
    hypothesis: "",
    evidence: [],
    counter: "",
    invalidate_if: "",
    health: "LIVE",
    feed_age_s: 1,
    eyes: "",
    phase: "MID",
    raw_lean: "WAIT",
    raw_conf: 0,
    ...over,
  };
}

function chairResult(over: Partial<ChairResult> = {}): ChairResult {
  const rows = (over.rows ?? SEAT_IDS.filter((s) => !CHAIR_NON_VOTER_IDS.includes(s)).map((s) => seatRow(s))) as SeatRow[];
  return {
    lean: "WAIT",
    confidence: 76,
    score: 0.49,
    bar: 0.57,
    bar_breakdown: { base: 0.3, quiet: 0.08, weekend: 0, phase: 0, law_miss1: 0, calib_tax: 0, sit_mass: 0.19, knn: 0, pre_clamp: 0.57, final: 0.57 },
    vs_bar: 0.49,
    dir_mass: 0.4,
    sit_total_mass: 1.2,
    aggressiveness: 1,
    time_factor: 1,
    diversity: 1,
    sit_mass: 0.95,
    conflict_frac: 0.1,
    fade_fold: "none",
    invert_cap: "none",
    tax: "",
    tax_applied: false,
    calib_tax_line: "no tax",
    law_dimmer: "off",
    full_conf_raw: 76,
    calc: "score = ...",
    gates: [gate("bar", false, true, "|0.490| × 1.00 = 0.490 vs bar 0.57 (sit 0.95)"), gate("quiet", false, false, "ATR% 0.200"), gate("warden", true, true), gate("edge", true, true)],
    hard_fail: true,
    hypothesis: "the tape is balanced",
    evidence: ["DRIFT reads up", "STREAK reads down"],
    counter: "the book is thin",
    decision: "WAIT",
    invalidate_if: "if quote age > 25s",
    huddle_line: "",
    last_settle: "",
    knn_note: "",
    wait_note: "the seats do not agree",
    walk: null,
    quorum: { up: 0, down: 0, wait: 18 },
    rows,
    categories_agree: 1,
    size: 1,
    size_note: "one contract",
    pit_tags: [],
    ...over,
  };
}

const build = (over: { snap?: Partial<Snapshot>; chair?: Partial<ChairResult>; votes?: Vote[] } = {}): ProFloorFacts =>
  proFloorFacts({
    snap: snapshot(over.snap),
    chair: chairResult(over.chair),
    votes: over.votes ?? SEAT_IDS.map((s) => vote(s)),
    callLog: [],
    plain: "The Chair is waiting.",
  });

// ---------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------

test("the same frame always produces the same facts, and nothing upstream is mutated", () => {
  const snap = snapshot();
  const chair = chairResult();
  const votes = SEAT_IDS.map((s) => vote(s));
  const log: never[] = [];
  const before = JSON.stringify({ snap, chair, votes, log });

  const a = proFloorFacts({ snap, chair, votes, callLog: log, plain: "x" });
  const b = proFloorFacts({ snap, chair, votes, callLog: log, plain: "x" });

  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), "same frame, same facts");
  assert.equal(JSON.stringify({ snap, chair, votes, log }), before, "no input was mutated");
});

test("the read model carries no clock, no database and no network of its own", async () => {
  const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("./pro-floor.ts", import.meta.url), "utf8"));
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const banned of ["Date.now", "new Date(", "fetch(", "getSql", "@/lib/db", "Math.random", "setTimeout", "setInterval", "localStorage", "process.env"]) {
    assert.ok(!code.includes(banned), `pro-floor.ts must not reference ${banned}`);
  }
  // `as_of` is the frame's own stamp, never a clock the module read itself.
  assert.equal(build().as_of, AS_OF);
});

// ---------------------------------------------------------------------------
// Semantics — the whole point of the exercise
// ---------------------------------------------------------------------------

test("Chair confidence is a gate number and is never formatted as a percentage probability", () => {
  const f = build({ chair: { confidence: 76 } });
  assert.equal(f.conclusion.confidence.value, "76");
  assert.equal(f.conclusion.confidence.kind, "gate-confidence");
  assert.match(f.conclusion.confidence.gloss, /not a chance of winning/);
  assert.ok(!f.conclusion.confidence.value.includes("%"), "the value carries no percent sign");
});

test("a model fair value is labelled derived, and an executable ask stays a price", () => {
  const f = build();
  assert.equal(f.model.fair_yes.kind, "derived");
  assert.match(f.model.fair_yes.note, /DERIVED/);
  assert.match(f.model.fair_yes.note, /not a calibrated chance of winning/);
  assert.equal(f.quotes.yes_ask.kind, "executable");
  assert.match(f.quotes.yes_ask.note, /costs to buy right now/);
  assert.equal(f.model.lab_fair_yes.kind, "derived");
  // Both are cents, so only the label can tell them apart — and it does.
  assert.equal(fmtCentsFact(f.model.fair_yes), "66.0¢");
  assert.equal(fmtCentsFact(f.quotes.yes_ask), "61.0¢");
});

test("a missing number renders unavailable, never as a zero", () => {
  const f = build({ snap: { yes_ask: 0, fair_yes: 0, spread_cents: Number.NaN, yes_bid_size: Number.NaN } });
  assert.equal(f.quotes.yes_ask.cents, null, "a 0¢ ask is not a tradeable price");
  assert.ok(f.quotes.yes_ask.unavailable_why.length > 0, "and it says why");
  assert.equal(f.model.fair_yes.cents, null);
  assert.equal(f.quotes.spread.cents, null);
  assert.equal(f.quotes.yes_size, null, "an unreported size is not a size of zero");
  assert.equal(fmtCentsFact(f.quotes.yes_ask), "—");
  assert.equal(fmtSigned(f.model.edge), "—");
  assert.equal(fmtUsd(null), "—");
  assert.equal(fmtScore(null), "—");
  assert.equal(fmtDistance(null), "—");
  // The 999 sentinel is an unknown age, not a 999-second-old quote.
  assert.equal(marketPosition(snapshot({ spot_age_s: 999 })).spot_age_s, null);
});

test("an edge is never claimed without a side and a real ask to measure it against", () => {
  const waiting = build();
  assert.equal(waiting.model.side, null);
  assert.equal(waiting.model.edge.cents, null);
  assert.match(waiting.model.edge.unavailable_why, /the Chair is waiting/);
  assert.equal(waiting.model.breakeven_pct, null);

  const noAsk = build({ snap: { yes_ask: 0, yes_mid: 0 }, chair: { lean: "UP" } });
  assert.equal(noAsk.model.side, "UP");
  assert.equal(noAsk.model.edge.cents, null);
  assert.match(noAsk.model.edge.unavailable_why, /no real ask/);
  assert.equal(noAsk.model.priced_ask.cents, null);

  const calling = build({ chair: { lean: "UP" } });
  assert.equal(calling.model.edge.cents, 3.3, "the edge is carried from the snapshot, not recomputed");
  assert.equal(calling.model.fee.cents, 1.7);
  assert.equal(calling.model.priced_ask.cents, 61);
  assert.equal(calling.model.priced_ask_is_fallback, false);
  assert.equal(calling.model.priced_ask.kind, "executable");
});

test("an edge measured against the desk's mid fallback says so instead of implying a quoted ask", () => {
  // `markSide` substitutes the mid when a side carries no quoted ask, so the
  // economics can be priced off a number nobody is offering. The page must not
  // present that as a market price.
  const f = build({ snap: { yes_ask: 0, yes_mid: 60 }, chair: { lean: "UP" } });
  assert.equal(f.quotes.yes_ask.cents, null, "there is no quoted YES ask");
  assert.equal(f.model.priced_ask.cents, 60, "but the economics were priced against the mid");
  assert.equal(f.model.priced_ask_is_fallback, true);
  assert.equal(f.model.priced_ask.kind, "derived", "so it is labelled a derived value, not a price");
  assert.match(f.model.priced_ask.note, /no quoted ask/);
});

// ---------------------------------------------------------------------------
// Raw reads versus final votes
// ---------------------------------------------------------------------------

test("a suppressed directional read stays visible and never merges into the final vote", () => {
  const votes = SEAT_IDS.map((s) =>
    s === "CARRY" ? vote(s, { lean: "WAIT", confidence: 70, forced_sit: true, raw_lean: "UP", raw_conf: 50 }) : vote(s),
  );
  const rows = SEAT_IDS.filter((s) => !CHAIR_NON_VOTER_IDS.includes(s)).map((s) =>
    s === "CARRY" ? seatRow(s, { lean: "WAIT", conf: 70, forced_sit: true }) : seatRow(s),
  );
  const f = build({ votes, chair: { rows } });
  const carry = f.seats.find((x) => x.seat === "CARRY")!;

  assert.equal(carry.raw_lean, "UP", "the seat's own read survives");
  assert.equal(carry.raw_conf, 50, "at its own confidence");
  assert.equal(carry.final_lean, "WAIT", "and the Chair heard a WAIT");
  assert.equal(carry.voice, "suppressed");
  assert.equal(carry.suppression, "below-speak-bar");
  assert.equal(carry.speak_bar, SPEAK_CONF);
  assert.ok(carry.raw_conf! < carry.speak_bar!);

  // The recorded final confidence is a transform, not a reading — and is marked.
  assert.equal(carry.final_conf, 70);
  assert.equal(carry.final_conf_transformed, true);
  assert.notEqual(carry.final_conf, carry.raw_conf);

  assert.equal(f.balance.suppressed.up, 1);
  assert.equal(f.balance.suppressed.down, 0);
  assert.equal(f.families.find((x) => x.family === "derivs")!.suppressed_up, 1);
});

test("a genuine WAIT is distinguishable from a suppressed one", () => {
  const votes = SEAT_IDS.map((s) =>
    s === "WICK"
      ? vote(s, { lean: "WAIT", raw_lean: "WAIT", raw_conf: 0 })
      : s === "DRIFT"
        ? vote(s, { lean: "WAIT", confidence: 70, forced_sit: true, raw_lean: "DOWN", raw_conf: 25 })
        : vote(s),
  );
  const f = build({ votes });
  const wick = f.seats.find((x) => x.seat === "WICK")!;
  const drift = f.seats.find((x) => x.seat === "DRIFT")!;
  assert.equal(wick.voice, "waiting");
  assert.equal(wick.suppression, null);
  assert.equal(VOICE_LABEL[wick.voice], "no directional read");
  assert.equal(drift.voice, "suppressed");
  assert.equal(SUPPRESSION_LABEL[drift.suppression!], "below its speaking bar");
});

test("non-voters and retired seats are never presented as active directional speakers", () => {
  const votes = SEAT_IDS.map((s) =>
    CHAIR_NON_VOTER_IDS.includes(s)
      ? vote(s, { lean: "UP", confidence: 84, raw_lean: "UP", raw_conf: 84 })
      : RETIRED_SEAT_IDS.includes(s)
        ? vote(s, { lean: "WAIT", confidence: 70, forced_sit: true, raw_lean: "UP", raw_conf: 80 })
        : vote(s),
  );
  const f = build({ votes });
  for (const s of CHAIR_NON_VOTER_IDS) {
    const seat = f.seats.find((x) => x.seat === s)!;
    assert.equal(seat.voice, "non-voter", `${s} is pit crew`);
    assert.equal(seat.aggregated, false, `${s} is not one of the Chair's rows`);
  }
  for (const s of RETIRED_SEAT_IDS) {
    const seat = f.seats.find((x) => x.seat === s)!;
    assert.equal(seat.voice, "retired");
    assert.equal(seat.suppression, "retired");
  }
  assert.equal(f.seats.filter((x) => x.voice === "speaking").length, 0, "none of them speaks");
  assert.equal(f.balance.aggregated, SEAT_IDS.length - CHAIR_NON_VOTER_IDS.length - RETIRED_SEAT_IDS.length);
});

test("an unhealthy feed silences a seat and says so rather than calling it a WAIT", () => {
  const votes = SEAT_IDS.map((s) => (s === "PULSE" ? vote(s, { health: "DOWN", lean: "WAIT", raw_lean: "UP", raw_conf: 60 }) : vote(s)));
  const rows = SEAT_IDS.filter((s) => !CHAIR_NON_VOTER_IDS.includes(s)).map((s) => (s === "PULSE" ? seatRow(s, { health: "DOWN", status: "DOWN" }) : seatRow(s)));
  const f = build({ votes, chair: { rows } });
  const pulse = f.seats.find((x) => x.seat === "PULSE")!;
  assert.equal(pulse.voice, "unhealthy");
  assert.equal(pulse.suppression, "feed");
  assert.equal(f.balance.unhealthy, 1);
});

test("when the frame cannot prove why a read was held back, no reason is invented", () => {
  // Force-sat with a directional raw read, but its confidence already clears the
  // speaking bar — so the bar is not a provable explanation.
  const votes = SEAT_IDS.map((s) => (s === "VEL" ? vote(s, { lean: "WAIT", confidence: 70, forced_sit: true, raw_lean: "UP", raw_conf: 88 }) : vote(s)));
  const f = build({ votes });
  const vel = f.seats.find((x) => x.seat === "VEL")!;
  assert.equal(vel.voice, "suppressed");
  assert.equal(vel.suppression, null, "no reason is asserted that the numbers do not support");
});

// ---------------------------------------------------------------------------
// WAIT — four situations, four remedies
// ---------------------------------------------------------------------------

test("a below-bar WAIT names low confluence, not a hard block, without promising a call", () => {
  // chair.ts publishes the score comparison as a HARD gate, so a purely
  // low-confluence WAIT always carries a failing hard gate and the existing
  // helper classifies it "hard-gate". Calling that a HARD BLOCK on screen would
  // claim a safety gate tripped. The display kind corrects the naming only.
  const chair = chairResult({ lean: "WAIT", score: 0.49, bar: 0.57, gates: [gate("bar", false, true, "|0.490| × 1.00 = 0.490 vs bar 0.57")] });
  const why = whyFacts(chair, "");
  const f = waitFacts(chair, why);
  assert.equal(why.wait_reason, "hard-gate", "the existing helper is carried unchanged");
  assert.equal(f.kind, "hard-gate");
  assert.equal(f.display, "under-bar", "and the page names the situation honestly");
  assert.equal(f.headline, "LOW CONFLUENCE");
  assert.match(f.explanation, /do not agree hard enough/);
  assert.ok(!/will call|would call|guarantee/i.test(f.explanation));
});

test("a failing bar gate beside any other hard gate is still a hard block", () => {
  const chair = chairResult({ lean: "WAIT", gates: [gate("bar", false, true), gate("late", false, true, "12s left")] });
  const f = waitFacts(chair, whyFacts(chair, ""));
  assert.equal(f.display, "hard-gate", "the bar is not the only thing failing");
  assert.equal(f.headline, "HARD BLOCK");
  assert.equal(f.more_than_one_thing_missing, true);
});

test("a hard-gate WAIT is a different state from a below-bar one", () => {
  const chair = chairResult({ lean: "WAIT", score: 0.9, bar: 0.5, gates: [gate("bar", true, true), gate("late", false, true, "12s left")] });
  const f = waitFacts(chair, whyFacts(chair, ""));
  assert.equal(f.kind, "hard-gate");
  assert.equal(f.headline, "HARD BLOCK");
  assert.equal(f.blocking.length, 1);
  assert.equal(f.blocking[0]!.id, "late");
  assert.match(f.explanation, /not the thing standing in the way/);
});

test("a feed-condition WAIT outranks every other reason", () => {
  const chair = chairResult({ lean: "WAIT", score: 0.1, bar: 0.5, gates: [gate("warden", false, true, "tape frozen"), gate("late", false, true), gate("bar", false, true)] });
  const f = waitFacts(chair, whyFacts(chair, ""));
  assert.equal(f.kind, "feed-condition");
  assert.equal(f.headline, "FEED CONDITION");
  assert.equal(f.feed_gates.length, 1);
  assert.match(f.explanation, /does not trust its own inputs/);
});

test("a no-edge WAIT is a legitimate abstention, not a failure", () => {
  const chair = chairResult({ lean: "WAIT", score: 0.9, bar: 0.5, gates: [gate("bar", true, true), gate("edge", true, true)] });
  const f = waitFacts(chair, whyFacts(chair, ""));
  assert.equal(f.kind, "no-edge");
  assert.equal(f.headline, "NO EDGE");
  assert.match(f.explanation, /does not pay for the read/);
  assert.equal(f.blocking.length, 0);
});

test("with several blockers the facts refuse to suggest that clearing one produces a call", () => {
  const chair = chairResult({ lean: "WAIT", score: 0.2, bar: 0.6, gates: [gate("bar", false, true), gate("late", false, true), gate("spread", false, false)] });
  const why = whyFacts(chair, "");
  const w = waitFacts(chair, why);
  const s = standardFacts(chair, why);
  assert.equal(w.more_than_one_thing_missing, true);
  assert.equal(s.more_than_one_thing_missing, true);
  assert.ok(w.blocking.length >= 2);
});

test("a directional read carries no WAIT explanation at all", () => {
  const f = build({ chair: { lean: "UP", gates: [gate("bar", true, true), gate("edge", true, true)] } });
  assert.equal(f.wait.waiting, false);
  assert.equal(f.wait.kind, "");
  assert.equal(f.wait.headline, "");
  assert.equal(f.wait.explanation, "");
});

// ---------------------------------------------------------------------------
// The score against the bar
// ---------------------------------------------------------------------------

test("score-versus-bar uses the Chair's own comparison and its own recorded verdict", () => {
  const chair = chairResult({
    score: 0.49,
    aggressiveness: 1,
    vs_bar: 0.49,
    bar: 0.57,
    gates: [gate("bar", false, true, "|0.490| × 1.00 = 0.490 vs bar 0.57 (sit 0.95)")],
  });
  const s = standardFacts(chair, whyFacts(chair, ""));
  assert.equal(s.evidence, chair.vs_bar, "the quantity is vs_bar, not |score| and not a new one");
  assert.equal(s.required, chair.bar);
  assert.equal(s.met, false, "the verdict is read off the Chair's own bar gate");
  assert.ok(Math.abs(s.margin! - -0.08) < 1e-9, "short by 0.08");
  assert.match(s.gate_value, /vs bar 0\.57/);

  // Aggressiveness matters, and the model must not silently drop it.
  const agg = chairResult({ score: 0.5, aggressiveness: 1.2, vs_bar: 0.6, bar: 0.57, gates: [gate("bar", true, true, "ok")] });
  const sa = standardFacts(agg, whyFacts(agg, ""));
  assert.equal(sa.evidence, 0.6);
  assert.equal(sa.met, true);
  assert.ok(sa.margin! > 0);
  assert.notEqual(sa.evidence, agg.score, "vs_bar is not the raw score");
});

test("with no bar gate on the frame the comparison is unavailable rather than reconstructed", () => {
  const chair = chairResult({ gates: [gate("edge", true, true)] });
  const s = standardFacts(chair, whyFacts(chair, ""));
  assert.equal(s.met, null, "no recorded verdict, so none is claimed");
  assert.equal(s.gate_value, "");
  assert.equal(s.signal_agrees, false);
});

// ---------------------------------------------------------------------------
// Evidence families
// ---------------------------------------------------------------------------

test("every seat lands in its existing family, and the five families cover all 21", () => {
  const f = build();
  assert.equal(f.seats.length, SEAT_IDS.length);
  assert.equal(new Set(f.seats.map((s) => s.seat)).size, SEAT_IDS.length, "no seat appears twice");
  assert.equal(f.families.length, 5);
  for (const fam of f.families) {
    const expected = TAB_SEATS[fam.family];
    assert.deepEqual(fam.seats.map((s) => s.seat), expected, `${fam.family} holds exactly its own seats`);
  }
  assert.equal(f.families.reduce((n, fam) => n + fam.seats.length, 0), SEAT_IDS.length);
});

test("family counts reconcile with the seat rows they are drawn from", () => {
  const votes = SEAT_IDS.map((s) =>
    s === "DRIFT"
      ? vote(s, { lean: "UP", confidence: 68, raw_lean: "UP", raw_conf: 68 })
      : s === "STREAK"
        ? vote(s, { lean: "DOWN", confidence: 61, raw_lean: "DOWN", raw_conf: 61 })
        : vote(s),
  );
  const rows = SEAT_IDS.filter((s) => !CHAIR_NON_VOTER_IDS.includes(s)).map((s) =>
    s === "DRIFT" ? seatRow(s, { lean: "UP", conf: 68 }) : s === "STREAK" ? seatRow(s, { lean: "DOWN", conf: 61 }) : seatRow(s),
  );
  const seats = seatFacts(chairResult({ rows }), votes, undefined, AS_OF);
  const fams = familyFacts(seats);
  const structure = fams.find((x) => x.family === "structure")!;
  assert.equal(structure.up, 1);
  assert.equal(structure.down, 1);
  assert.equal(structure.wait, 2);
  assert.equal(structure.up + structure.down + structure.wait, structure.seats.length);
  assert.equal(structure.split, true, "speakers on both sides is a split");
  for (const fam of fams) {
    assert.equal(fam.up, fam.seats.filter((s) => s.voice === "speaking" && s.final_lean === "UP").length);
    assert.equal(fam.down, fam.seats.filter((s) => s.voice === "speaking" && s.final_lean === "DOWN").length);
  }
});

test("the balance is a count and never a second house call", () => {
  const chair = chairResult({ quorum: { up: 5, down: 2, wait: 11 } });
  const seats = seatFacts(chair, SEAT_IDS.map((s) => vote(s)), undefined, AS_OF);
  const b = balanceFacts(chair, seats, familyFacts(seats));
  assert.deepEqual(b.speaking, chair.quorum, "the speaking counts are the Chair's own quorum");
  assert.equal(b.label, "Evidence balance");
  assert.match(b.disclaimer, /not a second opinion/);
  // There is no aggregate lean field to mistake for a call.
  assert.ok(!("lean" in b) && !("call" in b) && !("recommendation" in b));
});

// ---------------------------------------------------------------------------
// Gates, invalidation, health, paper
// ---------------------------------------------------------------------------

test("gates are the Chair's own, split into what blocks and what only taxes", () => {
  const chair = chairResult({ gates: [gate("bar", false, true), gate("quiet", false, false), gate("warden", true, true)] });
  const g = gateFacts(chair);
  assert.deepEqual(g.blocking.map((x) => x.id), ["bar"]);
  assert.deepEqual(g.soft_failing.map((x) => x.id), ["quiet"]);
  assert.deepEqual(g.passing.map((x) => x.id), ["warden"]);
  assert.equal(g.all.length, 3, "nothing is added and nothing is dropped");
  assert.equal(g.bar_gate!.id, "bar");
});

test("invalidation stays a condition that ends a read and is never reversed into a trigger", () => {
  const f = build({ chair: { invalidate_if: "if quote age > 25s" } });
  assert.equal(f.invalidation.condition, "quote age > 25s", "the joining 'if' is stripped exactly once");
  assert.equal(f.invalidation.line, "The read is off if quote age > 25s");
  assert.ok(!/buy|enter|take|when to/i.test(f.invalidation.line));
  const none = build({ chair: { invalidate_if: "" } });
  assert.equal(none.invalidation.available, false);
});

test("data health keeps receipt age and last-change age apart", () => {
  const f = build({ snap: { quote_age_s: 40 } });
  assert.equal(f.health.fresh.last_change_age_s, 40, "the book moved 40s ago");
  assert.equal(f.health.fresh.receipt_age_s, 1, "and the feed answered 1s ago");
  assert.equal(f.health.fresh.source_time_available, false);
  assert.equal(f.health.kalshi, "LIVE", "a quiet book is not a stale feed");
  assert.equal(f.health.all_clear, true);

  const bad = build({ snap: { health: { ...snapshot().health, kalshi: "STALE" }, obs: { ...snapshot().obs, gap: "gap" } } });
  assert.equal(bad.health.all_clear, false);
});

test("the paper book is reported separately from the live read", () => {
  const waiting = build();
  assert.equal(waiting.paper.held, false);
  assert.equal(waiting.paper.entry_cents, null);
  assert.match(waiting.paper.no_position_why, /the Chair is waiting/);

  // A directional read whose ask is under the floor is not a position.
  const under = build({ snap: { yes_ask: 61 }, chair: { lean: "UP" } });
  assert.equal(under.paper.held, false);
  assert.match(under.paper.no_position_why, /under the 80¢ paper floor/);

  const booked = proFloorFacts({
    snap: snapshot(),
    chair: chairResult({ lean: "UP" }),
    votes: SEAT_IDS.map((s) => vote(s)),
    callLog: [{ id: "1", t: AS_OF - 60_000, ticker: snapshot().ticker, close_time: snapshot().close_time, lean: "UP", cents: 82, settle: null, flipped: false }],
    plain: "",
  });
  assert.equal(booked.paper.held, true);
  assert.equal(booked.paper.entry_cents, 82);
  assert.equal(booked.paper.entry_side, "UP");
  assert.equal(booked.paper.entry_at, AS_OF - 60_000);
});

test("market position states which side of the line spot sits on, and says when it cannot", () => {
  const above = marketPosition(snapshot({ spot: 85_963, strike: 85_921 }));
  assert.equal(above.relation, "ABOVE");
  assert.equal(above.distance, 42);
  assert.equal(fmtDistance(above.distance), "+$42");

  const below = marketPosition(snapshot({ spot: 85_900, strike: 85_921 }));
  assert.equal(below.relation, "BELOW");
  assert.equal(fmtDistance(below.distance), "−$21");

  assert.equal(marketPosition(snapshot({ spot: 85_921, strike: 85_921 })).relation, "AT LINE");
  const dark = marketPosition(snapshot({ spot: 0 }));
  assert.equal(dark.relation, "UNKNOWN");
  assert.equal(dark.distance, null);
  assert.equal(dark.spot, null);
});

test("quotes and the model are read straight off the snapshot the engine built", () => {
  const snap = snapshot();
  const q = quoteFacts(snap);
  assert.equal(q.yes_ask.cents, snap.yes_ask);
  assert.equal(q.no_ask.cents, snap.no_ask);
  assert.equal(q.spread.cents, snap.spread_cents);
  assert.equal(q.yes_size, snap.yes_bid_size);
  const m = modelFacts(snap, chairResult({ lean: "UP" }));
  assert.equal(m.fair_yes.cents, snap.fair_yes);
  assert.equal(m.fee.cents, snap.fee_yes);
  assert.equal(m.edge.cents, snap.edge_up);
  assert.equal(m.economics.ask, 61, "the economics box is carried whole");
});

// ---------------------------------------------------------------------------
// Review round 2: five semantics the UI could previously misstate
// ---------------------------------------------------------------------------

test("the venue index is never presented as the settlement index", () => {
  // `snap.index_px` on this repo is an OKX/Binance PERPETUAL index and
  // `basis_bps` is perp-vs-spot basis. The contract settles on the CF
  // Benchmarks value, which this frame does not carry at all.
  const m = marketPosition(snapshot({ index_px: 85_950, basis_bps: -1.5 }));
  assert.equal(m.venue_index, 85_950);
  assert.equal(m.venue_basis_bps, -1.5);
  // The old field names are gone, so nothing can read one as the other.
  assert.equal("index" in m, false);
  assert.equal("basis_bps" in m, false);
  assert.equal("settlement_index" in m, false);

  const dark = marketPosition(snapshot({ index_px: 0 }));
  assert.equal(dark.venue_index, null, "a zero index is not a venue index either");
});

test("executable economics require a quoted ask; a midpoint fallback yields only a diagnostic", () => {
  // `markSide` substitutes the mid when the side has no quoted ask, so the
  // economics can be priced off a number nobody is offering. Presenting an edge,
  // a breakeven rate or a floor verdict from that would claim actionable market
  // economics that do not exist.
  const fallback = build({ snap: { yes_ask: 0, yes_mid: 60 }, chair: { lean: "UP" } });
  assert.equal(fallback.quotes.yes_ask.cents, null, "there is no quoted YES ask");
  assert.equal(fallback.model.priced_ask.cents, 60, "the desk still priced against its mid");
  assert.equal(fallback.model.priced_ask_is_fallback, true);
  assert.equal(fallback.model.executable, false, "so nothing executable may be claimed");

  assert.equal(fallback.model.edge.cents, null, "no executable edge");
  assert.match(fallback.model.edge.unavailable_why, /nothing executable/);
  assert.equal(fallback.model.breakeven_pct, null, "no breakeven rate");
  assert.equal(fallback.model.bookable, null, "and no floor verdict about a midpoint");

  // The number survives, clearly labelled as a modelling observation.
  assert.equal(fallback.model.diagnostic_edge.cents, 3.3);
  assert.equal(fallback.model.diagnostic_edge.kind, "derived");
  assert.match(fallback.model.diagnostic_edge.note, /not an edge anyone could take/);

  // With a real quoted ask everything is executable and the diagnostic stands down.
  const real = build({ chair: { lean: "UP" } });
  assert.equal(real.model.executable, true);
  assert.equal(real.model.edge.cents, 3.3);
  assert.match(real.model.edge.note, /real quoted ask/);
  assert.equal(real.model.breakeven_pct, 62.7);
  assert.equal(real.model.bookable, false, "61¢ is under the 80¢ paper floor");
  assert.equal(real.model.diagnostic_edge.cents, null, "no diagnostic when the market answers");

  // And with no side at all, nothing is claimed either way.
  const waiting = build();
  assert.equal(waiting.model.executable, false);
  assert.equal(waiting.model.bookable, null);
  assert.equal(waiting.model.diagnostic_edge.cents, null);
});

test("a STALE seat that still speaks is counted as a speaker, with its feed warning", () => {
  // `applyHealth` only silences a DOWN feed. A STALE one keeps the seat's
  // direction and multiplies its confidence by 0.6, so it can still clear the
  // speaking bar and reach the Chair. Classifying it as unhealthy removed a
  // real vote from the family counts while the Chair was still hearing it.
  const votes = SEAT_IDS.map((s) =>
    s === "DRIFT"
      ? vote(s, { lean: "UP", confidence: 41, health: "STALE", raw_lean: "UP", raw_conf: 68 })
      : s === "PULSE"
        ? vote(s, { lean: "WAIT", confidence: 0, health: "DOWN", raw_lean: "UP", raw_conf: 60 })
        : vote(s),
  );
  const rows = SEAT_IDS.filter((s) => !CHAIR_NON_VOTER_IDS.includes(s)).map((s) =>
    s === "DRIFT"
      ? seatRow(s, { lean: "UP", conf: 41, health: "STALE", contribution: 0.12 })
      : s === "PULSE"
        ? seatRow(s, { lean: "WAIT", conf: 0, health: "DOWN", status: "DOWN" })
        : seatRow(s),
  );
  const f = build({ votes, chair: { rows, quorum: { up: 1, down: 0, wait: 17 } } });

  const drift = f.seats.find((x) => x.seat === "DRIFT")!;
  assert.equal(drift.voice, "speaking", "a STALE seat that speaks IS a speaker");
  assert.equal(drift.final_lean, "UP");
  assert.equal(drift.health, "STALE");
  assert.equal(drift.health_warning, true, "and the warning rides with the vote");
  assert.equal(drift.suppression, null, "its feed did not suppress it");

  // A DOWN feed genuinely did silence its seat, and that is still reported.
  const pulse = f.seats.find((x) => x.seat === "PULSE")!;
  assert.equal(pulse.voice, "unhealthy");
  assert.equal(pulse.suppression, "feed");

  // The family counts the STALE speaker, and does not count it as silenced.
  const structure = f.families.find((x) => x.family === "structure")!;
  assert.equal(structure.up, 1, "the STALE speaker is in the UP count");
  assert.equal(structure.unhealthy, 0, "and is not counted as silenced");
  assert.equal(structure.stale_speakers, 1, "but is flagged");
  const tape = f.families.find((x) => x.family === "tape")!;
  assert.equal(tape.unhealthy, 1, "the DOWN seat is the silenced one");
  assert.equal(f.balance.unhealthy, 1);
});

test("an ordinary speaker's raw read falls back to its final vote; a forced sit's never does", () => {
  // The pipeline's own convention is `raw_lean ?? lean`, because an unsuppressed
  // speaker's final vote IS its raw read. Reading only the explicit field left
  // every ordinary speaker showing "—", as though it had seen nothing.
  const votes = SEAT_IDS.map((s) => {
    if (s === "DRIFT") {
      // An ordinary speaker whose vote carries no explicit raw fields.
      const v = vote(s, { lean: "UP", confidence: 68 });
      delete v.raw_lean;
      delete v.raw_conf;
      return v;
    }
    if (s === "STREAK") {
      // A genuine WAIT with no explicit raw fields is still a genuine WAIT.
      const v = vote(s, { lean: "WAIT", confidence: 12 });
      delete v.raw_lean;
      delete v.raw_conf;
      return v;
    }
    if (s === "CARRY") {
      // A forced sit: `lean` became WAIT and `confidence` became max(70, raw).
      const v = vote(s, { lean: "WAIT", confidence: 70, forced_sit: true });
      delete v.raw_lean;
      delete v.raw_conf;
      return v;
    }
    return vote(s);
  });
  const rows = SEAT_IDS.filter((s) => !CHAIR_NON_VOTER_IDS.includes(s)).map((s) =>
    s === "DRIFT"
      ? seatRow(s, { lean: "UP", conf: 68 })
      : s === "STREAK"
        ? seatRow(s, { lean: "WAIT", conf: 12 })
        : s === "CARRY"
          ? seatRow(s, { lean: "WAIT", conf: 70, forced_sit: true })
          : seatRow(s),
  );
  const f = build({ votes, chair: { rows } });

  const drift = f.seats.find((x) => x.seat === "DRIFT")!;
  assert.equal(drift.raw_lean, "UP", "an ordinary speaker's raw read is its vote");
  assert.equal(drift.raw_conf, 68);
  assert.equal(drift.final_lean, "UP");
  assert.equal(drift.final_conf_transformed, false);

  const streak = f.seats.find((x) => x.seat === "STREAK")!;
  assert.equal(streak.raw_lean, "WAIT", "a genuine WAIT reads as a WAIT, not as unknown");
  assert.equal(streak.raw_conf, 12);
  assert.equal(streak.voice, "waiting");

  // The forced sit must NOT fall back: doing so would report the transform
  // (WAIT at 70) as the seat's own reading.
  const carry = f.seats.find((x) => x.seat === "CARRY")!;
  assert.equal(carry.raw_lean, null, "a transformed vote is never its own raw read");
  assert.equal(carry.raw_conf, null);
  assert.equal(carry.final_lean, "WAIT");
  assert.equal(carry.final_conf, 70);
  assert.equal(carry.final_conf_transformed, true);
  assert.notEqual(carry.raw_conf, carry.final_conf);

  // An explicit raw field always wins over the fallback.
  const explicit = build({
    votes: SEAT_IDS.map((s) => (s === "VEL" ? vote(s, { lean: "UP", confidence: 70, raw_lean: "DOWN", raw_conf: 31 }) : vote(s))),
  });
  const vel = explicit.seats.find((x) => x.seat === "VEL")!;
  assert.equal(vel.raw_lean, "DOWN");
  assert.equal(vel.raw_conf, 31);
});

test("all clear covers every feed and check the card displays, and names what is not clear", () => {
  const healthy = build();
  assert.equal(healthy.health.all_clear, true);
  assert.deepEqual(healthy.health.blockers, []);

  // The regression: derivatives DOWN while spot, Kalshi and the sequence are
  // fine used to read ALL CLEAR on a card that displays derivatives.
  const derivsDown = build({ snap: { health: { ...snapshot().health, derivs: "DOWN" } } });
  assert.equal(derivsDown.health.derivs, "DOWN");
  assert.equal(derivsDown.health.all_clear, false, "a dead desk feed is not all clear");
  assert.deepEqual(derivsDown.health.blockers, ["derivs DOWN"]);

  // Every other condition the card shows counts too.
  for (const [over, want] of [
    [{ health: { ...snapshot().health, spot: "STALE" as const } }, ["spot STALE"]],
    [{ health: { ...snapshot().health, kalshi: "DOWN" as const } }, ["kalshi DOWN"]],
    [{ health: { ...snapshot().health, spot_divergent: true } }, ["spot sources diverge"]],
    [{ health: { ...snapshot().health, basis_wide: true } }, ["basis wide"]],
    [{ obs: { ...snapshot().obs, gap: "gap" as const } }, ["sequence gap"]],
  ] as const) {
    const f = build({ snap: over });
    assert.equal(f.health.all_clear, false, `${want[0]} must not read as all clear`);
    assert.deepEqual(f.health.blockers, want);
  }

  // Several at once are all named, so the badge is never vague.
  const bad = build({
    snap: { health: { ...snapshot().health, derivs: "DOWN", basis_wide: true }, obs: { ...snapshot().obs, gap: "reconnect" } },
  });
  assert.equal(bad.health.all_clear, false);
  assert.deepEqual(bad.health.blockers, ["derivs DOWN", "sequence reconnect", "basis wide"]);
});

// ---------------------------------------------------------------------------
// Review round 3: authority before direction, and STALE is not suppression
// ---------------------------------------------------------------------------

/** One seat given a distinct state, every other seat quiet. */
function oneSeat(seat: SeatId, v: Partial<Vote>, r: Partial<SeatRow>, chair: Partial<ChairResult> = {}) {
  const votes = SEAT_IDS.map((s) => (s === seat ? vote(s, v) : vote(s)));
  const rows = SEAT_IDS.filter((s) => !CHAIR_NON_VOTER_IDS.includes(s)).map((s) =>
    s === seat ? seatRow(s, r) : seatRow(s),
  );
  return build({ votes, chair: { rows, ...chair } });
}

const famOf = (f: ProFloorFacts, seat: SeatId) => f.families.find((x) => x.seats.some((s) => s.seat === seat))!;
const seatOf = (f: ProFloorFacts, seat: SeatId) => f.seats.find((x) => x.seat === seat)!;

test("a MUTED seat leaning a side is not a speaker and never inflates a family count", () => {
  // chair.ts sets `status = MUTED` and zeroes the weight; it does NOT rewrite
  // the vote, so the lean survives. Reading the lean before the authority would
  // draw this seat as a speaker while the Chair gives it nothing.
  const f = oneSeat(
    "DRIFT",
    { lean: "UP", confidence: 74, raw_lean: "UP", raw_conf: 74 },
    { lean: "UP", conf: 74, status: "MUTED", weight: 0, contribution: 0 },
  );
  const drift = seatOf(f, "DRIFT");
  assert.notEqual(drift.voice, "speaking", "authority is checked before direction");
  assert.equal(drift.voice, "muted");
  assert.equal(drift.suppression, "muted");
  assert.equal(drift.final_lean, "UP", "the lean itself is still reported");
  assert.equal(drift.raw_lean, "UP", "and its raw read stays visible separately");
  assert.equal(drift.raw_conf, 74);
  assert.match(VOICE_LABEL[drift.voice], /no weight/);

  const fam = famOf(f, "DRIFT");
  assert.equal(fam.up, 0, "a muted seat is not in the family UP count");
  assert.equal(fam.no_authority, 1, "it is reported as leaning without authority");
  assert.equal(f.balance.no_authority.up, 1);
  assert.equal(f.balance.suppressed.up, 1, "its directional read is still surfaced");
});

test("a VETO seat leaning a side is not a speaker, and the page says only what the frame proves", () => {
  const f = oneSeat(
    "STREAK",
    { lean: "DOWN", confidence: 66, raw_lean: "DOWN", raw_conf: 66 },
    { lean: "DOWN", conf: 66, status: "VETO", weight: 0, contribution: 0 },
  );
  const streak = seatOf(f, "STREAK");
  assert.notEqual(streak.voice, "speaking");
  assert.equal(streak.voice, "vetoed");
  assert.equal(streak.suppression, "veto");
  assert.equal(streak.final_lean, "DOWN");
  // A sequence gap and a both-feeds-down condition both produce VETO, so the
  // label must not claim which one it was.
  assert.match(VOICE_LABEL[streak.voice], /^VETO/);
  assert.match(SUPPRESSION_LABEL[streak.suppression!], /^VETO — the Chair removed its authority/);
  assert.doesNotMatch(SUPPRESSION_LABEL[streak.suppression!], /sequence|gap|both/i, "no cause is invented");

  const fam = famOf(f, "STREAK");
  assert.equal(fam.down, 0, "a vetoed seat is not in the family DOWN count");
  assert.equal(fam.no_authority, 1);
  assert.equal(f.balance.veto_directional.down, 1);
});

test("a STALE seat that survives its speaking bar IS a speaker, with a warning", () => {
  // `applyHealth` only scales a STALE seat's confidence by 0.6; it does not
  // silence it. This one cleared its bar, so the Chair heard it.
  const f = oneSeat(
    "WICK",
    { lean: "UP", confidence: 55, health: "STALE", raw_lean: "UP", raw_conf: 55 },
    { lean: "UP", conf: 55, health: "STALE", contribution: 0.17 },
    { quorum: { up: 1, down: 0, wait: 17 } },
  );
  const wick = seatOf(f, "WICK");
  assert.equal(wick.voice, "speaking");
  assert.equal(wick.suppression, null, "STALE is not a suppression reason");
  assert.equal(wick.health, "STALE");
  assert.equal(wick.health_warning, true);

  const fam = famOf(f, "WICK");
  assert.equal(fam.up, 1, "a STALE speaker counts as a speaker");
  assert.equal(fam.stale_speakers, 1, "and is flagged");
  assert.equal(fam.unhealthy, 0, "it was not silenced");
  assert.equal(f.balance.unhealthy, 0);
});

test("a STALE read forced below the speaking bar is suppressed by the BAR, not by the feed", () => {
  // The real pipeline order: applyHealth scales the seat's confidence by 0.6
  // for STALE, then sitUnlessSure records raw_conf at the SCALED value and
  // forces WAIT because it now sits under the seat's bar. The feed did not
  // silence it; the bar did. 85 x 0.6 = 51, one point under the 52 bar.
  const scaled = Math.round(85 * 0.6);
  assert.ok(scaled < SPEAK_CONF, "the fixture really is under the bar");
  const f = oneSeat(
    "EXHAUST",
    { lean: "WAIT", confidence: 70, forced_sit: true, health: "STALE", raw_lean: "UP", raw_conf: scaled },
    { lean: "WAIT", conf: 70, forced_sit: true, health: "STALE" },
  );
  const seat = seatOf(f, "EXHAUST");
  assert.equal(seat.voice, "suppressed");
  assert.equal(seat.suppression, "below-speak-bar");
  assert.notEqual(seat.suppression, "feed", "STALE did not directly silence it");
  assert.equal(seat.health_warning, true, "the STALE warning is still visible");
  assert.equal(seat.raw_lean, "UP");
  assert.equal(seat.raw_conf, scaled);
  assert.equal(seat.final_conf_transformed, true);

  const fam = famOf(f, "EXHAUST");
  assert.equal(fam.up, 0);
  assert.equal(fam.unhealthy, 0, "not counted as feed-silenced");
  assert.equal(fam.suppressed_up, 1);
});

test("a STALE seat with no directional read is a genuine WAIT, not a feed suppression", () => {
  const f = oneSeat(
    "VOLT",
    { lean: "WAIT", confidence: 18, health: "STALE", raw_lean: "WAIT", raw_conf: 18 },
    { lean: "WAIT", conf: 18, health: "STALE" },
  );
  const volt = seatOf(f, "VOLT");
  assert.equal(volt.voice, "waiting", "it simply saw nothing");
  assert.equal(volt.suppression, null);
  assert.equal(volt.health_warning, true, "with its health warning still shown");
  assert.equal(volt.final_conf_transformed, false);
  const fam = famOf(f, "VOLT");
  assert.equal(fam.unhealthy, 0);
  assert.equal(fam.stale_speakers, 0, "it is not a speaker");
  assert.equal(fam.up + fam.down, 0);
});

test("a DOWN feed still silences its seat — the STALE fix does not weaken it", () => {
  // `applyHealth` rewrites a DOWN seat's lean to WAIT and its confidence to 0.
  const f = oneSeat(
    "PULSE",
    { lean: "WAIT", confidence: 0, health: "DOWN", raw_lean: "DOWN", raw_conf: 71 },
    { lean: "WAIT", conf: 0, health: "DOWN", status: "DOWN" },
  );
  const pulse = seatOf(f, "PULSE");
  assert.equal(pulse.voice, "unhealthy");
  assert.equal(pulse.suppression, "feed");
  assert.equal(pulse.health_warning, false, "DOWN is not STALE");
  assert.equal(pulse.raw_lean, "DOWN", "its raw read is still surfaced");
  const fam = famOf(f, "PULSE");
  assert.equal(fam.down, 0);
  assert.equal(fam.unhealthy, 1);
  assert.equal(f.balance.unhealthy, 1);
});

test("family UP/DOWN counts contain only seats the Chair treats as speakers", () => {
  // Every non-speaking state at once, each leaning a side, plus one genuine
  // speaker. Only the speaker may appear in a count.
  const states: Array<[SeatId, Partial<Vote>, Partial<SeatRow>]> = [
    ["DRIFT", { lean: "UP", confidence: 74, raw_lean: "UP", raw_conf: 74 }, { lean: "UP", conf: 74, status: "MUTED" }],
    ["STREAK", { lean: "UP", confidence: 66, raw_lean: "UP", raw_conf: 66 }, { lean: "UP", conf: 66, status: "VETO" }],
    ["PULSE", { lean: "WAIT", confidence: 0, health: "DOWN", raw_lean: "UP", raw_conf: 71 }, { lean: "WAIT", conf: 0, health: "DOWN", status: "DOWN" }],
    ["VEL", { lean: "WAIT", confidence: 70, forced_sit: true, raw_lean: "UP", raw_conf: 40 }, { lean: "WAIT", conf: 70, forced_sit: true }],
    ["ODDS", { lean: "WAIT", confidence: 70, forced_sit: true, raw_lean: "UP", raw_conf: 80 }, { lean: "WAIT", conf: 70, forced_sit: true }],
    ["WICK", { lean: "UP", confidence: 55, health: "STALE", raw_lean: "UP", raw_conf: 55 }, { lean: "UP", conf: 55, health: "STALE" }],
  ];
  const votes = SEAT_IDS.map((s) => {
    const hit = states.find(([id]) => id === s);
    // A non-voter leaning hard, to prove the pit crew never counts either.
    if (s === "ORBIT") return vote(s, { lean: "UP", confidence: 88, raw_lean: "UP", raw_conf: 88 });
    return hit ? vote(s, hit[1]) : vote(s);
  });
  const rows = SEAT_IDS.filter((s) => !CHAIR_NON_VOTER_IDS.includes(s)).map((s) => {
    const hit = states.find(([id]) => id === s);
    return hit ? seatRow(s, hit[2]) : seatRow(s);
  });
  const f = build({ votes, chair: { rows, quorum: { up: 2, down: 0, wait: 16 } } });

  const speakers = f.seats.filter((s) => s.voice === "speaking");
  assert.deepEqual(speakers.map((s) => s.seat), ["WICK"], "only the STALE survivor speaks");

  const totalUp = f.families.reduce((n, x) => n + x.up, 0);
  const totalDown = f.families.reduce((n, x) => n + x.down, 0);
  assert.equal(totalUp, 1, "one speaker, one UP");
  assert.equal(totalDown, 0);
  // Each excluded state is excluded for its own stated reason.
  for (const [seat, want] of [["DRIFT", "muted"], ["STREAK", "vetoed"], ["PULSE", "unhealthy"], ["VEL", "suppressed"], ["ODDS", "retired"], ["ORBIT", "non-voter"]] as const) {
    assert.equal(seatOf(f, seat).voice, want, `${seat} is ${want}`);
  }
  // And the flags stay accurate alongside.
  assert.equal(famOf(f, "WICK").stale_speakers, 1);
  assert.equal(famOf(f, "PULSE").unhealthy, 1);
});

test("family counts and the Chair's own quorum reconcile, and the one divergence is named", () => {
  // `countChairQuorum` excludes non-voters, muted seats and forced sits — but
  // NOT vetoed ones. So a directional VETO seat sits in the Chair's quorum while
  // contributing nothing to the aggregation. The page shows both tallies and
  // names the gap rather than quietly reconciling them.
  const votes = SEAT_IDS.map((s) =>
    s === "DRIFT" ? vote(s, { lean: "UP", confidence: 74, raw_lean: "UP", raw_conf: 74 })
    : s === "STREAK" ? vote(s, { lean: "UP", confidence: 66, raw_lean: "UP", raw_conf: 66 })
    : s === "WICK" ? vote(s, { lean: "UP", confidence: 61, raw_lean: "UP", raw_conf: 61 })
    : vote(s));
  const rows = SEAT_IDS.filter((s) => !CHAIR_NON_VOTER_IDS.includes(s)).map((s) =>
    s === "DRIFT" ? seatRow(s, { lean: "UP", conf: 74, status: "MUTED" })
    : s === "STREAK" ? seatRow(s, { lean: "UP", conf: 66, status: "VETO" })
    : s === "WICK" ? seatRow(s, { lean: "UP", conf: 61 })
    : seatRow(s));
  // The quorum the Chair would publish for this frame: WICK and STREAK, because
  // it drops muted seats but not vetoed ones.
  const f = build({ votes, chair: { rows, quorum: { up: 2, down: 0, wait: 16 } } });

  const totalUp = f.families.reduce((n, x) => n + x.up, 0);
  assert.equal(totalUp, 1, "only WICK actually speaks with authority");
  assert.equal(f.balance.speaking.up, 2, "the displayed balance stays the Chair's own quorum");
  assert.equal(f.balance.veto_directional.up, 1, "and the gap is named");
  assert.equal(
    f.balance.speaking.up,
    totalUp + f.balance.veto_directional.up,
    "quorum.up === family speakers + directional vetoes",
  );
  // A muted seat is absent from BOTH tallies, so it is not part of the gap.
  assert.equal(f.balance.no_authority.up, 2, "muted and vetoed both lean with no authority");
  assert.equal(f.balance.no_authority.up - f.balance.veto_directional.up, 1, "one of them is the muted seat");
  // There is still no second aggregation competing with the Chair.
  assert.equal("lean" in f.balance, false);
});
