import { evalRule, featOf, SKILL_RULES } from "./dsl";
import { directionalConf, last, round } from "./math";
import { lastMark, MARK_LABEL, readWick, type WickMark } from "./patterns";
import { patternTrust, rememberPatterns } from "./ledger";
import { liveSkills, skillScore } from "./skills";
import { readClock } from "./clock";
import { readDrift, readExhaust, readStreak } from "./structure";
import { readCarry, readCascade, readChain, readVolt } from "./derivs";
import { readPulse, readTape, readVel, readWhale } from "./tape";
import { THRESH_SPECS, threshOf } from "./thresholds";
import type { FeatMap, FeedHealth, Lean, Learner, PaperLean, SeatId, Snapshot, Vote } from "./types";

export type BotCtx = {
  snap: Snapshot;
  learner: Learner;
  trendDay: boolean;
  quiet: boolean;
  feats: FeatMap;
};

function T(ctx: BotCtx, id: string): number {
  return threshOf(ctx.learner, id, ctx.snap.regime_key);
}

function emptyVote(seat: SeatId, snap: Snapshot, extra: Partial<Vote>): Vote {
  return {
    seat,
    lean: "WAIT",
    confidence: 0,
    features: {},
    reasoning: "",
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
    counter: "none printed",
    invalidate_if: "next print that breaks the setup",
    health: "LIVE",
    feed_age_s: snap.spot_age_s,
    eyes: "",
    phase: snap.phase,
    ...extra,
  };
}

function clockOwnedWait(seat: SeatId, snap: Snapshot): Vote | null {
  const c = readClock(snap);
  if (!c.owns) return null;
  return emptyVote(seat, snap, {
    eyes: "spot vs strike clock",
    hypothesis: "clock-owned window",
    reasoning: `STRIKE owns the clock (z ${c.z.toFixed(2)}σ) ITM ${c.itm} → sit`,
    evidence: [
      `z ${c.z.toFixed(2)} · σ ${round(c.sigma, 1)}`,
      `|dist| ${round(Math.abs(c.dist), 1)} · ${round(c.mins, 1)}m left`,
      `ITM ${c.itm}`,
    ],
    invalidate_if: "spot returns inside 1.25σ of strike",
    features: { clock_z: round(c.z, 2), strike_owns: true, itm: c.itm },
  });
}

function healthOf(
  snap: Snapshot,
  kind: "spot" | "kalshi" | "derivs" | "mixed" | "meta",
): { health: FeedHealth; age: number; mult: number } {
  if (kind === "meta") return { health: "LIVE", age: 0, mult: 1 };
  if (kind === "spot") {
    const h = snap.health.spot;
    return { health: h, age: snap.spot_age_s, mult: h === "LIVE" ? 1 : h === "STALE" ? 0.6 : 0 };
  }
  if (kind === "kalshi") {
    const h = snap.health.kalshi;
    return { health: h, age: snap.quote_age_s, mult: h === "LIVE" ? 1 : h === "STALE" ? 0.6 : 0 };
  }
  if (kind === "derivs") {
    const h = snap.health.derivs;
    return { health: h, age: 20, mult: h === "LIVE" ? 1 : h === "STALE" ? 0.6 : 0 };
  }
  const worst = [snap.health.spot, snap.health.kalshi].includes("DOWN")
    ? "DOWN"
    : [snap.health.spot, snap.health.kalshi].includes("STALE")
      ? "STALE"
      : "LIVE";
  const age = Math.max(snap.spot_age_s, snap.quote_age_s);
  return {
    health: worst,
    age,
    mult: worst === "LIVE" ? 1 : worst === "STALE" ? 0.6 : 0,
  };
}

type Fired = { lean: Lean; confidence: number; v: Vote };

function stampSkill(v: Vote, ctx: BotCtx): Vote {
  const card = ctx.learner.skills[v.skill_used];
  if (card) {
    v.skill_n = card.n;
    v.skill_hits = card.hits;
    v.skill_wilson = card.wilson;
    v.skill_status = card.status;
    if (!v.thresh_used?.length) {
      const rule = card.rule ?? SKILL_RULES[card.id];
      const used = [];
      for (const p of [...(rule?.all ?? []), ...(rule?.any ?? [])]) {
        if (!p.thresh) continue;
        used.push({
          id: p.thresh,
          x: ctx.feats[p.feat] ?? 0,
          t: T(ctx, p.thresh),
        });
      }
      v.thresh_used = used;
    }
  }
  return v;
}

function evalDsl(ctx: BotCtx, id: string): Fired | null {
  const card = ctx.learner.skills[id];
  const rule = card?.rule ?? SKILL_RULES[id];
  if (!card || !rule) return null;
  const r = evalRule(rule, ctx.feats, ctx.learner, ctx.snap.regime_key);
  if (!r) return null;
  const v = fire(
    ctx,
    card.owner,
    id,
    r.lean,
    r.edge,
    r.reasoning,
    {
      evidence: r.evidence,
      features: r.features,
      invalidate_if: card.invalidate_if,
      eyes: card.eyes,
      thresh_used: r.thresh_used,
    },
    r.cap,
  );
  return { lean: v.lean, confidence: v.confidence, v };
}

function tryEval(ctx: BotCtx, evalId: (id: string) => Fired | null, id: string): Fired | null {
  return evalId(id) ?? evalDsl(ctx, id);
}

function brierScale(v: Vote, ctx: BotCtx): Vote {
  if (v.lean === "WAIT" || v.skill_used === "SIT") return v;
  const card = ctx.learner.skills[v.skill_used];
  if (!card || card.brier_n < 8) return v;
  if (card.brier > 0.3) v.confidence = Math.round(v.confidence * 0.85);
  else if (card.brier < 0.18) v.confidence = Math.min(92, Math.round(v.confidence * 1.05));
  if (card.ev_n >= 8 && card.ev < 0) v.confidence = Math.round(v.confidence * 0.72);
  return v;
}

function pickLiveAndPaper(
  ctx: BotCtx,
  seat: SeatId,
  evalId: (id: string) => Fired | null,
  wait: Vote,
): Vote {
  const learner = ctx.learner;
  const live = liveSkills(learner, seat);
  const fired: { id: string; score: number; got: Fired }[] = [];
  for (const s of live) {
    if (learner.learn_phase === "EXPLOIT" && s.n >= 16 && s.wilson < 0.42) continue;
    const got = tryEval(ctx, evalId, s.id);
    if (got) fired.push({ id: s.id, score: skillScore(s), got });
  }
  fired.sort((a, b) => b.score - a.score);
  const keepWait =
    wait.hypothesis === "in-window path revision" || wait.hypothesis === "clock-owned window";
  let chosen = keepWait ? wait : fired[0]?.got.v ?? wait;
  chosen = stampSkill(chosen, ctx);

  const papers: PaperLean[] = [];
  const others = Object.values(learner.skills).filter(
    (s) => s.owner === seat && s.id !== chosen.skill_used,
  );
  for (const s of others) {
    const got = tryEval(ctx, evalId, s.id);
    if (!got) continue;
    papers.push({
      id: s.id,
      lean: got.lean,
      confidence: got.confidence,
      status: s.status,
    });
  }
  chosen.paper = papers;
  const sh =
    papers.find((p) => p.status === "SHADOW") ?? papers.find((p) => p.status === "BENCH");
  if (sh) chosen.shadow = { id: sh.id, lean: sh.lean, confidence: sh.confidence };
  return brierScale(chosen, ctx);
}

function applyHealth(v: Vote, h: { health: FeedHealth; age: number; mult: number }): Vote {
  v.health = h.health;
  v.feed_age_s = h.age;
  if (h.health === "DOWN") {
    v.lean = "WAIT";
    v.confidence = 0;
    v.reasoning = "NO PRINT — bot is silent";
    v.evidence = ["DOWN — no last-good this session"];
    v.skill_used = "SIT";
    v.skill_status = "SIT";
  } else if (h.health === "STALE" && v.lean !== "WAIT") {
    v.confidence = Math.round(v.confidence * 0.6);
    v.evidence = [`STALE ${h.age.toFixed(0)}s`, ...v.evidence];
  }
  return v;
}

function fire(
  ctx: BotCtx,
  seat: SeatId,
  id: string,
  lean: Lean,
  edge: number,
  reasoning: string,
  extra: Partial<Vote>,
  cap?: number,
): Vote {
  const card = ctx.learner.skills[id];
  const status = card?.status ?? "LIVE";
  const h = extra.health
    ? { health: extra.health, age: extra.feed_age_s ?? 0, mult: 1 }
    : healthOf(ctx.snap, "spot");
  const last1 = last(ctx.snap.candles_1m);
  const conf = directionalConf(edge, ctx.snap.phase, h.mult, {
    unclosed: seat === "WICK" && last1 ? !last1.closed : false,
    midRange: ctx.snap.location === "MID" && seat === "WICK",
    cap,
  });
  return {
    seat,
    lean: h.mult === 0 ? "WAIT" : lean,
    confidence: h.mult === 0 ? 0 : lean === "WAIT" ? Math.max(conf, 70) : conf,
    features: extra.features ?? {},
    reasoning,
    skill_used: id,
    skill_status: status,
    shadow: null,
    paper: extra.paper ?? [],
    thresh_used: extra.thresh_used ?? [],
    skill_n: card?.n ?? 0,
    skill_hits: card?.hits ?? 0,
    skill_wilson: card?.wilson ?? 0,
    hypothesis: extra.hypothesis ?? reasoning,
    evidence: extra.evidence ?? [],
    counter: extra.counter ?? "none printed",
    invalidate_if: extra.invalidate_if ?? "setup breaks",
    health: h.health,
    feed_age_s: h.age,
    eyes: extra.eyes ?? "",
    phase: ctx.snap.phase,
  };
}

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

function wickGate(
  m: WickMark | undefined,
  learner: Learner,
  waitOk = false,
): { ok: boolean; why: string; cap?: number; mul: number } {
  if (!m) return { ok: false, why: "no print", mul: 0 };
  if (m.lean === "WAIT" && waitOk) return { ok: true, why: "", mul: 1 };
  if (m.pending) return { ok: false, why: `${MARK_LABEL[m.kind]} waiting confirm bar`, mul: 0 };
  if (!m.confirmed) return { ok: false, why: `${MARK_LABEL[m.kind]} confirm failed`, mul: 0 };
  if (!m.contextOk) return { ok: false, why: `${MARK_LABEL[m.kind]} at ${m.loc} — no location context`, mul: 0 };
  const trust = patternTrust(learner.pattern_book[MARK_LABEL[m.kind]]);
  if (trust.fold)
    return {
      ok: false,
      why: `${MARK_LABEL[m.kind]} ledger fold W${Math.round(trust.wilson * 100)} n=${trust.n}`,
      mul: 0,
    };
  return { ok: true, why: "", cap: trust.cap, mul: m.confluence * trust.mul };
}

function wickFire(
  ctx: BotCtx,
  id: string,
  m: WickMark,
  lean: Lean,
  edge: number,
  reasoning: string,
  evidence: string[],
  extra: Partial<Vote>,
  cap?: number,
): Fired {
  const v = fire(
    ctx,
    "WICK",
    id,
    lean,
    edge,
    reasoning,
    {
      ...extra,
      features: {
        pattern: MARK_LABEL[m.kind],
        pattern_kind: MARK_LABEL[m.kind],
        loc: m.loc,
        confirmed: m.confirmed,
        context: m.contextOk,
        confluence: round(m.confluence, 2),
        ...(extra.features ?? {}),
      },
      evidence,
    },
    cap,
  );
  return { lean: v.lean, confidence: v.confidence, v };
}

function wickBot(ctx: BotCtx): Vote {
  const snap = ctx.snap;
  const h = healthOf(snap, "spot");
  const c1 = snap.candles_1m.filter((c) => c.closed);
  const lastC = last(c1);
  if (!lastC || h.health === "DOWN") {
    return applyHealth(emptyVote("WICK", snap, { eyes: "1m/5m candles" }), h);
  }
  const loc = snap.location;
  const read5 = readWick(snap.candles_5m);
  const read = readWick(c1, read5.structure.trend);
  rememberPatterns(ctx.learner, read);
  const mtf = Boolean(
    read.amd && read5.amd && read.amd.lean === read5.amd.lean && read.amd.lean !== "WAIT",
  );
  const volBoost = read.volConfirm ? 1.08 : 0.92;
  const rsiNote = `RSI ${round(read.rsi, 0)}`;
  const trendNote = `struct ${read.structure.trend}`;
  const mtfNote = `5m ${read5.structure.trend}${mtf ? " AMD agrees" : ""}`;
  const blocked: string[] = [];
  const trustLabel = (m: WickMark) =>
    patternTrust(ctx.learner.pattern_book[MARK_LABEL[m.kind]]).label;

  const evalId = (id: string): Fired | null => {
    const tryM = (kinds: WickMark["kind"] | WickMark["kind"][]) => {
      const m = lastMark(read, kinds);
      const g = wickGate(m, ctx.learner);
      if (!g.ok) {
        if (m) blocked.push(g.why);
        return null;
      }
      return { m: m!, g };
    };
    if (id === "WICK.pin_at_high") {
      const got = tryM(["pin", "shoot", "gravestone", "hanging"]);
      if (!got) return null;
      return wickFire(
        ctx,
        id,
        got.m,
        "DOWN",
        clamp01(0.62 * volBoost * got.g.mul),
        `${MARK_LABEL[got.m.kind]} at ${got.m.loc} confirmed → fade`,
        [
          `${MARK_LABEL[got.m.kind]} ${got.m.loc} CFM · confluence ${round(got.m.confluence, 2)}`,
          `${trendNote} · ${rsiNote} · ${mtfNote}`,
          `vol ${read.volConfirm ? "confirms" : "thin"} · ledger ${trustLabel(got.m)}`,
        ],
        {
          counter:
            snap.ret5 > 0
              ? `ret5 still ${round(snap.ret5 * 100, 2)}% against fade`
              : mtf
                ? "none printed"
                : "5m trend disagrees",
          invalidate_if: "opposite engulf, or next close reclaims the wick high",
          eyes: "1m candles last 60",
        },
        got.g.cap,
      );
    }
    if (id === "WICK.hammer_at_low") {
      const got = tryM(["hammer", "dragonfly", "inv_ham"]);
      if (!got) return null;
      return wickFire(
        ctx,
        id,
        got.m,
        "UP",
        clamp01(0.62 * volBoost * got.g.mul),
        `${MARK_LABEL[got.m.kind]} at ${got.m.loc} confirmed → fade dump`,
        [
          `${MARK_LABEL[got.m.kind]} ${got.m.loc} CFM · confluence ${round(got.m.confluence, 2)}`,
          `${trendNote} · ${rsiNote} · ${mtfNote}`,
          `vol ${read.volConfirm ? "confirms" : "thin"} · ledger ${trustLabel(got.m)}`,
        ],
        {
          counter:
            snap.ret5 < 0
              ? `ret5 still ${round(snap.ret5 * 100, 2)}% against bounce`
              : "none printed",
          invalidate_if: "next close below the hammer low",
          eyes: "1m hammer at LOW",
        },
        got.g.cap,
      );
    }
    if (id === "WICK.engulf_at_extreme") {
      const got = tryM(["engulf-up", "engulf-down"]);
      if (!got) return null;
      return wickFire(
        ctx,
        id,
        got.m,
        got.m.lean,
        clamp01(0.62 * volBoost * got.g.mul),
        `engulf ${got.m.lean} at ${got.m.loc} confirmed`,
        [`${MARK_LABEL[got.m.kind]} CFM`, `location ${got.m.loc}`, trendNote, mtfNote],
        { invalidate_if: "opposite engulf", eyes: "1m engulf" },
        got.g.cap,
      );
    }
    if (id === "WICK.doji_after_run") {
      const f = lastC;
      const body = Math.abs(f.close - f.open);
      const range = Math.max(1e-9, f.high - f.low);
      if (body / range > 0.12 || Math.abs(snap.ret15) < T(ctx, "ret15.min")) return null;
      const v = fire(
        ctx,
        "WICK",
        id,
        "WAIT",
        0.55,
        `${read.lastName} after |ret15| ${round(snap.ret15 * 100, 2)}% → sit`,
        {
          features: { pattern: read.lastName, ret15: snap.ret15 },
          evidence: [`${read.lastName} body ${round((body / range) * 100, 0)}%`, `|ret15| ${round(Math.abs(snap.ret15) * 100, 2)}%`],
          invalidate_if: "next bar is a full body",
          eyes: "1m doji",
        },
      );
      return { lean: v.lean, confidence: v.confidence, v };
    }
    if (id === "WICK.amd") {
      const got = tryM("amd");
      if (!got || read.amd?.phase !== "DISTRIBUTION" || read.amd.lean === "WAIT") return null;
      return wickFire(
        ctx,
        id,
        got.m,
        read.amd.lean,
        clamp01(read.amd.quality * volBoost * (mtf ? 1.12 : 1) * got.g.mul),
        `AMD ${read.amd.phase} ${read.amd.lean} — grab then displace`,
        [
          `acc box ${read.amd.acc.i1 - read.amd.acc.i0 + 1} bars`,
          `manip bar ${read.amd.manipI ?? "—"} · dist bar ${read.amd.distI ?? "—"}`,
          `${trendNote} · ${rsiNote} · ${mtfNote}`,
          `confluence ${round(got.m.confluence, 2)} · ledger ${trustLabel(got.m)}`,
        ],
        {
          features: { amd_phase: read.amd.phase, amd_lean: read.amd.lean, mtf_agree: mtf },
          counter: mtf ? "none printed" : "5m AMD does not agree",
          invalidate_if: "close back inside the accumulation box",
          eyes: "1m AMD box + sweep + displacement",
        },
        got.g.cap,
      );
    }
    if (id === "WICK.liq_sweep") {
      const got = tryM(["sweep-up", "sweep-dn"]);
      if (!got) return null;
      return wickFire(
        ctx,
        id,
        got.m,
        got.m.lean,
        clamp01(0.6 * volBoost * got.g.mul),
        `liquidity sweep ${got.m.kind} confirmed → ${got.m.lean}`,
        [`${got.m.kind} CFM closed back through swing`, trendNote, rsiNote, mtfNote],
        { invalidate_if: "next close continues through the swept swing", eyes: "1m sweep of swing" },
        got.g.cap,
      );
    }
    if (id === "WICK.morning_star") {
      const got = tryM("morn");
      if (!got) return null;
      return wickFire(
        ctx,
        id,
        got.m,
        "UP",
        clamp01(0.64 * volBoost * got.g.mul),
        `morning star at ${got.m.loc} confirmed → UP`,
        ["3-bar morning star CFM", got.m.loc, rsiNote, mtfNote],
        { invalidate_if: "next close back below the star low", eyes: "1m morning star" },
        got.g.cap,
      );
    }
    if (id === "WICK.evening_star") {
      const got = tryM("even");
      if (!got) return null;
      return wickFire(
        ctx,
        id,
        got.m,
        "DOWN",
        clamp01(0.64 * volBoost * got.g.mul),
        `evening star at ${got.m.loc} confirmed → DOWN`,
        ["3-bar evening star CFM", got.m.loc, rsiNote, mtfNote],
        { invalidate_if: "next close back above the star high", eyes: "1m evening star" },
        got.g.cap,
      );
    }
    if (id === "WICK.tweezer") {
      const got = tryM(["tweezer-top", "tweezer-bot"]);
      if (!got) return null;
      return wickFire(
        ctx,
        id,
        got.m,
        got.m.lean,
        clamp01(0.58 * got.g.mul),
        `tweezer ${got.m.kind} at ${got.m.loc} confirmed → ${got.m.lean}`,
        [got.m.kind, `location ${got.m.loc} CFM`, trendNote],
        { invalidate_if: "close through the tweezer level", eyes: "1m tweezer" },
        got.g.cap,
      );
    }
    if (id === "WICK.bos_close") {
      const got = tryM(["bos-up", "bos-dn"]);
      if (!got) return null;
      return wickFire(
        ctx,
        id,
        got.m,
        got.m.lean,
        clamp01(0.6 * got.g.mul),
        `BOS ${got.m.lean} confirmed — close through last swing`,
        [`break of structure ${got.m.lean} CFM`, trendNote, rsiNote, mtfNote],
        { invalidate_if: "next bar reclaims the broken swing", eyes: "1m BOS" },
        got.g.cap,
      );
    }
    return null;
  };

  const pending = [...read.marks]
    .reverse()
    .find((m) => m.pending && m.lean !== "WAIT" && m.i >= read.slice.length - 5);
  const amdLine = read.amd ? `AMD ${read.amd.phase}` : "no AMD box";
  const why =
    blocked[0] ??
    (pending
      ? `${MARK_LABEL[pending.kind]} at ${pending.loc} — waiting confirm close`
      : "quiet body / no location edge → WAIT");
  const wait = emptyVote("WICK", snap, {
    eyes: "1m/5m candles",
    hypothesis: pending
      ? `${MARK_LABEL[pending.kind]} at ${pending.loc} — waiting confirm close`
      : `1m ${read.lastName} at ${loc} — no LIVE skill fired`,
    evidence: [
      `pattern ${read.lastName} body ${round(read.lastFeat.bodyPct * 100, 0)}% close-pos ${round(read.lastFeat.closePos, 2)}`,
      `location ${loc} · ${trendNote} · ${amdLine}`,
      `${rsiNote} · EMA8/21 ${read.emaSlow ? (read.emaFast >= read.emaSlow ? "bull" : "bear") : "—"} · 5m ${read5.structure.trend}`,
      blocked[0] ? `gate ${blocked[0]}` : `ret15 ${round(snap.ret15 * 100, 2)}%`,
    ],
    reasoning: why,
    invalidate_if: pending
      ? "confirm bar closes against the pattern"
      : "confirmed pin/hammer at extreme, AMD displacement, or engulf",
    features: {
      pattern: read.lastName,
      structure: read.structure.trend,
      amd: read.amd?.phase ?? "none",
      rsi: round(read.rsi, 1),
      pending: pending ? MARK_LABEL[pending.kind] : "",
      confluence: pending ? round(pending.confluence, 2) : 0,
    },
  });
  return applyHealth(pickLiveAndPaper(ctx, "WICK", evalId, wait), h);
}

function dslSeat(
  ctx: BotCtx,
  seat: SeatId,
  kind: "spot" | "kalshi" | "derivs" | "mixed" | "meta",
  wait: Vote,
  evalId: (id: string) => Fired | null = () => null,
): Vote {
  const h = healthOf(ctx.snap, kind);
  if (h.health === "DOWN") {
    return applyHealth(
      emptyVote(seat, ctx.snap, { eyes: wait.eyes, reasoning: "NO PRINT — bot is silent" }),
      h,
    );
  }
  const owned = clockOwnedWait(seat, ctx.snap);
  const use = owned && (seat === "STRIKE" || seat === "CHEAP" || seat === "ODDS" || seat === "FADE")
    ? owned
    : wait;
  return applyHealth(pickLiveAndPaper(ctx, seat, evalId, use), h);
}

function driftBot(ctx: BotCtx): Vote {
  const d = readDrift(ctx.snap);
  return dslSeat(
    ctx,
    "DRIFT",
    "spot",
    emptyVote("DRIFT", ctx.snap, {
      eyes: "ret5 / ret15 / ret30",
      hypothesis: `${d.trend} · aligned ${d.aligned} · ${d.accel ? "ACCEL" : d.decay ? "DECAY" : d.pullback ? "PULLBACK" : d.chop ? "CHOP" : "WATCH"}`,
      evidence: [
        `5m ${round(ctx.snap.ret5 * 100, 2)}% · 15m ${round(ctx.snap.ret15 * 100, 2)}% · 30m ${round(ctx.snap.ret30 * 100, 2)}%`,
        `stack ${d.stack} · RSI ${Math.round(d.rsi)}`,
      ],
      reasoning: "need 5/15/30 aligned with |ret15| edge → WAIT",
      invalidate_if: "any horizon flips sign",
      features: { aligned: d.aligned, accel: d.accel, decay: d.decay },
    }),
  );
}

function streakBot(ctx: BotCtx): Vote {
  const st = readStreak(ctx.snap);
  return dslSeat(
    ctx,
    "STREAK",
    "mixed",
    emptyVote("STREAK", ctx.snap, {
      eyes: "last 8 settled chips",
      hypothesis: `streak ${st.n} ${st.side ?? "—"} live ${st.live}`,
      evidence: [`n ${st.n}`, `live break ${st.liveBreak}`, `yes agrees ${st.yesAgrees}`],
      reasoning: "no continue/fade setup → WAIT",
      invalidate_if: "live path breaks the streak side",
    }),
  );
}

function exhaustBot(ctx: BotCtx): Vote {
  const xh = readExhaust(ctx.snap);
  return dslSeat(
    ctx,
    "EXHAUST",
    "spot",
    emptyVote("EXHAUST", ctx.snap, {
      eyes: "1h + last six 5m",
      hypothesis: `${xh.ret1h >= 0 ? "1h UP" : "1h DN"} ${round(xh.ret1h * 100, 2)}% · ${xh.climax ? "CLIMAX" : xh.flipped ? "FLIP" : "WATCH"}`,
      evidence: [`extreme ${xh.extreme}`, `flip ${xh.flipped}`, `RSI ${Math.round(xh.rsi)}`],
      reasoning: "need 1h run + extreme + 5m flip → WAIT",
      invalidate_if: "5m resumes the 1h direction",
    }),
  );
}

function pulseBot(ctx: BotCtx): Vote {
  const p = readPulse(ctx.snap);
  return dslSeat(
    ctx,
    "PULSE",
    "spot",
    emptyVote("PULSE", ctx.snap, {
      eyes: "1m volume vs median",
      hypothesis: `vol ${round(p.ratio, 2)}× · ${p.spike ? "SPIKE" : p.dry ? "DRY" : "NORMAL"}`,
      evidence: [`ratio ${round(p.ratio, 2)}`, `pct ${round(p.pct, 0)}`, `px ${p.pxDir}`],
      reasoning: "no spike/dry-up → WAIT",
      invalidate_if: "next bar is an opposite spike",
    }),
  );
}

function tapeBot(ctx: BotCtx): Vote {
  const t = readTape(ctx.snap);
  return dslSeat(
    ctx,
    "TAPE",
    "kalshi",
    emptyVote("TAPE", ctx.snap, {
      eyes: "Kalshi book top 5",
      hypothesis: `persist ${t.persist} flip ${t.flip} thin ${t.thin}`,
      evidence: [`imb ${round(t.imb, 2)}`, `YES ${round(t.yesSz, 1)} / NO ${round(t.noSz, 1)}`],
      reasoning: "need same sign ≥ 4 snapshots → WAIT",
      invalidate_if: "imbalance holds 4 snapshots",
    }),
  );
}

function whaleBot(ctx: BotCtx): Vote {
  const w = readWhale(ctx.snap);
  return dslSeat(
    ctx,
    "WHALE",
    "spot",
    emptyVote("WHALE", ctx.snap, {
      eyes: "1m notional PROXY",
      hypothesis: w.proxy ? `PROXY ${round(w.ratio, 2)}× ${w.lean}` : "no large print this window",
      evidence: [`ratio ${round(w.ratio, 2)}`, `cluster ${w.cluster}`, `absorb ${w.absorb}`],
      reasoning: "none this window → WAIT",
      invalidate_if: "opposite large-print cluster",
    }),
  );
}

function velBot(ctx: BotCtx): Vote {
  const v = readVel(ctx.snap);
  return dslSeat(
    ctx,
    "VEL",
    "mixed",
    emptyVote("VEL", ctx.snap, {
      eyes: "spot lead vs YES mid",
      hypothesis: `lead ${round(v.lead, 1)} bps need ${round(v.need, 1)} · ${v.catching ? "CATCH" : v.fading ? "FADE" : "FLAT"}`,
      evidence: [`lead ${round(v.lead, 1)} bps`, `meaningful ${v.meaningful}`],
      reasoning: "no meaningful lead → WAIT",
      invalidate_if: "lag closes or spot reverses",
    }),
  );
}

function carryBot(ctx: BotCtx): Vote {
  const c = readCarry(ctx.snap);
  return dslSeat(
    ctx,
    "CARRY",
    "derivs",
    emptyVote("CARRY", ctx.snap, {
      eyes: "funding + OI",
      hypothesis: `fund ${c.last} extreme ${c.extreme} OI ${c.risingOi ? "up" : c.fallingOi ? "dn" : "flat"}`,
      evidence: [`persist ${c.persist}`, `normalize ${c.normalize}`],
      reasoning: "mild funding → WAIT",
      invalidate_if: "funding normalizes while OI still rising",
    }),
  );
}

function chainBot(ctx: BotCtx): Vote {
  const c = readChain(ctx.snap);
  return dslSeat(
    ctx,
    "CHAIN",
    "derivs",
    emptyVote("CHAIN", ctx.snap, {
      eyes: "OI vs price",
      hypothesis: `with px ${c.withPx} against ${c.against} accel ${c.accel}`,
      evidence: [`Δ10m ${round(c.d10, 2)}`, `stall ${c.stall}`],
      reasoning: "no OI path → WAIT",
      invalidate_if: "OI delta sign flips",
    }),
  );
}

function cascadeBot(ctx: BotCtx): Vote {
  const c = readCascade(ctx.snap);
  return dslSeat(
    ctx,
    "CASCADE",
    "derivs",
    emptyVote("CASCADE", ctx.snap, {
      eyes: "liq PROXY",
      hypothesis: c.proxy ? `PROXY flush ${c.lean}` : "no cascade",
      evidence: [`proxy ${c.proxy}`, `force_n ${c.forceN}`, `cluster ${c.cluster}`],
      reasoning: "no cascade → WAIT",
      invalidate_if: "OI stops flushing and vol collapses",
    }),
  );
}

function voltBot(ctx: BotCtx): Vote {
  const v = readVolt(ctx.snap);
  return dslSeat(
    ctx,
    "VOLT",
    "spot",
    emptyVote("VOLT", ctx.snap, {
      eyes: "ATR% vs median",
      hypothesis: v.dead ? "DEAD vol" : v.expand ? "EXPAND" : v.coil ? "COIL" : "NORMAL",
      evidence: [`ATR% ${round(v.atrPct, 3)}`, `vol pct ${round(v.volPct, 0)}`],
      reasoning: "not dead, no expansion break → WAIT",
      invalidate_if: "vol collapses back under the median",
    }),
  );
}

function oddsBot(ctx: BotCtx): Vote {
  const s = ctx.snap;
  return dslSeat(
    ctx,
    "ODDS",
    "kalshi",
    emptyVote("ODDS", s, {
      eyes: "YES mid vs 50¢",
      hypothesis: `YES ${round(s.yes_mid, 1)}¢ — not cheap/rich setup`,
      evidence: [`YES ${round(s.yes_mid, 1)}¢`, `bid ${s.yes_bid} ask ${s.yes_ask}`],
      reasoning: "no value extreme → WAIT",
      invalidate_if: "YES ≤ 42¢ or ≥ 58¢ with quiet path",
    }),
  );
}

function strikeBot(ctx: BotCtx): Vote {
  const s = ctx.snap;
  const clk = readClock(s);
  return dslSeat(
    ctx,
    "STRIKE",
    "mixed",
    emptyVote("STRIKE", s, {
      eyes: "spot vs strike",
      hypothesis: `z ${clk.z.toFixed(2)}σ dist ${round(clk.dist, 1)}`,
      evidence: [`spot ${round(s.spot, 1)}`, `strike ${s.strike}`, `mins ${round(s.mins_left, 2)}`],
      reasoning: "no ITM-time or magnet → WAIT",
      invalidate_if: "spot through strike",
    }),
  );
}

function cheapBot(ctx: BotCtx): Vote {
  const s = ctx.snap;
  const yes = s.yes_mid;
  const no = 100 - yes;
  if (ctx.trendDay && (yes <= 42 || no <= 42)) {
    return applyHealth(
      emptyVote("CHEAP", s, {
        eyes: "42/58 bands",
        reasoning: "trend-day cheap = value trap → WAIT",
        hypothesis: "ORBIT trend-day overrides value",
        evidence: [`YES ${round(yes, 1)}¢`, `trend-day yes`],
      }),
      healthOf(s, "kalshi"),
    );
  }
  return dslSeat(
    ctx,
    "CHEAP",
    "kalshi",
    emptyVote("CHEAP", s, {
      eyes: "YES¢ / NO¢ bands",
      hypothesis: "neither side ≤ 42¢",
      evidence: [`YES ${round(yes, 1)}¢`, `NO ${round(no, 1)}¢`],
      reasoning: "no cheap contract → WAIT",
      invalidate_if: "a side prints ≤ 42¢",
    }),
  );
}

function fadeBot(ctx: BotCtx): Vote {
  const s = ctx.snap;
  const path = s.yes_mid_path;
  const d60 = path.length >= 6 ? path[path.length - 1]! - path[path.length - 6]! : 0;
  const d30 = path.length >= 4 ? path[path.length - 1]! - path[path.length - 4]! : 0;
  if (ctx.trendDay && Math.abs(d60) >= 8) {
    return applyHealth(
      emptyVote("FADE", s, {
        eyes: "YES rip",
        reasoning: "not on ORBIT trend-day",
        hypothesis: "rip ignored on trend-day",
        evidence: [`Δ60s ${round(d60, 1)}¢`, `trend-day yes`],
      }),
      healthOf(s, "kalshi"),
    );
  }
  return dslSeat(
    ctx,
    "FADE",
    "kalshi",
    emptyVote("FADE", s, {
      eyes: "YES mid rip",
      hypothesis: `Δ60s ${round(d60, 1)}¢ — need 8–12¢`,
      evidence: [`Δ30 ${round(d30, 1)}¢`, `Δ60 ${round(d60, 1)}¢`],
      reasoning: "no 60s rip → WAIT",
      invalidate_if: "YES mid rip ≥ 8¢ in 60s",
    }),
  );
}

function orbitBot(ctx: BotCtx): Vote {
  const s = ctx.snap;
  const quiet = ctx.quiet;
  return emptyVote("ORBIT", s, {
    eyes: "regime tiles",
    hypothesis: quiet
      ? "quiet regime — raise confluence bar, no side"
      : "expansion/normal — do not vote a side",
    evidence: [
      `session ${s.session} ${s.phase}`,
      `ATR% ${round(s.atr_pct, 3)} pct ${round(s.vol_percentile, 0)}`,
      `streak ${s.window_memory.streak_n} ${s.window_memory.streak_side ?? "—"}`,
    ],
    reasoning: quiet ? "quiet → WAIT, raise bar" : "ORBIT does not vote a side",
    skill_used: "ORBIT.quiet_raise_bar",
    skill_status: "LIVE",
    features: {
      quiet,
      trendDay: ctx.trendDay,
      atr_pct: s.atr_pct,
      vol_percentile: s.vol_percentile,
      aggressiveness: quiet ? 0.35 : 0.7,
    },
    invalidate_if: "ATR percentile crosses the quiet/expansion line",
    confidence: quiet ? 78 : 70,
  });
}

function clockBot(ctx: BotCtx): Vote {
  const s = ctx.snap;
  const key = s.clock_key || `${s.session}_${new Date(s.as_of).getUTCDay()}`;
  const card = ctx.learner.skills["CLOCK.session_prior"];
  const pocket = card?.pocket[key];
  const n = pocket?.n ?? 0;
  if (n < 8) {
    return emptyVote("CLOCK", s, {
      eyes: "session clock",
      hypothesis: `no prior for ${key}`,
      evidence: [`session ${s.session}`, `mins ${round(s.mins_left, 2)}`, `n=${n} need 8`],
      reasoning: "UNCALIBRATED — WAIT until hour/weekday n ≥ 8",
      skill_used: "CLOCK.session_prior",
      skill_status: "LIVE",
      features: { uncalibrated: true, pocket: key, n },
      invalidate_if: "CLOCK does not flip alone",
      confidence: 72,
    });
  }
  const hit = n > 0 ? (pocket?.hits ?? 0) / n : 0.5;
  const lean: Lean = hit >= 0.55 ? "UP" : hit <= 0.45 ? "DOWN" : "WAIT";
  return emptyVote("CLOCK", s, {
    eyes: "session clock",
    lean,
    confidence: lean === "WAIT" ? 70 : Math.min(58, Math.round(50 + Math.abs(hit - 0.5) * 80)),
    hypothesis: `soft prior ${key} hit ${round(hit * 100, 0)}% n=${n}`,
    evidence: [`session ${s.session}`, `clock ${key}`, `prior ${round(hit * 100, 0)}%`],
    reasoning: "soft prior only — will not flip a mid-window call alone",
    skill_used: "CLOCK.session_prior",
    skill_status: "LIVE",
    invalidate_if: "nothing mid-window; CLOCK does not flip alone",
  });
}

function wireBot(ctx: BotCtx): Vote {
  const s = ctx.snap;
  return dslSeat(
    ctx,
    "WIRE",
    "meta",
    emptyVote("WIRE", s, {
      eyes: "Fear & Greed",
      hypothesis: `F&G ${s.fear_greed} ${s.fear_greed_label} — not extreme`,
      evidence: [`F&G ${s.fear_greed}`, `label ${s.fear_greed_label}`],
      reasoning: "only lean at extreme F&G → WAIT",
      invalidate_if: `index enters ≤${T(ctx, "fng.lo").toFixed(0)} or ≥${T(ctx, "fng.hi").toFixed(0)}`,
    }),
  );
}

function wardenBot(ctx: BotCtx): Vote {
  const s = ctx.snap;
  const both = s.health.spot === "DOWN" && s.health.kalshi === "DOWN";
  const one = s.health.spot === "DOWN" || s.health.kalshi === "DOWN";
  return emptyVote("WARDEN", s, {
    eyes: "feed health",
    lean: "WAIT",
    confidence: both ? 92 : 70,
    hypothesis: both
      ? "both feeds down — Chair veto WAIT 92"
      : one
        ? "one feed down — cap directional conf at 62"
        : "feeds healthy",
    evidence: [
      `SPOT ${s.health.spot} ${s.spot_age_s.toFixed(1)}s ${s.spot_source}`,
      `KALSHI ${s.health.kalshi} ${s.quote_age_s.toFixed(1)}s`,
      `DERIVS ${s.health.derivs} ${s.health.derivs_source}`,
    ],
    reasoning: both ? "WARDEN veto" : "never votes a side",
    skill_used: "WARDEN.both_down",
    skill_status: "LIVE",
    features: { both, one, cap62: one && !both },
    invalidate_if: "both feeds print fresh",
  });
}

const FNS: Record<SeatId, (ctx: BotCtx) => Vote> = {
  WICK: wickBot,
  DRIFT: driftBot,
  STREAK: streakBot,
  EXHAUST: exhaustBot,
  PULSE: pulseBot,
  TAPE: tapeBot,
  WHALE: whaleBot,
  VEL: velBot,
  CARRY: carryBot,
  CHAIN: chainBot,
  CASCADE: cascadeBot,
  VOLT: voltBot,
  ODDS: oddsBot,
  STRIKE: strikeBot,
  CHEAP: cheapBot,
  FADE: fadeBot,
  ORBIT: orbitBot,
  CLOCK: clockBot,
  WIRE: wireBot,
  WARDEN: wardenBot,
};

export function detectTrendDay(snap: Snapshot): boolean {
  return Math.abs(snap.ret1h) >= 0.012 && snap.vol_percentile >= 60;
}

export function detectQuiet(snap: Snapshot): boolean {
  return (
    snap.atr_pct < (THRESH_SPECS["atr.dead"]?.base ?? 0.12) ||
    snap.vol_percentile < (THRESH_SPECS["vol.dead_pct"]?.base ?? 25)
  );
}

export function runBots(snap: Snapshot, learner: Learner): Vote[] {
  const trendDay = detectTrendDay(snap);
  const quiet = detectQuiet(snap);
  const feats = featOf(snap, trendDay, quiet);
  learner.last_feats = feats;
  learner.last_regime = snap.regime_key;
  const ctx: BotCtx = { snap, learner, trendDay, quiet, feats };
  return (Object.keys(FNS) as SeatId[]).map((id) => FNS[id](ctx));
}
