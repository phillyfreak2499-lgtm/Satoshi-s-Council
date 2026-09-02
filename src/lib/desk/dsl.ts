import { clamp, engulf, last, patternOf, round } from "./math";
import { readClock } from "./clock";
import { lastMark, readWick } from "./patterns";
import { readDrift, readExhaust, readStreak } from "./structure";
import { readCarry, readCascade, readChain, readVolt } from "./derivs";
import { readPulse, readTape, readVel, readWhale } from "./tape";
import { threshOf } from "./thresholds";
import type { FeatMap, Learner, Lean, Pred, SkillCard, SkillRule, Snapshot, ThreshUse } from "./types";

function persistSign(hist: number[], n: number): number {
  if (hist.length < n) return 0;
  const slice = hist.slice(-n);
  if (slice.every((x) => x > 0.04)) return 1;
  if (slice.every((x) => x < -0.04)) return -1;
  return 0;
}

export function featOf(snap: Snapshot, trendDay: boolean, quiet: boolean): FeatMap {
  const c1 = snap.candles_1m.filter((c) => c.closed);
  const lastC = last(c1);
  const prev = c1.at(-2);
  const p = lastC ? patternOf(lastC) : null;
  const eng = lastC && prev ? engulf(prev, lastC) : null;
  const volRatio = snap.vol_median > 0 ? snap.vol_last / snap.vol_median : 1;
  const path = snap.yes_mid_path;
  const d60 = path.length >= 6 ? path[path.length - 1]! - path[path.length - 6]! : 0;
  const d30 = path.length >= 4 ? path[path.length - 1]! - path[path.length - 4]! : 0;
  const d120 = path.length >= 10 ? path[path.length - 1]! - path[path.length - 10]! : 0;
  const dist = snap.spot - snap.strike;
  const atr = Math.max(snap.atr, 1);
  const lastF = last(snap.funding_history) ?? snap.funding_rate;
  const pxDir = lastC ? Math.sign(lastC.close - lastC.open) : 0;
  const c5 = snap.candles_5m;
  const last5 = last(c5);
  const prev5 = c5.at(-2);
  const flipped =
    last5 && prev5 && snap.ret1h !== 0
      ? Math.sign(last5.close - last5.open) !== Math.sign(snap.ret1h)
        ? 1
        : 0
      : 0;
  const mem = snap.window_memory;
  const yes = snap.yes_mid;
  const livePath = yes >= 55 ? 1 : yes <= 45 ? -1 : 0;
  const no = 100 - yes;
  const fng7 = snap.fng_history;
  const fngDelta = fng7.length >= 2 ? fng7[fng7.length - 1]! - fng7[0]! : 0;
  const wick5 = readWick(snap.candles_5m);
  const wick = readWick(c1, wick5.structure.trend);
  const clk = readClock(snap);
  const amdLean = wick.amd?.lean === "UP" ? 1 : wick.amd?.lean === "DOWN" ? -1 : 0;
  const sweepMk = lastMark(wick, ["sweep-up", "sweep-dn"]);
  const tweezerMk = lastMark(wick, ["tweezer-top", "tweezer-bot"]);
  const morn = lastMark(wick, "morn");
  const even = lastMark(wick, "even");
  const pinMk = lastMark(wick, ["pin", "shoot", "gravestone", "hanging"]);
  const hamMk = lastMark(wick, ["hammer", "dragonfly", "inv_ham"]);
  const engMk = lastMark(wick, ["engulf-up", "engulf-down"]);
  const bosMk = lastMark(wick, ["bos-up", "bos-dn"]);
  const amdMk = lastMark(wick, "amd");
  const ready = (m: typeof pinMk) => (m && m.confirmed && m.contextOk ? 1 : 0);
  const liveMk = [...wick.marks].reverse().find((m) => m.lean !== "WAIT" && m.i >= wick.slice.length - 6);
  const mtfAgree =
    !liveMk ||
    liveMk.lean === "WAIT" ||
    wick5.structure.trend === "RANGE" ||
    (liveMk.lean === "UP" && wick5.structure.trend === "UP") ||
    (liveMk.lean === "DOWN" && wick5.structure.trend === "DOWN");

  const out: FeatMap = {
    location_high: snap.location === "HIGH" ? 1 : 0,
    location_low: snap.location === "LOW" ? 1 : 0,
    location_mid: snap.location === "MID" ? 1 : 0,
    range_pos: snap.range_pos,
    upper_wick: p?.upperPct ?? 0,
    lower_wick: p?.lowerPct ?? 0,
    body_pct: p?.bodyPct ?? 0,
    bar_closed: lastC?.closed ? 1 : 0,
    pattern_doji: p?.pattern === "doji" ? 1 : 0,
    pattern_pin: p?.pattern === "pin" ? 1 : 0,
    pattern_hammer: wick.lastName === "hammer" || wick.lastName === "dragonfly" ? 1 : 0,
    engulf: eng === "UP" ? 1 : eng === "DOWN" ? -1 : 0,
    amd_dist:
      wick.amd?.phase === "DISTRIBUTION" && (wick.amd.distI ?? -1) >= wick.slice.length - 4 ? 1 : 0,
    amd_manip:
      wick.amd?.phase === "MANIPULATION" && (wick.amd.manipI ?? -1) >= wick.slice.length - 3 ? 1 : 0,
    amd_lean: amdLean,
    amd_quality: wick.amd?.quality ?? 0,
    liq_sweep: sweepMk && ready(sweepMk) ? (sweepMk.lean === "UP" ? 1 : -1) : 0,
    sweep_edge: sweepMk ? clamp(Math.max(wick.lastFeat.upperPct, wick.lastFeat.lowerPct), 0, 1) : 0,
    morning_star: ready(morn),
    evening_star: ready(even),
    tweezer: tweezerMk && ready(tweezerMk) ? (tweezerMk.lean === "UP" ? 1 : -1) : 0,
    bos: bosMk && ready(bosMk) ? (bosMk.lean === "UP" ? 1 : -1) : 0,
    pin_ready: ready(pinMk),
    hammer_ready: ready(hamMk),
    engulf_ready: ready(engMk),
    amd_ready: ready(amdMk) && wick.amd?.phase === "DISTRIBUTION" ? 1 : 0,
    sweep_ready: ready(sweepMk),
    tweezer_ready: ready(tweezerMk),
    bos_ready: ready(bosMk),
    wick_confirmed: liveMk?.confirmed ? 1 : 0,
    wick_pending: liveMk?.pending ? 1 : 0,
    wick_context: liveMk?.contextOk ? 1 : 0,
    wick_confluence: liveMk?.confluence ?? 0,
    mtf_agree: mtfAgree ? 1 : 0,
    trend_up: wick.structure.trend === "UP" ? 1 : 0,
    trend_down: wick.structure.trend === "DOWN" ? 1 : 0,
    rsi14: wick.rsi,
    ema_lead: wick.emaSlow ? (wick.emaFast - wick.emaSlow) / wick.emaSlow : 0,
    vol_confirm: wick.volConfirm ? 1 : 0,
    ret5: snap.ret5,
    ret15: snap.ret15,
    ret30: snap.ret30,
    ret1h: snap.ret1h,
    abs_ret5: Math.abs(snap.ret5),
    abs_ret15: Math.abs(snap.ret15),
    abs_ret30: Math.abs(snap.ret30),
    abs_ret1h: Math.abs(snap.ret1h),
    ret15_edge: clamp(Math.abs(snap.ret15) / 0.008, 0, 1),
    ret1h_edge: clamp(Math.abs(snap.ret1h) / 0.02, 0, 1),
    aligned_3h:
      Math.sign(snap.ret5) !== 0 &&
      Math.sign(snap.ret5) === Math.sign(snap.ret15) &&
      Math.sign(snap.ret15) === Math.sign(snap.ret30)
        ? 1
        : 0,
    vol_ratio: volRatio,
    vol_percentile: snap.vol_percentile,
    vol_edge: clamp((volRatio - 2.2) / 2, 0, 1),
    atr_pct: snap.atr_pct,
    yes_mid: yes,
    no_mid: no,
    yes_ask: snap.yes_ask,
    no_ask: snap.no_ask,
    spread: snap.spread_cents,
    leftover: snap.leftover_cents,
    print_age: snap.print_age_s,
    quote_hole: snap.spread_cents > 6 ? 1 : 0,
    print_stale: snap.print_age_s > 20 ? 1 : 0,
    yes_rip30: d30,
    yes_rip60: d60,
    yes_rip120: d120,
    abs_rip60: Math.abs(d60),
    imbalance: snap.imbalance,
    imb_persist: persistSign(snap.imbalance_hist, 4),
    streak_n: mem.streak_n,
    streak_side: mem.streak_side === "UP" ? 1 : mem.streak_side === "DOWN" ? -1 : 0,
    live_path: livePath,
    streak_agree: mem.streak_side && mem.streak_side !== "WAIT" && (mem.streak_side === "UP" ? 1 : -1) === livePath ? 1 : 0,
    mins_left: snap.mins_left,
    dist,
    dist_atr: dist / atr,
    abs_dist_atr: Math.abs(dist) / atr,
    clock_z: clk.z,
    strike_owns: clk.owns ? 1 : 0,
    clock_itm: clk.itm === "UP" ? 1 : clk.itm === "DOWN" ? -1 : 0,
    funding: lastF,
    abs_funding: Math.abs(lastF),
    basis_bps: snap.basis_bps,
    abs_basis: Math.abs(snap.basis_bps),
    oi_delta_10m: snap.oi_delta_10m,
    oi_usd_delta_10m: snap.oi_usd_delta_10m,
    oi_with_px: Math.sign(snap.oi_delta_10m) === Math.sign(snap.ret15) && Math.sign(snap.oi_usd_delta_10m) === Math.sign(snap.ret15) && snap.oi_delta_10m !== 0 && snap.oi_usd_delta_10m !== 0 ? 1 : 0,
    oi_flush: snap.oi_delta_10m < 0 && snap.oi_usd_delta_10m < 0 ? 1 : 0,
    funding_extreme:
      snap.funding_series.filter((p) => Math.abs(p.v) > 0.0002).length >= 3 ? 1 : 0,
    fng: snap.fear_greed,
    fng_side: snap.fear_greed >= 80 ? 1 : snap.fear_greed <= 20 ? -1 : 0,
    fng_delta: fngDelta,
    fng_hot:
      (snap.fear_greed >= 80 && fngDelta >= 0) || (snap.fear_greed <= 20 && fngDelta <= 0) ? 1 : 0,
    weekend: snap.as_of && new Date(snap.as_of).getUTCDay() % 6 === 0 ? 1 : 0,
    spot_lead_bps: snap.spot_lead_bps,
    abs_lead: Math.abs(snap.spot_lead_bps),
    px_dir: pxDir,
    flipped_5m: flipped,
    trend_day: trendDay ? 1 : 0,
    quiet: quiet ? 1 : 0,
    chalk: snap.chalk ? 1 : 0,
    phase_entry: snap.phase === "ENTRY" ? 1 : 0,
    phase_mid: snap.phase === "MID" ? 1 : 0,
    phase_final: snap.phase === "FINAL" ? 1 : 0,
    extreme_range: snap.range_pos >= 0.8 || snap.range_pos <= 0.2 ? 1 : 0,
    drift_accel: 0,
    drift_decay: 0,
    drift_pullback: 0,
    drift_stack: 0,
    drift_chop: 0,
    streak_young: 0,
    streak_mid: 0,
    streak_ext: 0,
    streak_live_break: 0,
    streak_alt: 0,
    streak_yes: 0,
    exhaust_climax: 0,
    exhaust_inside: 0,
    exhaust_rsi_div: 0,
    exhaust_failed: 0,
    exhaust_ema_against: 0,
    pulse_climax: 0,
    pulse_absorb: 0,
    pulse_lag5: 0,
    tape_flip: 0,
    tape_thin: 0,
    tape_wipe: 0,
    whale_cluster: 0,
    whale_absorb: 0,
    vel_catch: 0,
    vel_fade: 0,
    carry_unwind: 0,
    carry_normalize: 0,
    carry_trend: 0,
    carry_flip: 0,
    chain_against: 0,
    chain_accel: 0,
    chain_stall: 0,
    chain_flush_sit: 0,
    cascade_proxy: 0,
    cascade_early: 0,
    cascade_vol_no_oi: 0,
    cascade_exhaust: 0,
    cascade_cluster: 0,
    volt_dead: 0,
    volt_expand: 0,
    volt_spike: 0,
    volt_coil: 0,
    volt_hot: 0,
    force_n: snap.force_n,
  };

  const d = readDrift(snap);
  const st = readStreak(snap);
  const xh = readExhaust(snap);
  const pu = readPulse(snap);
  const tp = readTape(snap);
  const wh = readWhale(snap);
  const ve = readVel(snap);
  const cy = readCarry(snap);
  const ch = readChain(snap);
  const cs = readCascade(snap);
  const vt = readVolt(snap);
  out.drift_accel = d.accel && d.strong15 ? 1 : 0;
  out.drift_decay = d.decay && d.strong15 ? 1 : 0;
  out.drift_pullback = d.pullback ? 1 : 0;
  out.drift_stack = d.stack ? 1 : 0;
  out.drift_chop = d.chop ? 1 : 0;
  out.streak_young = st.young ? 1 : 0;
  out.streak_mid = st.mid ? 1 : 0;
  out.streak_ext = st.extended ? 1 : 0;
  out.streak_live_break = st.liveBreak ? 1 : 0;
  out.streak_alt = st.alternating ? 1 : 0;
  out.streak_yes = st.yesAgrees ? 1 : 0;
  out.streak_n = st.n;
  out.streak_side = st.side === "UP" ? 1 : st.side === "DOWN" ? -1 : 0;
  out.live_path = st.live === "UP" ? 1 : st.live === "DOWN" ? -1 : 0;
  out.streak_agree = st.liveAgree ? 1 : 0;
  out.exhaust_climax = xh.climax ? 1 : 0;
  out.exhaust_inside = xh.inside ? 1 : 0;
  out.exhaust_rsi_div = xh.rsiDiv ? 1 : 0;
  out.exhaust_failed = xh.failedPush ? 1 : 0;
  out.exhaust_ema_against = xh.emaAgainst ? 1 : 0;
  out.pulse_climax = pu.climax ? 1 : 0;
  out.pulse_absorb = pu.absorb ? 1 : 0;
  out.pulse_lag5 = pu.lag5 ? 1 : 0;
  out.tape_flip = tp.flip === "UP" ? 1 : tp.flip === "DOWN" ? -1 : 0;
  out.tape_thin = tp.thin ? 1 : 0;
  out.tape_wipe = tp.wipe ? 1 : 0;
  out.whale_cluster = wh.cluster ? 1 : 0;
  out.whale_absorb = wh.absorb ? (wh.lean === "UP" ? 1 : -1) : 0;
  out.vel_catch = ve.catching ? 1 : 0;
  out.vel_fade = ve.fading ? 1 : 0;
  out.carry_unwind = cy.extreme && cy.fallingOi ? 1 : 0;
  out.carry_normalize = cy.normalize ? 1 : 0;
  out.carry_trend = cy.moderate ? 1 : 0;
  out.carry_flip = cy.flip === "UP" ? 1 : cy.flip === "DOWN" ? -1 : 0;
  out.chain_against = ch.against ? 1 : 0;
  out.chain_accel = ch.accel ? 1 : 0;
  out.chain_stall = ch.stall ? 1 : 0;
  out.chain_flush_sit = ch.flushQuiet ? 1 : 0;
  out.cascade_proxy = cs.proxy ? 1 : 0;
  out.cascade_early = cs.early ? 1 : 0;
  out.cascade_vol_no_oi = cs.volNoOi ? 1 : 0;
  out.cascade_exhaust = cs.exhaust ? 1 : 0;
  out.cascade_cluster = cs.cluster ? 1 : 0;
  out.volt_dead = vt.dead ? 1 : 0;
  out.volt_expand = vt.expand ? 1 : 0;
  out.volt_spike = vt.spike ? 1 : 0;
  out.volt_coil = vt.coil ? 1 : 0;
  out.volt_hot = vt.hot ? 1 : 0;
  return out;
}

function num(feats: FeatMap, k: string): number {
  const v = feats[k];
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return 0;
}

function resolveCmp(p: Pred, learner: Learner, regime: string): number {
  if (p.thresh) return threshOf(learner, p.thresh, regime);
  const v = p.value;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v;
  return Number(v) || 0;
}

function predPass(p: Pred, feats: FeatMap, t: number): boolean {
  const x = num(feats, p.feat);
  switch (p.op) {
    case "gte":
      return x >= t;
    case "lte":
      return x <= t;
    case "gt":
      return x > t;
    case "lt":
      return x < t;
    case "eq":
      return Math.abs(x - t) < 1e-9;
    case "neq":
      return Math.abs(x - t) >= 1e-9;
    case "abs_gte":
      return Math.abs(x) >= t;
    case "abs_lte":
      return Math.abs(x) <= t;
    default:
      return false;
  }
}

function resolveLean(spec: string, feats: FeatMap): Lean {
  if (spec === "UP" || spec === "DOWN" || spec === "WAIT") return spec;
  if (spec.startsWith("sign:")) {
    const x = num(feats, spec.slice(5));
    if (x > 0) return "UP";
    if (x < 0) return "DOWN";
    return "WAIT";
  }
  if (spec.startsWith("fade:")) {
    const x = num(feats, spec.slice(5));
    if (x > 0) return "DOWN";
    if (x < 0) return "UP";
    return "WAIT";
  }
  if (spec === "cheap") return num(feats, "yes_ask") <= num(feats, "no_ask") ? "UP" : "DOWN";
  if (spec === "itm") return num(feats, "dist") > 0 ? "UP" : "DOWN";
  return "WAIT";
}

export type RuleHit = {
  lean: Lean;
  edge: number;
  reasoning: string;
  evidence: string[];
  features: Record<string, number | string | boolean>;
  thresh_used: ThreshUse[];
  cap?: number;
};

export function evalRule(
  rule: SkillRule,
  feats: FeatMap,
  learner: Learner,
  regime: string,
): RuleHit | null {
  const used: ThreshUse[] = [];
  const check = (list: Pred[] | undefined, want: boolean) => {
    if (!list?.length) return true;
    return list.every((p) => {
      const t = resolveCmp(p, learner, regime);
      if (p.thresh) {
        used.push({ id: p.thresh, x: num(feats, p.feat), t });
      }
      return predPass(p, feats, t) === want;
    });
  };
  const anyOk =
    !rule.any?.length ||
    rule.any.some((p) => {
      const t = resolveCmp(p, learner, regime);
      const ok = predPass(p, feats, t);
      if (ok && p.thresh) used.push({ id: p.thresh, x: num(feats, p.feat), t });
      return ok;
    });
  if (!check(rule.all, true) || !anyOk || !check(rule.none, false)) return null;

  const lean = resolveLean(rule.lean, feats);
  if (lean === "WAIT" && rule.lean !== "WAIT") return null;

  let edge = 0.55;
  if (rule.edge?.startsWith("fixed:")) edge = Number(rule.edge.slice(6)) || 0.55;
  else if (rule.edge) edge = clamp(Math.abs(num(feats, rule.edge)), 0, 1);

  const all = rule.all ?? [];
  const evidence = all.slice(0, 4).map((p) => {
    const t = p.thresh ? ` t=${round(resolveCmp(p, learner, regime), 3)}` : "";
    return `${p.feat} ${p.op} ${round(num(feats, p.feat), 3)}${t}`;
  });

  return {
    lean,
    edge,
    reasoning: `dsl ${rule.lean} · ${all.map((p) => p.feat).join("+") || "rule"}`,
    evidence: evidence.length ? evidence : [`lean ${lean}`],
    features: { dsl: true, lean: rule.lean },
    thresh_used: used,
    cap: rule.cap,
  };
}

export const SKILL_RULES: Record<string, SkillRule> = {
  "WICK.pin_at_high": {
    all: [
      { feat: "location_high", op: "eq", value: 1 },
      { feat: "upper_wick", op: "gte", thresh: "wick.upper" },
      { feat: "bar_closed", op: "eq", value: 1 },
      { feat: "pin_ready", op: "eq", value: 1 },
    ],
    lean: "DOWN",
    edge: "upper_wick",
  },
  "WICK.engulf_at_extreme": {
    all: [
      { feat: "engulf", op: "neq", value: 0 },
      { feat: "location_mid", op: "eq", value: 0 },
      { feat: "engulf_ready", op: "eq", value: 1 },
    ],
    lean: "sign:engulf",
    edge: "fixed:0.62",
  },
  "WICK.doji_after_run": {
    all: [
      { feat: "pattern_doji", op: "eq", value: 1 },
      { feat: "abs_ret15", op: "gte", thresh: "ret15.min" },
    ],
    lean: "WAIT",
    edge: "fixed:0.55",
  },
  "WICK.hammer_at_low": {
    all: [
      { feat: "location_low", op: "eq", value: 1 },
      { feat: "lower_wick", op: "gte", thresh: "wick.lower" },
      { feat: "bar_closed", op: "eq", value: 1 },
      { feat: "hammer_ready", op: "eq", value: 1 },
    ],
    lean: "UP",
    edge: "lower_wick",
  },
  "WICK.amd": {
    all: [{ feat: "amd_ready", op: "eq", value: 1 }],
    lean: "sign:amd_lean",
    edge: "amd_quality",
  },
  "WICK.liq_sweep": {
    all: [{ feat: "sweep_ready", op: "eq", value: 1 }],
    lean: "sign:liq_sweep",
    edge: "sweep_edge",
  },
  "WICK.morning_star": {
    all: [{ feat: "morning_star", op: "eq", value: 1 }],
    lean: "UP",
    edge: "fixed:0.64",
  },
  "WICK.evening_star": {
    all: [{ feat: "evening_star", op: "eq", value: 1 }],
    lean: "DOWN",
    edge: "fixed:0.64",
  },
  "WICK.tweezer": {
    all: [{ feat: "tweezer_ready", op: "eq", value: 1 }],
    lean: "sign:tweezer",
    edge: "fixed:0.58",
  },
  "WICK.bos_close": {
    all: [{ feat: "bos_ready", op: "eq", value: 1 }],
    lean: "sign:bos",
    edge: "fixed:0.6",
  },
  "DRIFT.aligned_3h": {
    all: [
      { feat: "aligned_3h", op: "eq", value: 1 },
      { feat: "abs_ret15", op: "gte", thresh: "ret15.min" },
    ],
    lean: "sign:ret15",
    edge: "ret15_edge",
  },
  "DRIFT.accel_impulse": {
    all: [{ feat: "drift_accel", op: "eq", value: 1 }],
    lean: "sign:ret5",
    edge: "ret15_edge",
  },
  "DRIFT.decaying_impulse": {
    all: [{ feat: "drift_decay", op: "eq", value: 1 }],
    lean: "WAIT",
    edge: "fixed:0.55",
  },
  "DRIFT.pullback_in_trend": {
    all: [{ feat: "drift_pullback", op: "eq", value: 1 }],
    lean: "sign:ret15",
    edge: "ret15_edge",
  },
  "DRIFT.mtf_stack": {
    all: [
      { feat: "drift_stack", op: "eq", value: 1 },
      { feat: "abs_ret15", op: "gte", thresh: "ret15.min" },
    ],
    lean: "sign:ret15",
    edge: "ret15_edge",
  },
  "DRIFT.chop_sit": {
    all: [{ feat: "drift_chop", op: "eq", value: 1 }],
    lean: "WAIT",
    edge: "fixed:0.55",
  },
  "STREAK.continue_young": {
    all: [
      { feat: "streak_n", op: "gt", value: 0 },
      { feat: "streak_n", op: "lte", value: 3 },
      { feat: "streak_agree", op: "eq", value: 1 },
    ],
    lean: "sign:streak_side",
    edge: "fixed:0.55",
  },
  "STREAK.fade_extended": {
    all: [{ feat: "streak_n", op: "gte", thresh: "streak.ext" }],
    lean: "fade:streak_side",
    edge: "fixed:0.5",
  },
  "STREAK.mid_hold": {
    all: [
      { feat: "streak_mid", op: "eq", value: 1 },
      { feat: "streak_agree", op: "eq", value: 1 },
    ],
    lean: "sign:streak_side",
    edge: "fixed:0.5",
  },
  "STREAK.live_break": {
    all: [{ feat: "streak_live_break", op: "eq", value: 1 }],
    lean: "WAIT",
    edge: "fixed:0.55",
  },
  "STREAK.alt_chop": {
    all: [{ feat: "streak_alt", op: "eq", value: 1 }],
    lean: "WAIT",
    edge: "fixed:0.55",
  },
  "STREAK.yes_agrees": {
    all: [{ feat: "streak_yes", op: "eq", value: 1 }],
    any: [
      { feat: "streak_young", op: "eq", value: 1 },
      { feat: "streak_mid", op: "eq", value: 1 },
    ],
    lean: "sign:streak_side",
    edge: "fixed:0.56",
  },
  "EXHAUST.1h_run_5m_flip": {
    all: [
      { feat: "abs_ret1h", op: "gte", thresh: "run.1h" },
      { feat: "extreme_range", op: "eq", value: 1 },
      { feat: "flipped_5m", op: "eq", value: 1 },
    ],
    lean: "fade:ret1h",
    edge: "ret1h_edge",
  },
  "EXHAUST.climax_wick": {
    all: [{ feat: "exhaust_climax", op: "eq", value: 1 }],
    lean: "fade:ret1h",
    edge: "ret1h_edge",
  },
  "EXHAUST.rsi_div": {
    all: [{ feat: "exhaust_rsi_div", op: "eq", value: 1 }],
    lean: "fade:ret1h",
    edge: "fixed:0.58",
  },
  "EXHAUST.failed_push": {
    all: [{ feat: "exhaust_failed", op: "eq", value: 1 }],
    lean: "fade:ret1h",
    edge: "fixed:0.6",
  },
  "EXHAUST.ema_cross_against": {
    all: [{ feat: "exhaust_ema_against", op: "eq", value: 1 }],
    lean: "fade:ret1h",
    edge: "fixed:0.57",
  },
  "EXHAUST.inside_after_run": {
    all: [{ feat: "exhaust_inside", op: "eq", value: 1 }],
    lean: "WAIT",
    edge: "fixed:0.55",
  },
  "PULSE.vol_agree": {
    all: [
      { feat: "vol_ratio", op: "gt", thresh: "vol.spike" },
      { feat: "px_dir", op: "neq", value: 0 },
    ],
    lean: "sign:px_dir",
    edge: "vol_edge",
  },
  "PULSE.dryup_sit": {
    all: [
      { feat: "vol_ratio", op: "lt", thresh: "vol.dry" },
      { feat: "abs_ret5", op: "gt", value: 0.001 },
    ],
    lean: "WAIT",
    edge: "fixed:0.5",
  },
  "PULSE.climax_sit": {
    all: [{ feat: "pulse_climax", op: "eq", value: 1 }],
    lean: "WAIT",
    edge: "fixed:0.55",
  },
  "PULSE.absorb": {
    all: [{ feat: "pulse_absorb", op: "eq", value: 1 }],
    lean: "WAIT",
    edge: "fixed:0.55",
  },
  "PULSE.vol_lag_5m": {
    all: [{ feat: "pulse_lag5", op: "eq", value: 1 }],
    lean: "sign:ret15",
    edge: "ret15_edge",
  },
  "TAPE.persist_imbalance": {
    all: [{ feat: "imb_persist", op: "neq", value: 0 }],
    lean: "sign:imb_persist",
    edge: "fixed:0.55",
  },
  "TAPE.flip_after_persist": {
    all: [{ feat: "tape_flip", op: "neq", value: 0 }],
    lean: "sign:tape_flip",
    edge: "fixed:0.58",
  },
  "TAPE.thin_sit": {
    all: [{ feat: "tape_thin", op: "eq", value: 1 }],
    lean: "WAIT",
    edge: "fixed:0.55",
  },
  "TAPE.size_wipe": {
    all: [
      { feat: "tape_wipe", op: "eq", value: 1 },
      { feat: "imb_persist", op: "neq", value: 0 },
    ],
    lean: "sign:imb_persist",
    edge: "fixed:0.6",
  },
  "VEL.spot_lead": {
    all: [{ feat: "abs_lead", op: "gte", thresh: "lead.bps" }],
    none: [
      { feat: "vel_catch", op: "eq", value: 1 },
      { feat: "vel_fade", op: "eq", value: 1 },
    ],
    lean: "sign:spot_lead_bps",
    edge: "fixed:0.55",
  },
  "VEL.lag_catch_sit": {
    all: [{ feat: "vel_catch", op: "eq", value: 1 }],
    lean: "WAIT",
    edge: "fixed:0.55",
  },
  "VEL.lead_fade": {
    all: [{ feat: "vel_fade", op: "eq", value: 1 }],
    lean: "WAIT",
    edge: "fixed:0.55",
  },
  "WHALE.proxy": {
    all: [{ feat: "vol_ratio", op: "gt", thresh: "whale.vol" }],
    none: [{ feat: "whale_absorb", op: "neq", value: 0 }],
    lean: "sign:px_dir",
    edge: "vol_edge",
  },
  "WHALE.cluster": {
    all: [{ feat: "whale_cluster", op: "eq", value: 1 }],
    lean: "sign:px_dir",
    edge: "vol_edge",
  },
  "WHALE.absorb": {
    all: [{ feat: "whale_absorb", op: "neq", value: 0 }],
    lean: "sign:whale_absorb",
    edge: "fixed:0.58",
  },
  "CARRY.persist_fade": {
    all: [
      { feat: "funding_extreme", op: "eq", value: 1 },
      { feat: "oi_delta_10m", op: "gt", value: 0 },
      { feat: "abs_funding", op: "gt", value: 0.0002 },
    ],
    none: [{ feat: "carry_unwind", op: "eq", value: 1 }],
    lean: "fade:funding",
    edge: "fixed:0.5",
  },
  "CARRY.unwind": {
    all: [{ feat: "carry_unwind", op: "eq", value: 1 }],
    lean: "fade:funding",
    edge: "fixed:0.56",
  },
  "CARRY.normalize_sit": {
    all: [{ feat: "carry_normalize", op: "eq", value: 1 }],
    lean: "WAIT",
    edge: "fixed:0.55",
  },
  "CARRY.trend_carry": {
    all: [{ feat: "carry_trend", op: "eq", value: 1 }],
    lean: "sign:ret15",
    edge: "fixed:0.56",
  },
  "CARRY.flip_print": {
    all: [{ feat: "carry_flip", op: "neq", value: 0 }],
    lean: "WAIT",
    edge: "fixed:0.55",
  },
  "CHAIN.oi_with_price": {
    all: [{ feat: "oi_with_px", op: "eq", value: 1 }],
    none: [{ feat: "chain_against", op: "eq", value: 1 }],
    lean: "sign:ret15",
    edge: "fixed:0.55",
  },
  "CHAIN.oi_against": {
    all: [{ feat: "chain_against", op: "eq", value: 1 }],
    lean: "fade:ret15",
    edge: "fixed:0.58",
  },
  "CHAIN.oi_accel": {
    all: [{ feat: "chain_accel", op: "eq", value: 1 }],
    lean: "sign:ret15",
    edge: "fixed:0.6",
  },
  "CHAIN.oi_stall": {
    all: [{ feat: "chain_stall", op: "eq", value: 1 }],
    lean: "WAIT",
    edge: "fixed:0.55",
  },
  "CHAIN.oi_flush_sit": {
    all: [{ feat: "chain_flush_sit", op: "eq", value: 1 }],
    lean: "WAIT",
    edge: "fixed:0.55",
  },
  "CASCADE.proxy_flush": {
    all: [{ feat: "cascade_proxy", op: "eq", value: 1 }],
    lean: "sign:ret5",
    edge: "fixed:0.5",
    cap: 58,
  },
  "CASCADE.early_flush_sit": {
    all: [{ feat: "cascade_early", op: "eq", value: 1 }],
    lean: "WAIT",
    edge: "fixed:0.55",
  },
  "CASCADE.vol_no_oi": {
    all: [{ feat: "cascade_vol_no_oi", op: "eq", value: 1 }],
    lean: "sign:ret5",
    edge: "fixed:0.52",
    cap: 58,
  },
  "CASCADE.exhaust": {
    all: [{ feat: "cascade_exhaust", op: "eq", value: 1 }],
    lean: "WAIT",
    edge: "fixed:0.55",
  },
  "CASCADE.force_cluster": {
    all: [{ feat: "cascade_cluster", op: "eq", value: 1 }],
    lean: "sign:ret5",
    edge: "fixed:0.55",
    cap: 58,
  },
  "VOLT.dead_sit": {
    any: [
      { feat: "atr_pct", op: "lt", thresh: "atr.dead" },
      { feat: "vol_percentile", op: "lt", thresh: "vol.dead_pct" },
    ],
    lean: "WAIT",
    edge: "fixed:0.7",
  },
  "VOLT.expand_break": {
    all: [{ feat: "volt_expand", op: "eq", value: 1 }],
    lean: "sign:ret15",
    edge: "ret15_edge",
  },
  "VOLT.atr_spike": {
    all: [{ feat: "volt_spike", op: "eq", value: 1 }],
    lean: "sign:ret5",
    edge: "fixed:0.56",
  },
  "VOLT.coil_sit": {
    all: [{ feat: "volt_coil", op: "eq", value: 1 }],
    lean: "WAIT",
    edge: "fixed:0.55",
  },
  "VOLT.vol_hot": {
    all: [{ feat: "volt_hot", op: "eq", value: 1 }],
    lean: "sign:ret5",
    edge: "fixed:0.58",
  },
  "ODDS.cheap_yes": {
    all: [
      { feat: "yes_ask", op: "lte", thresh: "cheap.cents" },
      { feat: "trend_day", op: "eq", value: 0 },
    ],
    none: [
      { feat: "yes_rip60", op: "lt", value: -6 },
      { feat: "strike_owns", op: "eq", value: 1 },
      { feat: "quote_hole", op: "eq", value: 1 },
    ],
    lean: "UP",
    edge: "fixed:0.6",
  },
  "STRIKE.itm_time": {
    all: [{ feat: "clock_z", op: "gte", value: 0.7 }],
    lean: "itm",
    edge: "fixed:0.55",
  },
  "STRIKE.magnet_sit": {
    all: [
      { feat: "abs_dist_atr", op: "lt", value: 0.5 },
      { feat: "mins_left", op: "lt", thresh: "magnet.mins" },
    ],
    lean: "WAIT",
    edge: "fixed:0.7",
  },
  "CHEAP.value": {
    all: [{ feat: "trend_day", op: "eq", value: 0 }],
    any: [
      { feat: "yes_ask", op: "lte", thresh: "cheap.cents" },
      { feat: "no_ask", op: "lte", thresh: "cheap.cents" },
    ],
    none: [
      { feat: "strike_owns", op: "eq", value: 1 },
      { feat: "quote_hole", op: "eq", value: 1 },
    ],
    lean: "cheap",
    edge: "fixed:0.6",
  },
  "FADE.60s_rip": {
    all: [
      { feat: "abs_rip60", op: "gte", thresh: "fade.rip" },
      { feat: "trend_day", op: "eq", value: 0 },
    ],
    none: [
      { feat: "strike_owns", op: "eq", value: 1 },
      { feat: "quote_hole", op: "eq", value: 1 },
      { feat: "print_stale", op: "eq", value: 1 },
    ],
    lean: "fade:yes_rip60",
    edge: "fixed:0.5",
  },
  "ORBIT.quiet_raise_bar": {
    all: [{ feat: "quiet", op: "eq", value: 1 }],
    lean: "WAIT",
    edge: "fixed:0.7",
  },
  "WIRE.extreme_fng": {
    all: [{ feat: "fng_hot", op: "eq", value: 1 }],
    lean: "fade:fng_side",
    edge: "fixed:0.4",
    cap: 55,
  },
  "CLOCK.session_prior": {
    all: [{ feat: "mins_left", op: "gte", value: 0 }],
    lean: "WAIT",
    edge: "fixed:0.55",
  },
};

const EXTRA_PREDS: Pred[] = [
  { feat: "vol_ratio", op: "gte", thresh: "vol.spike" },
  { feat: "abs_ret15", op: "gte", thresh: "ret15.min" },
  { feat: "location_high", op: "eq", value: 1 },
  { feat: "location_low", op: "eq", value: 1 },
  { feat: "imb_persist", op: "neq", value: 0 },
  { feat: "abs_rip60", op: "gte", thresh: "fade.rip" },
  { feat: "extreme_range", op: "eq", value: 1 },
  { feat: "quiet", op: "eq", value: 0 },
  { feat: "flipped_5m", op: "eq", value: 1 },
  { feat: "oi_with_px", op: "eq", value: 1 },
  { feat: "funding_extreme", op: "eq", value: 1 },
  { feat: "cascade_proxy", op: "eq", value: 1 },
  { feat: "volt_expand", op: "eq", value: 1 },
  { feat: "carry_unwind", op: "eq", value: 1 },
];

function predConflicts(a: Pred, b: Pred): boolean {
  const loc = new Set([a.feat, b.feat]);
  if (loc.has("location_high") && loc.has("location_low")) return true;
  if (a.feat !== b.feat) return false;
  if (a.op === "eq" && b.op === "eq") return Number(a.value) !== Number(b.value);
  if (a.op === "neq" && b.op === "eq") return Number(a.value) === Number(b.value);
  if (a.op === "eq" && b.op === "neq") return Number(a.value) === Number(b.value);
  return false;
}

export function cloneResidualRule(parent: SkillCard, feats: FeatMap, learner: Learner, regime: string): SkillRule | undefined {
  const src = parent.rule ?? SKILL_RULES[parent.id];
  if (!src) return undefined;
  const rule: SkillRule = JSON.parse(JSON.stringify(src)) as SkillRule;
  const used = new Set((rule.all ?? []).map((p) => p.feat));
  const extra = EXTRA_PREDS.filter((p) => !used.has(p.feat)).find((p) => {
    if ((rule.all ?? []).some((a) => predConflicts(a, p))) return false;
    const x = num(feats, p.feat);
    if (p.op === "eq") return Math.abs(x - Number(p.value ?? 1)) < 1e-9;
    if (p.op === "neq") return Math.abs(x) > 0.04;
    const t = p.thresh ? threshOf(learner, p.thresh, regime) : Number(p.value ?? 0);
    return predPass(p, feats, t);
  });
  if (extra) {
    rule.all = [...(rule.all ?? []), extra];
  } else {
    const tp = (rule.all ?? []).find((p) => p.thresh);
    if (tp?.thresh) {
      const cur = threshOf(learner, tp.thresh, regime);
      if (tp.op === "gte" || tp.op === "gt" || tp.op === "abs_gte") tp.value = round(cur * 1.1, 4);
      else tp.value = round(cur * 0.9, 4);
      delete tp.thresh;
    }
  }
  return rule;
}

export function formatRule(rule: SkillRule | undefined): string {
  if (!rule) return "no dsl";
  const bits = [
    ...(rule.all ?? []).map((p) => `${p.feat} ${p.op} ${p.thresh ?? p.value}`),
    ...(rule.any ?? []).map((p) => `any:${p.feat}`),
  ];
  return `${bits.join(" · ") || "open"} → ${rule.lean}`;
}
