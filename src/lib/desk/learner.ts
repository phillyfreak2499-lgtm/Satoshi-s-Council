import { cloneResidualRule, formatRule, SKILL_RULES } from "./dsl";
import { centsOf } from "./clock";
import { creditPattern } from "./ledger";
import { binKey, clamp, mean, round, seatCalib, WARM_N, wilsonLower } from "./math";
import { SEATS } from "./seats";
import {
  benchThreshold,
  huddleEvery,
  parentSeatWilson,
  phaseOfWindows,
  promoThreshold,
  recencyRate,
  refreshDerived,
  skillCounts,
  SKILL_SEEDS,
} from "./skills";
import { nudgeThresh, recordThresh, retuneThresholds } from "./thresholds";
import type {
  CandidateCard,
  ChairResult,
  Learner,
  Lean,
  PaperLean,
  SeatId,
  SkillCard,
  Snapshot,
  ThreshUse,
  Vote,
} from "./types";

function push20(arr: number[], v: number): number[] {
  const next = [...arr, v];
  return next.slice(-20);
}

function creditDirectional(
  card: SkillCard,
  hit: number,
  confidence: number,
  pocketKey: string,
  cents: number,
) {
  card.n += 1;
  card.hits += hit;
  card.streak_wrong = hit ? 0 : card.streak_wrong + 1;
  card.last20 = push20(card.last20, hit);
  const p = Math.max(0, Math.min(1, confidence / 100));
  card.brier_sum += (p - hit) ** 2;
  card.brier_n += 1;
  card.ev_sum = (card.ev_sum ?? 0) + cents;
  card.ev_n = (card.ev_n ?? 0) + 1;
  const pocket = card.pocket[pocketKey] ?? { n: 0, hits: 0 };
  pocket.n += 1;
  pocket.hits += hit;
  card.pocket[pocketKey] = pocket;
  refreshDerived(card);
}

function creditWait(card: SkillCard, good: boolean) {
  if (good) card.wait_good += 1;
  else card.wait_miss += 1;
}

function tuneFromCard(
  learner: Learner,
  card: SkillCard,
  hit: number,
  snap: Snapshot,
  used?: ThreshUse[],
) {
  const regime = snap.regime_key;
  if (used?.length) {
    for (const u of used) {
      recordThresh(learner, u.id, regime, u.x, hit);
      nudgeThresh(learner, u.id, regime, u.x, hit);
    }
    return;
  }
  const feats = learner.last_feats ?? {};
  const rule = card.rule ?? SKILL_RULES[card.id];
  for (const p of [...(rule?.all ?? []), ...(rule?.any ?? [])]) {
    if (!p.thresh) continue;
    const x = feats[p.feat];
    if (!Number.isFinite(x)) continue;
    recordThresh(learner, p.thresh, regime, x, hit);
    nudgeThresh(learner, p.thresh, regime, x, hit);
  }
}

function waitWasGood(
  seat: SeatId,
  vote: Vote,
  chair: ChairResult,
  finish: Lean,
): boolean {
  if (seat === "ORBIT" || seat === "VOLT" || seat === "CLOCK") {
    return chair.lean === "WAIT" || chair.lean !== finish;
  }
  const hypo = (vote.paper ?? []).find((p) => p.lean === "UP" || p.lean === "DOWN");
  if (hypo) return hypo.lean !== finish;
  if (chair.lean === "WAIT") return true;
  return chair.lean !== finish;
}

function updateFade(learner: Learner, seat: SeatId, hit: number) {
  const rec = push20(learner.seat_recent[seat] ?? [], hit);
  learner.seat_recent[seat] = rec;
  const cur = learner.fade_strength[seat] ?? 0;
  if (hit) learner.fade_strength[seat] = cur * 0.75;
  if (rec.length < 6) return;
  const slice = rec.slice(-8);
  const rate = mean(slice);
  const now = learner.fade_strength[seat] ?? 0;
  if (rate < 0.38) learner.fade_strength[seat] = Math.min(1, now + 0.12);
  else if (rate > 0.58) learner.fade_strength[seat] = now * 0.7;
  else learner.fade_strength[seat] = now * 0.92;
}

function gradePaper(
  learner: Learner,
  paper: PaperLean,
  finish: "UP" | "DOWN",
  chair: ChairResult,
  pocketKey: string,
  bits: string[],
  snap: Snapshot,
) {
  const card = learner.skills[paper.id];
  if (!card) return;
  if (paper.lean === "UP" || paper.lean === "DOWN") {
    const hit = paper.lean === finish ? 1 : 0;
    const cents = centsOf(paper.lean, snap, finish);
    creditDirectional(card, hit, paper.confidence, pocketKey, cents);
    tuneFromCard(learner, card, hit, snap);
    bits.push(`${paper.id} ${paper.status[0]} ${hit ? "hit" : "miss"} ${cents >= 0 ? "+" : ""}${cents.toFixed(0)}¢`);
  } else {
    const good = waitWasGood(card.owner, { paper: [paper], lean: "WAIT" } as Vote, chair, finish);
    creditWait(card, good);
    bits.push(`${paper.id} ${paper.status[0]} ${good ? "good-sit" : "missed-edge"}`);
  }
}

export function gradeWindow(
  learner: Learner,
  snap: Snapshot,
  votes: Vote[],
  chair: ChairResult,
  finish: "UP" | "DOWN",
): { learner: Learner; line: string } {
  const wasLocked =
    learner.lockdown ||
    snap.as_of < learner.lockdown_until ||
    (learner.lockdown_windows_left ?? 0) > 0;
  const chalk = snap.chalk || snap.leftover_cents > 2;
  const dualDown = snap.health.spot === "DOWN" && snap.health.kalshi === "DOWN";
  if (chalk || dualDown) {
    if (wasLocked) consumeLock(learner);
    const line = `SETTLE ${new Date(snap.close_time).toISOString().slice(11, 16)} ${finish} · skipped credit (chalk/phantom leftover/feeds)`;
    learner.settle_tape = [line, ...learner.settle_tape].slice(0, 40);
    learner.window_memory.prior_settles = [...learner.window_memory.prior_settles, finish].slice(-24);
    updateStreak(learner, finish);
    return { learner, line };
  }

  const bits: string[] = [];
  const pocketKey = snap.regime_key;

  const clockCard = learner.skills["CLOCK.session_prior"];
  if (clockCard) {
    const ck = snap.clock_key || `${snap.session}_${new Date(snap.as_of).getUTCDay()}`;
    const p = clockCard.pocket[ck] ?? { n: 0, hits: 0 };
    p.n += 1;
    p.hits += finish === "UP" ? 1 : 0;
    clockCard.pocket[ck] = p;
  }

  for (const v of votes) {
    if (v.seat === "WARDEN") continue;
    const skillId = v.skill_used;
    const card = skillId !== "SIT" ? learner.skills[skillId] : null;
    if (v.lean === "UP" || v.lean === "DOWN") {
      const hit = v.lean === finish ? 1 : 0;
      const cents = centsOf(v.lean, snap, finish);
      learner.seat_n[v.seat] = (learner.seat_n[v.seat] ?? 0) + 1;
      learner.seat_hits[v.seat] = (learner.seat_hits[v.seat] ?? 0) + hit;
      updateFade(learner, v.seat, hit);
      if (card) {
        creditDirectional(card, hit, v.confidence, pocketKey, cents);
        tuneFromCard(learner, card, hit, snap, v.thresh_used);
      }
      bits.push(`${v.seat} ${v.lean}${hit ? " hit" : " miss"} ${cents >= 0 ? "+" : ""}${cents.toFixed(0)}¢`);
    } else if (card) {
      const good = waitWasGood(v.seat, v, chair, finish);
      creditWait(card, good);
      bits.push(`${v.seat} WAIT ${good ? "good-sit" : "missed-edge"}`);
    } else {
      bits.push(`${v.seat} SIT`);
    }
    for (const p of v.paper ?? []) {
      if (p.id === skillId) continue;
      gradePaper(learner, p, finish, chair, pocketKey, bits, snap);
    }
  }

  if (!learner.pattern_book) learner.pattern_book = {};
  for (const p of learner.window_patterns ?? []) {
    if (p.lean !== "UP" && p.lean !== "DOWN") continue;
    const cents = centsOf(p.lean, snap, finish);
    creditPattern(learner.pattern_book, p.kind, p.lean, finish, cents);
    bits.push(
      `${p.kind} ${p.lean === finish ? "hit" : "miss"} ${cents >= 0 ? "+" : ""}${cents.toFixed(0)}¢`,
    );
  }
  learner.window_patterns = [];

  if (chair.lean === "UP" || chair.lean === "DOWN") {
    const hit = chair.lean === finish ? 1 : 0;
    const cents = centsOf(chair.lean, snap, finish);
    learner.chair_recent = push20(learner.chair_recent, hit);
    learner.chair_ev_sum = (learner.chair_ev_sum ?? 0) + cents;
    learner.chair_ev_n = (learner.chair_ev_n ?? 0) + 1;
    const bin = binKey(chair.confidence);
    const b = learner.conf_bins[bin] ?? { n: 0, hits: 0 };
    b.n += 1;
    b.hits += hit;
    learner.conf_bins[bin] = b;
    if (hit) {
      learner.law_wrongs = 0;
      learner.lockdown = false;
      learner.lockdown_until = 0;
      learner.lockdown_windows_left = 0;
    } else {
      learner.law_wrongs += 1;
      if (learner.law_wrongs >= 2) {
        learner.lockdown = true;
        learner.lockdown_windows_left = 1;
        learner.lockdown_until = snap.close_time + 15 * 60_000;
      }
    }
  }
  if (wasLocked) consumeLock(learner);

  learner.graded_windows += 1;
  learner.learn_phase = phaseOfWindows(learner.graded_windows);

  learner.window_memory.prior_settles = [
    ...learner.window_memory.prior_settles,
    finish,
  ].slice(-24);
  updateStreak(learner, finish);
  learner.window_memory.path_since_entry = [];
  learner.window_memory.entry_lean = null;

  const line = `SETTLE ${new Date(snap.close_time).toISOString().slice(11, 16)} finish ${finish} · Chair ${chair.lean}${chair.confidence}${
    chair.lean === "UP" || chair.lean === "DOWN"
      ? ` ${centsOf(chair.lean, snap, finish) >= 0 ? "+" : ""}${centsOf(chair.lean, snap, finish).toFixed(0)}¢`
      : ""
  } · ${bits.slice(0, 10).join(" · ")}`;
  learner.settle_tape = [line, ...learner.settle_tape].slice(0, 48);
  return { learner, line };
}

export function skipUngraded(learner: Learner, snap: Snapshot, reason: string): Learner {
  const line = `SETTLE ${new Date(snap.close_time).toISOString().slice(11, 16)} · skipped (${reason})`;
  learner.settle_tape = [line, ...learner.settle_tape].slice(0, 48);
  learner.window_memory.path_since_entry = [];
  learner.window_memory.entry_lean = null;
  return learner;
}

function updateStreak(learner: Learner, finish: Lean) {
  const mem = learner.window_memory;
  if (mem.streak_side === finish) mem.streak_n += 1;
  else {
    mem.streak_side = finish;
    mem.streak_n = 1;
  }
}

function consumeLock(learner: Learner) {
  learner.lockdown_windows_left = Math.max(0, (learner.lockdown_windows_left ?? 1) - 1);
  if (learner.lockdown_windows_left <= 0) {
    learner.lockdown = false;
    learner.lockdown_until = 0;
    learner.law_wrongs = 0;
  }
}

export function rebuildSeatWeights(learner: Learner): string[] {
  const notes: string[] = [];
  const prior: Record<string, number> = {};
  for (const s of SEATS) {
    if (s.id === "WARDEN") continue;
    prior[s.id] = s.base;
  }
  const priorSum = Object.values(prior).reduce((a, b) => a + b, 0);
  const frozen: Record<string, number> = {};
  const flex: Record<string, number> = {};
  for (const id of Object.keys(prior)) {
    const p = prior[id]!;
    const n = learner.seat_n[id] ?? 0;
    if (n < WARM_N) {
      frozen[id] = p;
      continue;
    }
    const wilson = wilsonLower(learner.seat_hits[id] ?? 0, n);
    const recArr = learner.seat_recent[id] ?? [];
    const recency = recArr.length >= 4 ? mean(recArr) : (learner.seat_hits[id] ?? 0) / n;
    const c = seatCalib(n);
    let mult = 1 + c * (1.6 * (wilson - 0.42) + 0.8 * (recency - 0.5));
    mult = clamp(mult, 0.4, 2.2);
    flex[id] = p * mult;
  }
  const frozenSum = Object.values(frozen).reduce((a, b) => a + b, 0);
  const flexRaw = Object.values(flex).reduce((a, b) => a + b, 0);
  const flexTarget = Math.max(0, priorSum - frozenSum);
  const scale = flexRaw > 0 ? flexTarget / flexRaw : 1;
  if (!learner.seat_w) learner.seat_w = {};
  for (const id of Object.keys(prior)) {
    const prev = learner.seat_w[id] ?? prior[id]!;
    const next = frozen[id] != null ? frozen[id]! : round(flex[id]! * scale, 4);
    if (Math.abs(next - prev) >= 0.01) {
      notes.push(`${id} ${prev.toFixed(2)}→${next.toFixed(2)}`);
    }
    learner.seat_w[id] = next;
  }
  return notes.slice(0, 6);
}

export function windowsHuddleDue(learner: Learner): boolean {
  const every = huddleEvery(learner.learn_phase);
  if (learner.graded_windows - (learner.last_huddle_n ?? 0) >= every) return true;
  for (const card of Object.values(learner.skills)) {
    if (card.status !== "SHADOW" || (card.ev_n ?? 0) < 8) continue;
    const live = Object.values(learner.skills).find(
      (s) => s.owner === card.owner && s.status === "LIVE",
    );
    const liveEv = live && live.ev_n >= 8 ? live.ev : 0;
    if (card.ev > liveEv + 1.2) return true;
  }
  return false;
}

export function runHuddle(learner: Learner): { learner: Learner; line: string } {
  const promo: string[] = [];
  const bench: string[] = [];
  const unbench: string[] = [];
  const phase = learner.learn_phase;
  const floor = benchThreshold(phase);
  const promoNeed = promoThreshold(phase);

  for (const card of Object.values(learner.skills)) {
    refreshDerived(card);
    const l20 = recencyRate(card);
    if (card.status === "LIVE") {
      if (
        (card.last20.length >= 8 && l20 < floor) ||
        card.streak_wrong >= 8 ||
        (card.ev_n >= 8 && card.ev < -1.5)
      ) {
        card.status = "BENCH";
        bench.push(`${card.id} L20 ${(l20 * 100).toFixed(0)}% ev ${card.ev.toFixed(0)}¢`);
      }
    } else if (card.status === "BENCH") {
      if (card.last20.length >= 8 && l20 >= 0.55) {
        card.status = "SHADOW";
        unbench.push(`${card.id} L20 ${(l20 * 100).toFixed(0)}%`);
      }
    }
  }

  for (const card of Object.values(learner.skills)) {
    if (card.status !== "SHADOW") continue;
    const counts = skillCounts(learner, card.owner);
    if (counts.live >= 3) continue;
    const parent = parentSeatWilson(learner, card.owner);
    const livePeer = Object.values(learner.skills).find(
      (s) => s.owner === card.owner && s.status === "LIVE",
    );
    const lastPeer = livePeer ? recencyRate(livePeer) : 0;
    const lastMe = recencyRate(card);
    const pocketN = Object.values(card.pocket).reduce((s, p) => s + p.n, 0);
    if (
      card.n >= promoNeed.n &&
      pocketN >= promoNeed.n &&
      card.wilson >= promoNeed.wilson &&
      card.wilson >= parent &&
      (livePeer ? card.brier <= livePeer.brier + 0.02 : true) &&
      lastMe >= lastPeer &&
      (card.ev_n < 8 || card.ev >= -0.4)
    ) {
      card.status = "LIVE";
      promo.push(`${card.id} wilson ${(card.wilson * 100).toFixed(0)}% ev ${card.ev.toFixed(0)}¢`);
    }
  }

  if (!learner.candidate) {
    const shadowRight: { id: string; owner: SeatId; n: number; hits: number }[] = [];
    for (const card of Object.values(learner.skills)) {
      if (card.status !== "SHADOW") continue;
      if (card.n >= 8 && recencyRate(card) >= 0.6 && card.wilson >= 0.5) {
        shadowRight.push({ id: card.id, owner: card.owner, n: card.n, hits: card.hits });
      }
    }
    shadowRight.sort((a, b) => b.hits / Math.max(1, b.n) - a.hits / Math.max(1, a.n));
    const hot = shadowRight[0];
    const misses = learner.chair_recent.filter((x) => x === 0).length;
    if (hot && learner.chair_recent.length >= 8) {
      const parent = learner.skills[hot.id];
      const rule = parent
        ? cloneResidualRule(parent, learner.last_feats ?? {}, learner, learner.last_regime)
        : undefined;
      learner.candidate = {
        id: `${hot.owner}.residual_${Date.now().toString(36).slice(-4)}`,
        owner: hot.owner,
        question: `${hot.id} paper-trading well (${hot.hits}/${hot.n}) — residual with a live DSL rule`,
        fire_when: formatRule(rule),
        vote: "with the paper skill",
        created_at: Date.now(),
        dismissed: false,
        rule,
      };
    } else if (learner.chair_recent.length >= 12 && misses >= 5) {
      const unused = SKILL_SEEDS.find((s) => {
        const c = learner.skills[s.id];
        return c && c.status === "SHADOW" && c.n < 8;
      });
      if (unused) {
        const parent = learner.skills[unused.id];
        const rule = parent
          ? cloneResidualRule(parent, learner.last_feats ?? {}, learner, learner.last_regime)
          : SKILL_RULES[unused.id];
        const cand: CandidateCard = {
          id: `${unused.owner}.residual_${Date.now().toString(36).slice(-4)}`,
          owner: unused.owner,
          question: `unused EYES residual of ${unused.id}: ${unused.eyes}`,
          fire_when: formatRule(rule),
          vote: unused.vote,
          created_at: Date.now(),
          dismissed: false,
          rule,
        };
        learner.candidate = cand;
      }
    }
  }

  learner.learn_phase = phaseOfWindows(learner.graded_windows);
  learner.last_huddle = Date.now();
  learner.last_huddle_n = learner.graded_windows;
  const tuned = retuneThresholds(learner);
  const weights = rebuildSeatWeights(learner);
  const line = `HUDDLE ${new Date().toISOString().slice(11, 16)} · ${learner.learn_phase} n=${learner.graded_windows} · promo ${promo[0] ?? "none"} · bench ${bench[0] ?? "none"} · unbench ${unbench[0] ?? "none"} · candidate ${learner.candidate?.id ?? "none"} · thresh ${tuned[0] ?? "hold"} · w ${weights[0] ?? "hold"}`;
  learner.huddle_log = [line, ...learner.huddle_log].slice(0, 20);
  return { learner, line };
}

export function acceptCandidate(learner: Learner): Learner {
  const c = learner.candidate;
  if (!c) return learner;
  const counts = skillCounts(learner, c.owner);
  if (counts.shadow >= 2) return learner;
  learner.skills[c.id] = {
    id: c.id,
    owner: c.owner,
    question: c.question,
    eyes: c.question,
    fire_when: c.fire_when,
    vote: c.vote,
    conf_formula: "residual",
    invalidate_if: "fails walk-forward",
    status: "SHADOW",
    n: 0,
    hits: 0,
    wait_good: 0,
    wait_miss: 0,
    wilson: 0,
    brier_sum: 0,
    brier_n: 0,
    brier: 0,
    ev_sum: 0,
    ev_n: 0,
    ev: 0,
    streak_wrong: 0,
    last20: [],
    pocket: {},
    rule: c.rule,
  };
  learner.candidate = null;
  return learner;
}

export function chicagoHuddleDue(last: number, now = Date.now()): boolean {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date(now)).map((p) => [p.type, p.value]),
  );
  const hh = Number(parts.hour);
  const mm = Number(parts.minute);
  const inWindow = hh === 3 && mm < 15;
  if (!inWindow) return false;
  const todayKey = `${parts.month}-${parts.day}`;
  const lastFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "2-digit",
    day: "2-digit",
  });
  const lp = Object.fromEntries(
    lastFmt.formatToParts(new Date(last || 0)).map((p) => [p.type, p.value]),
  );
  const lastKey = `${lp.month}-${lp.day}`;
  return lastKey !== todayKey;
}

void wilsonLower;
