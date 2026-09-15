/**
 * The Pit Crew's rulebook — pure functions the server drives once a day.
 *
 * SWEEP (janitor) scores every seat from receipts and raises flags. It fixes
 * nothing. COACH (trainer) turns a seat's knobs — the only writer of those
 * knobs — and only on evidence from windows it did not tune on: a seat's
 * mid-window reads are split into training (older than a week) and
 * validation (the last week); a bar moves only when the training winner is
 * also not worse on validation, at most one small step a week, and a move
 * that proves worse a week later is reverted. Anti-signals get benched for a
 * week. WRENCH (mechanic) is a scheduled session that opens pull requests for
 * real bugs — in the desk's logic and data, and in display truth (every screen
 * must match the record behind it: a booked call shows the side it was booked
 * on, never a decayed lean or the window's result); its log is synced from the
 * repo.
 */
import { takerFeeCentsExact } from "./clock";
import { SPEAK_CONF } from "./math";
import type { SeatKnobs } from "./types";

export const CREW = ["SWEEP", "COACH", "WRENCH"] as const;
/** Seats that never vote a side by design — SWEEP does not flag them DEAD. */
export const NON_VOTERS: readonly string[] = ["ORBIT", "WARDEN", "WIRE"];
/** Reviewed whole-seat retirements. Reads and history remain visible; these seats never vote. */
export const RETIRED_SEATS: Readonly<Record<string, string>> = {
  ODDS: "retired from paper-call votes — cheap YES alone did not earn call authority",
  CHEAP: "retired from paper-call votes — cheap side alone did not earn call authority",
  FADE: "retired from paper-call votes — the tested late-rip fade rule failed its review",
};
export const SWEEP_DAYS = 7;
export const COACH_DAYS = 28;

export const DEFAULT_KNOBS: SeatKnobs = {
  edge_mult: 1,
  speak_offset: 0,
  prev_offset: null,
  benched_until: 0,
  updated_at: 0,
  reason: "",
};

export const KNOBS = {
  offset_min: -6,
  offset_max: 6,
  step: 2,
  edge_min: 0.8,
  edge_max: 1.2,
  min_days_between: 7,
  bench_days: 7,
  train_min: 25,
  valid_min: 8,
  bench_min: 30,
  bench_cents: -8,
  revert_min: 20,
  revert_cents: -3,
} as const;

export type SeatStats = {
  seat: string;
  reads: number;
  spoke: number;
  gagged: number;
  max_conf: number | null;
  avg_conf: number | null;
  spoke_hit_pct: number | null;
  mid_n: number;
  mid_hit_pct: number | null;
  mid_cents: number | null;
  grade_n: number;
};

export type SeatFlag = "MUTE" | "DEADLOCK" | "ANTI" | "DEAD" | "GOLD";

/** SWEEP's flags for one seat over the last week. */
export function sweepFlags(s: SeatStats, bar: number): SeatFlag[] {
  const out: SeatFlag[] = [];
  if (!NON_VOTERS.includes(s.seat) && s.reads === 0 && s.mid_n === 0) out.push("DEAD");
  if (s.reads >= 10 && s.spoke === 0 && s.max_conf != null && s.max_conf < bar) out.push("MUTE");
  if (s.reads >= 10 && s.grade_n === 0) out.push("DEADLOCK");
  if (s.mid_n >= 40 && s.mid_hit_pct != null && s.mid_hit_pct <= 35) out.push("ANTI");
  if (s.mid_n >= 40 && s.mid_hit_pct != null && s.mid_hit_pct >= 65 && (s.mid_cents ?? 0) > 0) out.push("GOLD");
  return out;
}

export function flagNote(flag: SeatFlag, s: SeatStats, bar: number): string {
  switch (flag) {
    case "DEAD":
      return `no directional read in ${SWEEP_DAYS} days`;
    case "MUTE":
      return `${s.reads} reads, best confidence ${s.max_conf} under the ${bar} bar — never heard`;
    case "DEADLOCK":
      return `${s.reads} reads but zero graded — cannot calibrate`;
    case "ANTI":
      return `right ${s.mid_hit_pct}% of ${s.mid_n} mid-window reads — an anti-signal`;
    case "GOLD":
      return `right ${s.mid_hit_pct}% of ${s.mid_n} mid-window reads, ${s.mid_cents?.toFixed(1)}¢ a contract at the ask`;
  }
}

/** One mid-window read of a seat: its raw confidence and side at 7.5 minutes,
 *  the ask of that side at the time, and how the window settled. */
export type MidRead = { t: number; conf: number; lean: "UP" | "DOWN"; ask: number; winner: "UP" | "DOWN" };

/** What one contract bought at the ask on this read made at settlement, after fee. */
export function readCents(r: MidRead): number {
  const fee = takerFeeCentsExact(r.ask);
  return r.lean === r.winner ? 100 - r.ask - fee : -r.ask - fee;
}

export function centsAt(reads: MidRead[], bar: number): { n: number; cents: number; hit_pct: number } {
  let n = 0;
  let sum = 0;
  let hits = 0;
  for (const r of reads) {
    if (r.conf < bar) continue;
    n += 1;
    sum += readCents(r);
    if (r.lean === r.winner) hits += 1;
  }
  return { n, cents: n ? sum / n : 0, hit_pct: n ? (100 * hits) / n : 0 };
}

export type CoachDecision = {
  action: "hold" | "move" | "bench" | "unbench" | "revert";
  knobs: SeatKnobs;
  reason: string;
  evidence: Record<string, unknown>;
};

const DAY = 86_400_000;

/** COACH's decision for one seat. `reads` are that seat's mid-window reads
 *  over the last COACH_DAYS; `now` is the decision time. */
export function coachDecide(reads: MidRead[], knobs: SeatKnobs, now: number): CoachDecision {
  const k = { ...DEFAULT_KNOBS, ...knobs };
  const bar0 = SPEAK_CONF + k.speak_offset;
  const train = reads.filter((r) => r.t < now - SWEEP_DAYS * DAY);
  const valid = reads.filter((r) => r.t >= now - SWEEP_DAYS * DAY);
  const recent = reads.filter((r) => r.t >= now - 14 * DAY);
  const ev: Record<string, unknown> = { bar: bar0, n_train: train.length, n_valid: valid.length };

  if (k.benched_until > 0 && k.benched_until <= now) {
    return {
      action: "unbench",
      knobs: { ...k, benched_until: 0, updated_at: now, reason: "bench expired — back on the floor, same bar" },
      reason: "bench expired",
      evidence: ev,
    };
  }
  if (k.benched_until > now) {
    return { action: "hold", knobs: k, reason: `benched until ${new Date(k.benched_until).toISOString().slice(0, 10)}`, evidence: ev };
  }

  const atBar = centsAt(recent, bar0);
  ev.recent = { n: atBar.n, cents: round1(atBar.cents), hit_pct: Math.round(atBar.hit_pct) };

  // A move made a week ago is judged on the week it did not see.
  if (k.prev_offset != null && k.updated_at > 0 && now - k.updated_at >= KNOBS.min_days_between * DAY) {
    const prevBar = SPEAK_CONF + k.prev_offset;
    const vNew = centsAt(valid, bar0);
    const vOld = centsAt(valid, prevBar);
    ev.revert_check = { new: { bar: bar0, ...vNew }, old: { bar: prevBar, ...vOld } };
    if (vNew.n >= KNOBS.revert_min && vOld.n >= KNOBS.revert_min && vNew.cents < vOld.cents + KNOBS.revert_cents) {
      return {
        action: "revert",
        knobs: {
          ...k,
          speak_offset: k.prev_offset,
          prev_offset: null,
          updated_at: now,
          reason: `reverted to bar ${prevBar}: ${round1(vNew.cents)}¢ vs ${round1(vOld.cents)}¢ on the unseen week`,
        },
        reason: "the move proved worse on unseen windows",
        evidence: ev,
      };
    }
  }

  // Every candidate bar, scored on training reads only.
  const cands: number[] = [];
  for (let d = -6; d <= 4; d += 2) {
    const off = k.speak_offset + d;
    if (off < KNOBS.offset_min || off > KNOBS.offset_max) continue;
    cands.push(SPEAK_CONF + off);
  }
  let best: { bar: number; cents: number; n: number } | null = null;
  const table: Record<string, unknown> = {};
  for (const bar of cands) {
    const c = centsAt(train, bar);
    table[String(bar)] = { n: c.n, cents: round1(c.cents) };
    if (c.n < KNOBS.train_min) continue;
    if (!best || c.cents > best.cents) best = { bar, cents: c.cents, n: c.n };
  }
  ev.train = table;

  // Bench only a seat that loses at its bar AND has no bar that pays on
  // training reads: a bar worth moving to is a better answer than a bench.
  if (
    atBar.n >= KNOBS.bench_min &&
    atBar.cents <= KNOBS.bench_cents &&
    atBar.hit_pct <= 40 &&
    (!best || best.cents <= 0)
  ) {
    return {
      action: "bench",
      knobs: {
        ...k,
        benched_until: now + KNOBS.bench_days * DAY,
        updated_at: now,
        reason: `benched ${KNOBS.bench_days}d: ${round1(atBar.cents)}¢ a contract over ${atBar.n} reads at bar ${bar0}, no bar pays`,
      },
      reason: "anti-signal at its own bar with no better bar",
      evidence: ev,
    };
  }
  if (k.updated_at > 0 && now - k.updated_at < KNOBS.min_days_between * DAY) {
    const days = Math.round((now - k.updated_at) / DAY);
    return { action: "hold", knobs: k, reason: `changed ${days}d ago — one step a week`, evidence: ev };
  }
  if (train.length < KNOBS.train_min) {
    return { action: "hold", knobs: k, reason: `${train.length} training reads, need ${KNOBS.train_min}`, evidence: ev };
  }
  if (!best || best.bar === bar0) {
    return { action: "hold", knobs: k, reason: "current bar is the best on training reads", evidence: ev };
  }
  const vBest = centsAt(valid, best.bar);
  const vCur = centsAt(valid, bar0);
  ev.valid = { best: { bar: best.bar, n: vBest.n, cents: round1(vBest.cents) }, current: { bar: bar0, n: vCur.n, cents: round1(vCur.cents) } };
  if (vBest.n < KNOBS.valid_min || vCur.n < KNOBS.valid_min) {
    return { action: "hold", knobs: k, reason: `bar ${best.bar} wins training but validation is thin`, evidence: ev };
  }
  if (vBest.cents < vCur.cents - 1) {
    return { action: "hold", knobs: k, reason: `bar ${best.bar} wins training but loses the unseen week`, evidence: ev };
  }
  const step = Math.max(-KNOBS.step, Math.min(KNOBS.step, best.bar - bar0));
  const next = k.speak_offset + step;
  return {
    action: "move",
    knobs: {
      ...k,
      speak_offset: next,
      prev_offset: k.speak_offset,
      updated_at: now,
      reason: `bar ${bar0} → ${SPEAK_CONF + next} (toward ${best.bar}): ${round1(best.cents)}¢ vs ${round1(centsAt(train, bar0).cents)}¢ a contract on ${best.n} training reads, not worse on the unseen week`,
    },
    reason: "a better bar on training reads that held up on unseen windows",
    evidence: ev,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
