/**
 * QUIET_CALL_LEDGER_V1 — every seat's mandatory directional "quiet call".
 *
 * AUTHORITY: NONE. Paper-only, research-only, hidden from every public surface.
 * Spec: docs/QUIET_CALL_LEDGER_V1.md (rev 3, owner-approved 2026-10-01).
 *
 * WHAT IT IS. Once per window, at the first usable tick with under 12 minutes
 * left, each of the 20 seats (SEAT_IDS minus WARDEN) commits one side, UP or
 * DOWN, from its OWN read — before the whisper bar, COACH bench, retirement gag,
 * STALE haircut or Chair mute. The call is graded at settlement inside
 * gradeWindow, with centsOf on the CAPTURE tick's asks, and accumulated per seat
 * with the SkillCard stat machinery (creditDirectional / refreshDerived).
 *
 * WHAT IT IS NOT. Never a vote, weight, gate, threshold, status or Chair input.
 * Nothing here is written onto Learner, Vote, huddle_log, settle_tape or /frame:
 * the QuietBook lives on the server engine and in its own desk_state key, and
 * the review surface is an admin-header-only research route.
 *
 * SOURCE, in strict order (judged seats):
 *   RAW   vote.raw_lean UP/DOWN (raw_conf, else confidence)
 *   PAPER strongest directional card on vote.paper (lexical id tiebreak)
 *   TILT  the seat's own reader direction (quietTilt), conf 50
 *   NONE  tagged deterministic coin (fnv1a), conf 50
 * ORBIT is the sole CONTROL seat: always the tagged coin, never judged.
 *
 * Pure: no clock, database, network or environment reads except
 * `quietCallEnabled(env)`. The learner is only ever READ (CLOCK's prior pocket,
 * rethink preconditions); the book passed in is the only thing mutated.
 */
import { CLOSED_DIRECTIONAL_CARDS } from "./council-authority";
import { PENDING_CAP } from "./reliability";
import { RETIRED_SEATS } from "./crew";
import { centsOf, normCdf, readClock } from "./clock";
import { readCarry, readCascade, readChain, readVolt } from "./derivs";
import { readWire } from "./context";
import { wilsonLower } from "./math";
import { readWick } from "./patterns";
import { readDrift, readStreak } from "./structure";
import { readPulse, readTape, readVel, readWhale } from "./tape";
import { SEAT_IDS, type Lean, type Learner, type SeatId, type SkillStats, type Snapshot, type Vote } from "./types";

export const QUIET_CALL_VERSION = "QUIET_CALL_V1" as const;

/**
 * The quiet-call seats: SEAT_IDS minus WARDEN (non-directional veto), in SEAT_IDS
 * order. SEAT_IDS holds 21 ids INCLUDING WARDEN, so this is 20 seats — 19 judged
 * plus the ORBIT control. (Spec rev 3 said "21"; erratum ER-1 in the PR: the
 * design intent "every seat but WARDEN" is unchanged, only the count.)
 */
export const QUIET_SEATS: readonly SeatId[] = SEAT_IDS.filter((s) => s !== "WARDEN");
/** Sole control (rev 3): sideless by construction; a tagged coin every window. */
export const QUIET_CONTROL_SEATS: readonly SeatId[] = ["ORBIT"] as SeatId[];
/** The 19 judged seats — the only seats flagged or counted by the kill tests. */
export const QUIET_JUDGED_SEATS: readonly SeatId[] = QUIET_SEATS.filter((s) => !QUIET_CONTROL_SEATS.includes(s));

/** Capture opens with the Chair's entry window (chair.ts `mins_left < 12`) … */
export const QUIET_CAPTURE_OPEN_MIN = 12;
/** … and is MISSED if no usable tick arrives before the entry window closes (`> 2.2`). */
export const QUIET_CAPTURE_CLOSE_MIN = 2.2;
export const QUIET_WARMUP = 200;
export const QUIET_KILL_AT = 500;
export const QUIET_ROLL = 50;
export const QUIET_FLAG_CAP = 3;
export const QUIET_CAPTURE_CAP = PENDING_CAP + 1; // Pending settlements plus the active window.
export const QUIET_GRADED_KEY_CAP = 256;
export const QUIET_REVIEW_LOG_CAP = 40;
const B_STREAK = 3;
const CLEAR_STREAK = 2;
const Z95 = 1.959963984540054;
const HOLM_ALPHA = 0.05;

export type QuietSource = "RAW" | "PAPER" | "TILT" | "NONE" | "CONTROL";
export type AdmittedState = "SPOKE" | "WAIT" | "SIT" | "FORCED_SIT" | "RETIRED" | "MUTED" | "FEED_DOWN";
export type Side = "UP" | "DOWN";

export type QuietCall = {
  seat: SeatId;
  control: boolean;
  side: Side;
  /** As read: 0–92 scale for RAW/PAPER; 50 for TILT/NONE/CONTROL. */
  conf_raw: number;
  /** clamp(conf_raw, 50, 99) / 100 — the probability Brier grades. */
  p: number;
  source: QuietSource;
  paper_card_id: string | null;
  closed_card: boolean;
  admitted_lean: Lean;
  admitted_state: AdmittedState;
  skill_used: string;
};

export type QuietCapture = {
  v: typeof QUIET_CALL_VERSION;
  ticker: string;
  close_time: number;
  as_of: number;
  mins_left: number;
  regime_key: string;
  /** Exactly the inputs centsOf reads (pinned by test). */
  yes_ask: number;
  no_ask: number;
  yes_mid: number;
  build_sha: string;
  calls: QuietCall[];
};

export type RollEntry = { hit: 0 | 1; cents: number; coin: number; p: number; source: QuietSource };

export type QuietRecord = {
  seat: SeatId;
  all: SkillStats;
  bySource: Record<QuietSource, SkillStats>;
  byAdmitted: { SPOKE: SkillStats; SILENT: SkillStats };
  coin_sum: number;
  pocket_ev: Record<string, number>;
  roll: RollEntry[];
};

export type QuietFlag = {
  state: "CLEAR" | "FLAGGED";
  since: number | null;
  reason: "A" | "B" | null;
  b_streak: number;
  clean_streak: number;
  wilson_lb: number | null;
  wilson_ub: number | null;
  l50_hit: number | null;
  l50_ev_vs_coin: number | null;
  rethink_eligible: boolean | null;
};

export type KillVerdict = {
  verdict: "RETIRE" | "CONTINUE" | "EXTEND";
  at_windows: number;
  evaluated_at?: number;
  next_check_at?: number | null;
  k0?: unknown;
  k1?: unknown;
  k2?: unknown;
};

export type QuietBook = {
  v: typeof QUIET_CALL_VERSION;
  /** 0 until the flag is first seen on; then the activation time. */
  activated_at: number;
  /** Captures only begin for windows closing strictly after this (next window boundary). */
  armed_after_close: number;
  graded_windows: number;
  missed_windows: number;
  skipped: { chalk: number; uncountable: number; identity: number };
  graded_keys: string[];
  seats: Record<string, QuietRecord>;
  flags: Record<string, QuietFlag>;
  review_log: string[];
  kill: KillVerdict | null;
};

export type QuietGradeRow = { seat: SeatId; finish: Side; hit: 0 | 1; cents: number; coin_cents: number };
export type QuietGradeResult = {
  status: "GRADED" | "SKIPPED_CHALK" | "SKIPPED_IDENTITY" | "DUPLICATE" | "NO_CAPTURE";
  rows: QuietGradeRow[];
};
/** What gradeWindow receives. `result` is written back for the async DB writer. */
export type QuietGradeInput = { book: QuietBook; capture: QuietCapture | null; result?: QuietGradeResult };
export type CreditFn = (card: SkillStats, hit: number, confidence: number, pocketKey: string, cents: number) => void;

// ---------------------------------------------------------------- switch

/** Ships dark. Same convention as RECOVERY_PILOT_CALLS_ENABLED. */
export function quietCallEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.QUIET_CALL_V1_ENABLED === "true";
}

// ---------------------------------------------------------------- selection

/** FNV-1a 32-bit. Deterministic, dependency-free. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function quietCoin(seat: string, ticker: string, closeTime: number): Side {
  return fnv1a(`${seat}|${ticker}|${closeTime}`) & 1 ? "UP" : "DOWN";
}

const dir = (l: unknown): Side | null => (l === "UP" || l === "DOWN" ? l : null);
const sign = (x: number): Side | null => (Number.isFinite(x) && x > 0 ? "UP" : Number.isFinite(x) && x < 0 ? "DOWN" : null);

/**
 * The seat's own reader direction, used only when the seat has no RAW or PAPER
 * read. Each branch reads the SAME reader the seat's bot calls (bots.ts); owner
 * rulings 2026-10-01 fix the fade seats and the reader-lean seats. Any reader
 * failure or flat read is `null` (→ NONE); it can never throw into the tick.
 */
export function quietTilt(seat: SeatId, snap: Snapshot, learner: Learner): Side | null {
  try {
    switch (seat) {
      case "WICK": {
        const c1 = snap.candles_1m.filter((c) => c.closed);
        if (!c1.length) return null;
        const read5 = readWick(snap.candles_5m);
        return dir(readWick(c1, read5.structure.trend).structure.trend);
      }
      case "DRIFT": return dir(readDrift(snap).lean);
      case "STREAK": return dir(readStreak(snap).side);
      // EXHAUST fades the 1h run: every directional EXHAUST card votes "fade the 1h".
      case "EXHAUST": return snap.ret1h > 0 ? "DOWN" : snap.ret1h < 0 ? "UP" : null;
      case "PULSE": return dir(readPulse(snap).lean);
      case "TAPE": return sign(readTape(snap).imb);
      case "WHALE": return dir(readWhale(snap).lean);
      case "VEL": return sign(readVel(snap).lead);
      // CARRY is conditional: readCarry already fades extremes and follows moderate carry.
      case "CARRY": return dir(readCarry(snap).lean);
      case "CHAIN": return dir(readChain(snap).lean);
      case "CASCADE": return dir(readCascade(snap).lean);
      case "VOLT": return dir(readVolt(snap).lean);
      // ODDS / CHEAP lean toward the cheaper side; exactly 50¢ (or no quote) is no read.
      case "ODDS":
      case "CHEAP": {
        const y = snap.yes_ask;
        if (!(Number.isFinite(y) && y > 0 && y < 100)) return null;
        return y < 50 ? "UP" : y > 50 ? "DOWN" : null;
      }
      case "STRIKE":
      case "INDEX": return dir(readClock(snap).itm);
      // FADE fades the 60s YES move, with fadeBot's own d60 (bots.ts fadeBot).
      case "FADE": {
        const path = snap.yes_mid_path ?? [];
        const d60 = path.length >= 6 ? path[path.length - 1]! - path[path.length - 6]! : 0;
        return d60 > 0 ? "DOWN" : d60 < 0 ? "UP" : null;
      }
      case "CLOCK": {
        const card = learner.skills["CLOCK.session_prior"];
        const ck = snap.clock_key || `${snap.session}_${new Date(snap.as_of).getUTCDay()}`;
        const p = card?.pocket?.[ck];
        if (!p || !(p.n > 0)) return null;
        const rate = p.hits / p.n;
        return rate > 0.5 ? "UP" : rate < 0.5 ? "DOWN" : null;
      }
      // WIRE fades F&G extremes (readWire lean); no tilt otherwise.
      case "WIRE": return dir(readWire(snap).lean);
      default: return null;
    }
  } catch {
    return null;
  }
}

export function admittedState(seat: SeatId, vote: Vote | undefined, mutes: readonly string[]): AdmittedState {
  if (!vote) return "SIT";
  if (vote.health === "DOWN") return "FEED_DOWN";
  if (RETIRED_SEATS[seat]) return "RETIRED";
  if (mutes.includes(seat)) return "MUTED";
  if (vote.forced_sit) return "FORCED_SIT";
  if (vote.skill_used === "SIT") return "SIT";
  if (vote.lean !== "UP" && vote.lean !== "DOWN") return "WAIT";
  return "SPOKE";
}

const pOf = (conf: number) => Math.min(99, Math.max(50, Number.isFinite(conf) ? conf : 50)) / 100;

export function selectQuietCall(
  seat: SeatId,
  vote: Vote | undefined,
  snap: Snapshot,
  learner: Learner,
  mutes: readonly string[],
): QuietCall {
  const control = QUIET_CONTROL_SEATS.includes(seat);
  const base = {
    seat,
    control,
    paper_card_id: null as string | null,
    closed_card: false,
    admitted_lean: (vote?.lean ?? "WAIT") as Lean,
    admitted_state: admittedState(seat, vote, mutes),
    skill_used: vote?.skill_used ?? "SIT",
  };
  const coin = (source: QuietSource): QuietCall => ({
    ...base, side: quietCoin(seat, snap.ticker, snap.close_time), conf_raw: 50, p: 0.5, source,
  });
  if (control) return coin("CONTROL");
  const raw = dir(vote?.raw_lean);
  if (raw && vote) {
    const conf = vote.raw_conf ?? vote.confidence;
    return { ...base, side: raw, conf_raw: conf, p: pOf(conf), source: "RAW" };
  }
  const papers = (vote?.paper ?? [])
    .filter((p) => p.lean === "UP" || p.lean === "DOWN")
    .sort((a, b) => b.confidence - a.confidence || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const top = papers[0];
  if (top) {
    return {
      ...base, side: top.lean as Side, conf_raw: top.confidence, p: pOf(top.confidence), source: "PAPER",
      paper_card_id: top.id, closed_card: CLOSED_DIRECTIONAL_CARDS.has(top.id),
    };
  }
  const tilt = quietTilt(seat, snap, learner);
  if (tilt) return { ...base, side: tilt, conf_raw: 50, p: 0.5, source: "TILT" };
  return coin("NONE");
}

// ---------------------------------------------------------------- capture

/** The same predicate as server-engine `gradeableBook`, plus the entry-window clock. */
export function quietCaptureEligible(snap: Snapshot): boolean {
  if (!(snap.as_of <= snap.close_time)) return false;
  if (snap.chalk || snap.leftover_cents > 12) return false;
  if (snap.health.spot === "DOWN" && snap.health.kalshi === "DOWN") return false;
  return snap.mins_left < QUIET_CAPTURE_OPEN_MIN && snap.mins_left > QUIET_CAPTURE_CLOSE_MIN;
}

export function buildCapture(
  snap: Snapshot,
  votes: readonly Vote[],
  learner: Learner,
  mutes: readonly string[],
  buildSha: string,
): QuietCapture {
  return {
    v: QUIET_CALL_VERSION,
    ticker: snap.ticker,
    close_time: snap.close_time,
    as_of: snap.as_of,
    mins_left: snap.mins_left,
    regime_key: snap.regime_key,
    yes_ask: snap.yes_ask,
    no_ask: snap.no_ask,
    yes_mid: snap.yes_mid,
    build_sha: buildSha,
    calls: QUIET_SEATS.map((seat) => selectQuietCall(seat, votes.find((v) => v.seat === seat), snap, learner, mutes)),
  };
}

/** The minimal Snapshot centsOf needs. A test fails if centsOf reads anything else. */
export function captureSnap(c: Pick<QuietCapture, "yes_ask" | "no_ask" | "yes_mid">): Snapshot {
  return { yes_ask: c.yes_ask, no_ask: c.no_ask, yes_mid: c.yes_mid } as Snapshot;
}

/** Arms the ledger at activation: capture starts with the NEXT window. Returns true once armed. */
export function armQuiet(book: QuietBook, snap: Pick<Snapshot, "close_time">, now: number): boolean {
  if (book.activated_at > 0) return true;
  book.activated_at = now;
  book.armed_after_close = snap.close_time;
  return true;
}

export function quietWindowArmed(book: QuietBook, closeTime: number): boolean {
  return book.activated_at > 0 && closeTime > book.armed_after_close;
}

// ---------------------------------------------------------------- book

export function freshStats(): SkillStats {
  return { n: 0, hits: 0, wilson: 0, brier_sum: 0, brier_n: 0, brier: 0, ev_sum: 0, ev_n: 0, ev: 0, streak_wrong: 0, last20: [], pocket: {} };
}

function freshRecord(seat: SeatId): QuietRecord {
  return {
    seat,
    all: freshStats(),
    bySource: { RAW: freshStats(), PAPER: freshStats(), TILT: freshStats(), NONE: freshStats(), CONTROL: freshStats() },
    byAdmitted: { SPOKE: freshStats(), SILENT: freshStats() },
    coin_sum: 0,
    pocket_ev: {},
    roll: [],
  };
}

function freshFlag(): QuietFlag {
  return {
    state: "CLEAR", since: null, reason: null, b_streak: 0, clean_streak: 0,
    wilson_lb: null, wilson_ub: null, l50_hit: null, l50_ev_vs_coin: null, rethink_eligible: null,
  };
}

export function freshQuietBook(activatedAt = 0): QuietBook {
  const seats: Record<string, QuietRecord> = {};
  for (const s of QUIET_SEATS) seats[s] = freshRecord(s);
  return {
    v: QUIET_CALL_VERSION,
    activated_at: activatedAt,
    armed_after_close: 0,
    graded_windows: 0,
    missed_windows: 0,
    skipped: { chalk: 0, uncountable: 0, identity: 0 },
    graded_keys: [],
    seats,
    flags: {},
    review_log: [],
    kill: null,
  };
}

const keyOf = (ticker: string, close: number) => `${ticker}:${close}`;

function creditCall(
  book: QuietBook,
  c: Pick<QuietCall, "seat" | "p" | "source" | "admitted_state">,
  regime: string,
  hit: 0 | 1,
  cents: number,
  coin: number,
  credit: CreditFn,
) {
  const rec = (book.seats[c.seat] ??= freshRecord(c.seat));
  const conf = c.p * 100;
  credit(rec.all, hit, conf, regime, cents);
  credit((rec.bySource[c.source] ??= freshStats()), hit, conf, regime, cents);
  credit(rec.byAdmitted[c.admitted_state === "SPOKE" ? "SPOKE" : "SILENT"], hit, conf, regime, cents);
  rec.coin_sum += coin;
  rec.pocket_ev[regime] = (rec.pocket_ev[regime] ?? 0) + cents;
  rec.roll = [...rec.roll, { hit, cents, coin, p: c.p, source: c.source }].slice(-QUIET_ROLL);
}

/**
 * Called from inside gradeWindow. GRADE credits every call against the official
 * finish using centsOf on the CAPTURE asks; SKIPPED_CHALK marks the window (the
 * learner skipped it too) and credits nothing. Idempotent per window.
 */
export function gradeQuiet(
  input: QuietGradeInput,
  snap: Pick<Snapshot, "ticker" | "close_time">,
  finish: Side,
  mode: "GRADE" | "SKIPPED_CHALK",
  credit: CreditFn,
): QuietGradeResult {
  const { book, capture } = input;
  const done = (r: QuietGradeResult) => { input.result = r; return r; };
  if (!capture) return done({ status: "NO_CAPTURE", rows: [] });
  if (capture.ticker !== snap.ticker || capture.close_time !== snap.close_time) {
    book.skipped.identity += 1;
    return done({ status: "SKIPPED_IDENTITY", rows: [] });
  }
  const key = keyOf(capture.ticker, capture.close_time);
  if (book.graded_keys.includes(key)) return done({ status: "DUPLICATE", rows: [] });
  book.graded_keys = [...book.graded_keys, key].slice(-QUIET_GRADED_KEY_CAP);
  if (mode === "SKIPPED_CHALK") {
    book.skipped.chalk += 1;
    return done({ status: "SKIPPED_CHALK", rows: [] });
  }
  const cs = captureSnap(capture);
  const coin = (centsOf("UP", cs, finish) + centsOf("DOWN", cs, finish)) / 2;
  const rows: QuietGradeRow[] = [];
  for (const c of capture.calls) {
    const hit: 0 | 1 = c.side === finish ? 1 : 0;
    const cents = centsOf(c.side, cs, finish);
    creditCall(book, c, capture.regime_key, hit, cents, coin, credit);
    rows.push({ seat: c.seat, finish, hit, cents, coin_cents: coin });
  }
  book.graded_windows += 1;
  return done({ status: "GRADED", rows });
}

export function markQuietUncountable(book: QuietBook): void {
  book.skipped.uncountable += 1;
}

export function noteQuietMissed(book: QuietBook, ticker?: string, close?: number): void {
  if (ticker !== undefined && close !== undefined) {
    const key = keyOf(ticker, close);
    if (book.graded_keys.includes(key)) return;
    book.graded_keys = [...book.graded_keys, key].slice(-QUIET_GRADED_KEY_CAP);
  }
  book.missed_windows += 1;
}

/** An engine identity fault is retired once, without teaching or outcome credit. */
export function markQuietIdentity(book:QuietBook,ticker:string,close:number):boolean {
  const key=keyOf(ticker,close);
  if(book.graded_keys.includes(key)) return false;
  book.graded_keys=[...book.graded_keys,key].slice(-QUIET_GRADED_KEY_CAP);
  book.skipped.identity+=1;
  return true;
}

// ---------------------------------------------------------------- statistics

export function wilsonUpper(hits: number, n: number, z = Z95): number {
  if (n <= 0) return 1;
  const p = hits / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return Math.min(1, Math.max(0, (center + margin) / denom));
}

/** Two-sided p-value of hits/n against 0.5 (normal approximation). */
export function pTwoSided(hits: number, n: number): number {
  if (n <= 0) return 1;
  const z = Math.abs(hits - n / 2) / Math.sqrt(n / 4);
  return Math.min(1, 2 * (1 - normCdf(z)));
}

/** Holm at family α: "any rejection" ⇔ the smallest p clears α / k. */
export function holmAnyReject(ps: readonly number[], alpha = HOLM_ALPHA): boolean {
  const k = ps.length;
  if (!k) return false;
  return Math.min(...ps) <= alpha / k;
}

function lnGamma(z: number): number {
  const g = 7;
  const c = [0.9999999999998099, 676.5203681218851, -1259.1392167224028, 771.3234287776531,
    -176.61503916999186, 12.507343278686905, -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  z -= 1;
  let x = c[0]!;
  for (let i = 1; i < g + 2; i++) x += c[i]! / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Regularized upper incomplete gamma Q(a, x). */
function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) {
    let sum = 1 / a;
    let del = sum;
    let ap = a;
    for (let n = 0; n < 500; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
    }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
  }
  let b = x + 1 - a;
  let c = 1 / 1e-300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}

export function chi2Survival(x: number, df: number): number {
  if (df <= 0) return 1;
  return gammaQ(df / 2, x / 2);
}

/** 2×k homogeneity of hit rates across seats. */
export function chi2Homogeneity(groups: readonly { n: number; hits: number }[]): { stat: number; df: number; p: number } {
  const g = groups.filter((x) => x.n > 0);
  const N = g.reduce((s, x) => s + x.n, 0);
  const H = g.reduce((s, x) => s + x.hits, 0);
  const df = Math.max(0, g.length - 1);
  if (!N || df === 0) return { stat: 0, df, p: 1 };
  const pb = H / N;
  if (pb <= 0 || pb >= 1) return { stat: 0, df, p: 1 };
  const stat = g.reduce((s, x) => s + (x.hits - x.n * pb) ** 2 / (x.n * pb * (1 - pb)), 0);
  return { stat, df, p: chi2Survival(stat, df) };
}

/** Student-t quantile via Cornish–Fisher (accurate to ~1e-3 for df ≥ 10). */
export function tQuantile(prob: number, df: number): number {
  const z = prob === 0.95 ? 1.6448536269514722 : prob === 0.975 ? Z95 : NaN;
  if (!Number.isFinite(z)) throw new Error(`tQuantile supports 0.95 / 0.975, got ${prob}`);
  if (!(df > 0)) return Infinity;
  const z3 = z ** 3, z5 = z ** 5, z7 = z ** 7;
  return z + (z3 + z) / (4 * df) + (5 * z5 + 16 * z3 + 3 * z) / (96 * df ** 2) + (3 * z7 + 19 * z5 + 17 * z3 - 15 * z) / (384 * df ** 3);
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

// ---------------------------------------------------------------- leaderboard

type Horizon = {
  n: number; hits: number; hit: number | null; wilson_lb: number; wilson_ub: number;
  brier: number | null; bss: number | null; ev_per_call: number | null; ev_vs_coin_per_call: number | null;
  rank_wilson: number | null; rank_ev: number | null; would_rank_wilson: number | null; would_rank_ev: number | null;
};

function horizonOfRoll(roll: readonly RollEntry[]): Horizon {
  const n = roll.length;
  const hits = roll.reduce((s, r) => s + r.hit, 0);
  const brier = n ? roll.reduce((s, r) => s + (r.p - r.hit) ** 2, 0) / n : null;
  const ev = n ? roll.reduce((s, r) => s + r.cents, 0) / n : null;
  const evc = n ? roll.reduce((s, r) => s + (r.cents - r.coin), 0) / n : null;
  return horizon(n, hits, brier, ev, evc);
}

function horizon(n: number, hits: number, brier: number | null, ev: number | null, evc: number | null): Horizon {
  return {
    n, hits, hit: n ? hits / n : null,
    wilson_lb: n ? wilsonLower(hits, n) : 0, wilson_ub: n ? wilsonUpper(hits, n) : 1,
    brier, bss: brier == null ? null : 1 - brier / 0.25, ev_per_call: ev, ev_vs_coin_per_call: evc,
    rank_wilson: null, rank_ev: null, would_rank_wilson: null, would_rank_ev: null,
  };
}

function statsOf(stats: SkillStats[]): { n: number; hits: number } {
  return stats.reduce((a, s) => ({ n: a.n + s.n, hits: a.hits + s.hits }), { n: 0, hits: 0 });
}

const cmpWilson = (a: { seat: string; h: Horizon }, b: { seat: string; h: Horizon }) =>
  (b.h.n > 0 ? 1 : 0) - (a.h.n > 0 ? 1 : 0) ||
  b.h.wilson_lb - a.h.wilson_lb ||
  (b.h.ev_per_call ?? -Infinity) - (a.h.ev_per_call ?? -Infinity) ||
  (a.seat < b.seat ? -1 : a.seat > b.seat ? 1 : 0);
const cmpEv = (a: { seat: string; h: Horizon }, b: { seat: string; h: Horizon }) =>
  (b.h.n > 0 ? 1 : 0) - (a.h.n > 0 ? 1 : 0) ||
  (b.h.ev_vs_coin_per_call ?? -Infinity) - (a.h.ev_vs_coin_per_call ?? -Infinity) ||
  b.h.wilson_lb - a.h.wilson_lb ||
  (a.seat < b.seat ? -1 : a.seat > b.seat ? 1 : 0);

function rankInto(rows: { seat: string; control: boolean; h: Horizon }[]) {
  const judged = rows.filter((r) => !r.control);
  [...judged].sort(cmpWilson).forEach((r, i) => { r.h.rank_wilson = i + 1; });
  [...judged].sort(cmpEv).forEach((r, i) => { r.h.rank_ev = i + 1; });
  for (const c of rows.filter((r) => r.control)) {
    c.h.would_rank_wilson = 1 + judged.filter((j) => cmpWilson(j, c) < 0).length;
    c.h.would_rank_ev = 1 + judged.filter((j) => cmpEv(j, c) < 0).length;
  }
}

export type QuietBoardRow = {
  seat: SeatId;
  control: boolean;
  warming: boolean;
  L20: Horizon;
  L50: Horizon;
  ALL: Horizon & {
    coverage: Record<QuietSource, number>;
    ex_none: { n: number; hits: number; hit: number | null; wilson_lb: number };
    spoke: { n: number; hits: number; hit: number | null };
    silent: { n: number; hits: number; hit: number | null };
    pockets: Record<string, { n: number; hit: number | null; ev: number | null }>;
  };
  flag: QuietFlag | null;
};

export type QuietBoard = {
  v: typeof QUIET_CALL_VERSION;
  trust: "WARMING" | "TRUSTWORTHY";
  activated_at: number;
  graded_windows: number;
  missed_windows: number;
  skipped: QuietBook["skipped"];
  luck_band: Record<"L20" | "L50" | "ALL", { n: number; lo: number; hi: number }>;
  seats: QuietBoardRow[];
  kill: KillVerdict | null;
  review_log: string[];
};

export function quietBoard(book: QuietBook): QuietBoard {
  const rows: QuietBoardRow[] = QUIET_SEATS.map((seat) => {
    const rec = book.seats[seat] ?? freshRecord(seat);
    const a = rec.all;
    const allH = horizon(a.n, a.hits, a.brier_n ? a.brier_sum / a.brier_n : null,
      a.ev_n ? a.ev_sum / a.ev_n : null, a.ev_n ? (a.ev_sum - rec.coin_sum) / a.ev_n : null);
    const sources = ["RAW", "PAPER", "TILT", "NONE", "CONTROL"] as QuietSource[];
    const coverage = Object.fromEntries(sources.map((s) => [s, a.n ? (rec.bySource[s]?.n ?? 0) / a.n : 0])) as Record<QuietSource, number>;
    const exNone = statsOf(sources.filter((s) => s !== "NONE" && s !== "CONTROL").map((s) => rec.bySource[s] ?? freshStats()));
    const pockets: Record<string, { n: number; hit: number | null; ev: number | null }> = {};
    for (const [k, p] of Object.entries(a.pocket)) pockets[k] = { n: p.n, hit: p.n ? p.hits / p.n : null, ev: p.n ? (rec.pocket_ev[k] ?? 0) / p.n : null };
    const sp = rec.byAdmitted.SPOKE, si = rec.byAdmitted.SILENT;
    return {
      seat,
      control: QUIET_CONTROL_SEATS.includes(seat),
      warming: a.n < QUIET_WARMUP,
      L20: horizonOfRoll(rec.roll.slice(-20)),
      L50: horizonOfRoll(rec.roll.slice(-QUIET_ROLL)),
      ALL: {
        ...allH,
        coverage,
        ex_none: { ...exNone, hit: exNone.n ? exNone.hits / exNone.n : null, wilson_lb: exNone.n ? wilsonLower(exNone.hits, exNone.n) : 0 },
        spoke: { n: sp.n, hits: sp.hits, hit: sp.n ? sp.hits / sp.n : null },
        silent: { n: si.n, hits: si.hits, hit: si.n ? si.hits / si.n : null },
        pockets,
      },
      flag: book.flags[seat] ?? null,
    };
  });
  for (const h of ["L20", "L50", "ALL"] as const) rankInto(rows.map((r) => ({ seat: r.seat, control: r.control, h: r[h] })));
  const band = (n: number) => ({ n, lo: n ? round3(wilsonLower(n / 2, n)) : 0, hi: n ? round3(wilsonUpper(n / 2, n)) : 1 });
  const g = book.graded_windows;
  return {
    v: QUIET_CALL_VERSION,
    trust: g >= QUIET_WARMUP ? "TRUSTWORTHY" : "WARMING",
    activated_at: book.activated_at,
    graded_windows: g,
    missed_windows: book.missed_windows,
    skipped: { ...book.skipped },
    luck_band: { L20: band(Math.min(20, g)), L50: band(Math.min(QUIET_ROLL, g)), ALL: band(g) },
    seats: rows,
    kill: book.kill,
    review_log: [...book.review_log],
  };
}

// ---------------------------------------------------------------- huddle review

function rethinkEligible(learner: Learner, seat: SeatId): boolean {
  const mine = Object.values(learner.skills).filter((s) => s.owner === seat);
  return mine.length > 0 && mine.filter((s) => s.id.includes(".rethink_")).length < 2;
}

function killDue(book: QuietBook): boolean {
  const k = book.kill;
  if (k && k.verdict !== "EXTEND") return false;
  const at = k?.next_check_at ?? QUIET_KILL_AT;
  return book.graded_windows >= at;
}

/**
 * Diagnose only. Runs right after runHuddle at its three call sites; it reads the
 * learner (rethink preconditions) and writes only book.flags / book.review_log.
 * Treatment stays with existing bench/promote/rethink machinery and the owner.
 */
export function quietHuddleReview(book: QuietBook, learner: Learner, now: number): { line: string; flagged: SeatId[]; cleared: SeatId[]; kill_due: boolean } {
  const eligible = book.graded_windows >= QUIET_WARMUP
    ? QUIET_JUDGED_SEATS.filter((s) => {
      const r = book.seats[s];
      return r && r.all.n >= QUIET_WARMUP && r.roll.length >= QUIET_ROLL;
    })
    : [];
  const k = eligible.length;
  const ranked = eligible
    .map((seat) => ({ seat, lb: wilsonLower(book.seats[seat]!.all.hits, book.seats[seat]!.all.n), ev: book.seats[seat]!.all.ev }))
    .sort((a, b) => b.lb - a.lb || b.ev - a.ev || (a.seat < b.seat ? -1 : 1));
  const rankOf = new Map(ranked.map((r, i) => [r.seat, i + 1]));
  const cut = Math.ceil(0.75 * k);
  const trailing: { seat: SeatId; reason: "A" | "B"; lb: number }[] = [];
  const flagged: SeatId[] = [];
  const cleared: SeatId[] = [];
  const touched = new Set<SeatId>();
  for (const seat of eligible) {
    const rec = book.seats[seat]!;
    const f = (book.flags[seat] ??= freshFlag());
    touched.add(seat);
    const lb = wilsonLower(rec.all.hits, rec.all.n);
    const ub = wilsonUpper(rec.all.hits, rec.all.n);
    const l50 = rec.roll.slice(-QUIET_ROLL);
    const l50Hit = l50.reduce((s, r) => s + r.hit, 0) / l50.length;
    const l50Evc = l50.reduce((s, r) => s + (r.cents - r.coin), 0) / l50.length;
    const condA = ub < 0.5;
    const condB = (rankOf.get(seat) ?? 0) > cut && l50Hit < 0.5 && l50Evc < 0;
    f.b_streak = condB ? f.b_streak + 1 : 0;
    Object.assign(f, { wilson_lb: lb, wilson_ub: ub, l50_hit: l50Hit, l50_ev_vs_coin: l50Evc, rethink_eligible: rethinkEligible(learner, seat) });
    const isTrailing = condA || f.b_streak >= B_STREAK;
    if (f.state === "FLAGGED") {
      if (condA || condB) f.clean_streak = 0;
      else {
        f.clean_streak += 1;
        if (f.clean_streak >= CLEAR_STREAK) {
          Object.assign(f, { state: "CLEAR", since: null, reason: null, clean_streak: 0 });
          cleared.push(seat);
        }
      }
    } else if (isTrailing) {
      trailing.push({ seat, reason: condA ? "A" : "B", lb });
    }
  }
  // Seats that fell out of eligibility keep their flag state but reset streak evidence.
  for (const [seat, f] of Object.entries(book.flags)) if (!touched.has(seat as SeatId)) f.b_streak = 0;
  trailing.sort((a, b) => a.lb - b.lb || (a.seat < b.seat ? -1 : 1));
  for (const t of trailing.slice(0, QUIET_FLAG_CAP)) {
    Object.assign(book.flags[t.seat]!, { state: "FLAGGED", since: now, reason: t.reason, clean_streak: 0 });
    flagged.push(t.seat);
  }
  const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);
  const fmt = (s: SeatId) => {
    const f = book.flags[s]!;
    const evc = f.l50_ev_vs_coin ?? 0;
    return `${s}(${f.reason} wlb ${(f.wilson_lb ?? 0).toFixed(2).replace(/^0/, "")} L50 ${pct(f.l50_hit)} ${evc >= 0 ? "+" : "−"}${Math.abs(evc).toFixed(1)}¢${f.reason === "A" ? " INVERT?" : ""})`;
  };
  const stamp = new Date(now).toISOString().slice(0, 16).replace("T", " ");
  const line = `QUIET ${stamp} · n=${book.graded_windows} · FLAG ${flagged.length ? flagged.map(fmt).join(" ") : "none"} · CLEAR ${cleared.length ? cleared.join(" ") : "none"}`;
  book.review_log = [line, ...book.review_log].slice(0, QUIET_REVIEW_LOG_CAP);
  return { line, flagged, cleared, kill_due: killDue(book) };
}

/** Writes a kill verdict. RETIRE / CONTINUE are final and never overwritten; EXTEND re-arms at +500. */
export function recordKill(book: QuietBook, v: KillVerdict): void {
  if (book.kill && book.kill.verdict !== "EXTEND") return;
  book.kill = { ...v, next_check_at: v.verdict === "EXTEND" ? book.graded_windows + QUIET_KILL_AT : null };
}

// ---------------------------------------------------------------- kill criteria (pre-registered, §9)

export type QuietRow = {
  ticker: string;
  close_time: number;
  seat: string;
  source: QuietSource | string;
  grade_status: string;
  hit: number | null;
  cents: number | null;
  coin_cents: number | null;
  p_used?: number;
  admitted_state?: string;
  regime_key?: string;
  captured_at?: number;
};

const graded = (rows: readonly QuietRow[]) => rows.filter((r) => r.grade_status === "GRADED" && (r.hit === 0 || r.hit === 1));
const NOVEL = new Set(["PAPER", "TILT"]);

/** Window-clustered means (unit = window): hit rate and (cents − coin). */
export function clusterByWindow(rows: readonly QuietRow[]) {
  const by = new Map<string, { h: number; e: number; n: number }>();
  for (const r of graded(rows)) {
    const k = keyOf(r.ticker, r.close_time);
    const w = by.get(k) ?? { h: 0, e: 0, n: 0 };
    w.h += r.hit!;
    w.e += (r.cents ?? 0) - (r.coin_cents ?? 0);
    w.n += 1;
    by.set(k, w);
  }
  const summarize = (xs: number[]) => {
    const n = xs.length;
    const mean = n ? xs.reduce((s, x) => s + x, 0) / n : NaN;
    const sd = n > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : NaN;
    const se = n > 1 ? sd / Math.sqrt(n) : NaN;
    return { n, mean, sd, se };
  };
  const hit = summarize([...by.values()].map((w) => w.h / w.n));
  const ev = summarize([...by.values()].map((w) => w.e / w.n));
  return { hit, ev };
}

function perSeat(rows: readonly QuietRow[], seats: readonly string[]) {
  return seats.map((seat) => {
    const rs = rows.filter((r) => r.seat === seat);
    const hits = rs.reduce((s, r) => s + (r.hit ?? 0), 0);
    return { seat, n: rs.length, hits, p: pTwoSided(hits, rs.length) };
  });
}

/**
 * The pre-registered §9 evaluation. `rows` are desk_quiet_calls rows (the table
 * is authoritative for kill analysis); `book` supplies coverage and drift checks.
 */
export function evaluateKill(rows: readonly QuietRow[], book: QuietBook, now = 0): KillVerdict {
  const g = graded(rows);
  // K0 — integrity (extends, never retires).
  const reasons: string[] = [];
  const capturedWindows = book.graded_windows + book.skipped.chalk + book.skipped.uncountable + book.skipped.identity;
  const eligibleWindows = capturedWindows + book.missed_windows;
  const coverage = eligibleWindows ? capturedWindows / eligibleWindows : 0;
  if (coverage < 0.9) reasons.push("COVERAGE");
  const rebuilt = statsBySeat(g);
  const drift = QUIET_SEATS.filter((s) => {
    const a = book.seats[s]?.all ?? freshStats();
    const b = rebuilt.get(s) ?? { n: 0, hits: 0 };
    return a.n !== b.n || a.hits !== b.hits;
  });
  if (drift.length) reasons.push("BOOK_DRIFT");
  const control = perSeat(g, QUIET_CONTROL_SEATS);
  if (control.some((c) => c.n > 0 && c.p < 0.05)) reasons.push("CONTROL_DRIFT");
  const k0 = { coverage, drift_seats: drift, control, reasons };
  // K1 — no discrimination among the 19 judged seats.
  const judged = perSeat(g, QUIET_JUDGED_SEATS).filter((s) => s.n > 0);
  const k1Holm = holmAnyReject(judged.map((s) => s.p));
  const chi = chi2Homogeneity(judged);
  const k1 = { k: judged.length, holm_any_reject: k1Holm, holm_threshold_p: judged.length ? HOLM_ALPHA / judged.length : null,
    chi2: chi, chi2_reject: chi.p < 0.05, fires: !k1Holm && !(chi.p < 0.05), seats: judged };
  // K2 — no signal beyond skill cards: the novel subset (PAPER, TILT) of judged seats.
  const novelRows = g.filter((r) => NOVEL.has(String(r.source)) && QUIET_JUDGED_SEATS.includes(r.seat as SeatId));
  const novelSeats = perSeat(novelRows, QUIET_JUDGED_SEATS).filter((s) => s.n > 0);
  const k2a = holmAnyReject(novelSeats.map((s) => s.p));
  const cl = clusterByWindow(novelRows);
  const tHit = cl.hit.n > 1 ? tQuantile(0.975, cl.hit.n - 1) : Infinity;
  const hitLo = cl.hit.n > 1 ? cl.hit.mean - tHit * (cl.hit.se || 0) : -Infinity;
  const hitHi = cl.hit.n > 1 ? cl.hit.mean + tHit * (cl.hit.se || 0) : Infinity;
  const k2bContains = !(hitLo > 0.5 || hitHi < 0.5);
  const tEv = cl.ev.n > 1 ? tQuantile(0.95, cl.ev.n - 1) : Infinity;
  const evLb = cl.ev.n > 1 ? cl.ev.mean - tEv * (cl.ev.se || 0) : -Infinity;
  const k2 = { novel_windows: cl.hit.n, holm_any_reject: k2a, pooled_hit: { mean: cl.hit.n ? cl.hit.mean : null, lo: hitLo, hi: hitHi, contains_half: k2bContains },
    pooled_ev_vs_coin: { mean: cl.ev.n ? cl.ev.mean : null, lower_95: evLb }, fires: !k2a && k2bContains && evLb <= 0, seats: novelSeats };
  const verdict: KillVerdict["verdict"] = reasons.length ? "EXTEND" : k1.fires || k2.fires ? "RETIRE" : "CONTINUE";
  return { verdict, at_windows: book.graded_windows, evaluated_at: now, k0, k1, k2 };
}

function statsBySeat(rows: readonly QuietRow[]) {
  const m = new Map<string, { n: number; hits: number }>();
  for (const r of rows) {
    const s = m.get(r.seat) ?? { n: 0, hits: 0 };
    s.n += 1;
    s.hits += r.hit ?? 0;
    m.set(r.seat, s);
  }
  return m;
}

/** Rebuilds a book from graded table rows (reconciliation and drift checks). */
export function rebuildBookFromRows(rows: readonly QuietRow[], credit: CreditFn, activatedAt = 0): QuietBook {
  const book = freshQuietBook(activatedAt);
  const g = [...graded(rows)].sort((a, b) => a.close_time - b.close_time || (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0));
  const windows = new Set<string>();
  for (const r of g) {
    windows.add(keyOf(r.ticker, r.close_time));
    creditCall(book, {
      seat: r.seat as SeatId,
      p: r.p_used ?? 0.5,
      source: r.source as QuietSource,
      admitted_state: (r.admitted_state ?? "WAIT") as AdmittedState,
    }, r.regime_key ?? "", r.hit as 0 | 1, r.cents ?? 0, r.coin_cents ?? 0, credit);
  }
  book.graded_windows = windows.size;
  return book;
}

// ---------------------------------------------------------------- persistence

const num = (x: unknown, d = 0) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : d);
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

function sanitizeStats(x: unknown): SkillStats {
  const f = freshStats();
  if (!isObj(x)) return f;
  const out: SkillStats = { ...f };
  for (const k of ["n", "hits", "brier_sum", "brier_n", "streak_wrong"] as const) out[k] = num(x[k]);
  for (const k of ["wilson", "brier", "ev_sum", "ev_n", "ev"] as const) out[k] = typeof x[k] === "number" && Number.isFinite(x[k]) ? (x[k] as number) : 0;
  out.ev_n = num(x.ev_n);
  out.last20 = Array.isArray(x.last20) ? x.last20.filter((v): v is number => v === 0 || v === 1).slice(-20) : [];
  out.pocket = {};
  if (isObj(x.pocket)) for (const [k, p] of Object.entries(x.pocket)) if (isObj(p)) out.pocket[k] = { n: num(p.n), hits: num(p.hits) };
  return out;
}

function sanitizeRecord(seat: SeatId, x: unknown): QuietRecord {
  const r = freshRecord(seat);
  if (!isObj(x)) return r;
  r.all = sanitizeStats(x.all);
  if (isObj(x.bySource)) for (const s of Object.keys(r.bySource) as QuietSource[]) r.bySource[s] = sanitizeStats(x.bySource[s]);
  if (isObj(x.byAdmitted)) { r.byAdmitted.SPOKE = sanitizeStats(x.byAdmitted.SPOKE); r.byAdmitted.SILENT = sanitizeStats(x.byAdmitted.SILENT); }
  r.coin_sum = typeof x.coin_sum === "number" && Number.isFinite(x.coin_sum) ? x.coin_sum : 0;
  if (isObj(x.pocket_ev)) for (const [k, v] of Object.entries(x.pocket_ev)) if (typeof v === "number" && Number.isFinite(v)) r.pocket_ev[k] = v;
  if (Array.isArray(x.roll)) {
    r.roll = x.roll.filter((e): e is RollEntry => isObj(e) && (e.hit === 0 || e.hit === 1) && Number.isFinite(e.cents) && Number.isFinite(e.coin) && Number.isFinite(e.p) && typeof e.source === "string")
      .map((e) => ({ hit: e.hit, cents: e.cents, coin: e.coin, p: e.p, source: e.source }))
      .slice(-QUIET_ROLL);
  }
  return r;
}

function sanitizeFlag(x: unknown): QuietFlag | null {
  if (!isObj(x) || (x.state !== "CLEAR" && x.state !== "FLAGGED")) return null;
  const f = freshFlag();
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    ...f,
    state: x.state,
    since: n(x.since),
    reason: x.reason === "A" || x.reason === "B" ? x.reason : null,
    b_streak: num(x.b_streak),
    clean_streak: num(x.clean_streak),
    wilson_lb: n(x.wilson_lb),
    wilson_ub: n(x.wilson_ub),
    l50_hit: n(x.l50_hit),
    l50_ev_vs_coin: n(x.l50_ev_vs_coin),
    rethink_eligible: typeof x.rethink_eligible === "boolean" ? x.rethink_eligible : null,
  };
}

/** Malformed input → a fresh book. Never throws. */
export function sanitizeQuietBook(raw: unknown): QuietBook {
  try {
    if (!isObj(raw) || raw.v !== QUIET_CALL_VERSION) return freshQuietBook();
    if (raw.seats != null && !isObj(raw.seats)) return freshQuietBook();
    for (const k of ["activated_at", "armed_after_close", "graded_windows", "missed_windows"]) {
      if (raw[k] != null && !(typeof raw[k] === "number" && Number.isFinite(raw[k]) && (raw[k] as number) >= 0)) return freshQuietBook();
    }
    const book = freshQuietBook(num(raw.activated_at));
    book.armed_after_close = num(raw.armed_after_close);
    book.graded_windows = num(raw.graded_windows);
    book.missed_windows = num(raw.missed_windows);
    if (isObj(raw.skipped)) book.skipped = { chalk: num(raw.skipped.chalk), uncountable: num(raw.skipped.uncountable), identity: num(raw.skipped.identity) };
    book.graded_keys = Array.isArray(raw.graded_keys) ? raw.graded_keys.filter((k): k is string => typeof k === "string").slice(-QUIET_GRADED_KEY_CAP) : [];
    const seats = isObj(raw.seats) ? raw.seats : {};
    for (const s of QUIET_SEATS) book.seats[s] = sanitizeRecord(s, seats[s]);
    if (isObj(raw.flags)) for (const s of QUIET_SEATS) { const f = sanitizeFlag(raw.flags[s]); if (f) book.flags[s] = f; }
    book.review_log = Array.isArray(raw.review_log) ? raw.review_log.filter((l): l is string => typeof l === "string").slice(0, QUIET_REVIEW_LOG_CAP) : [];
    const k = raw.kill;
    book.kill = isObj(k) && (k.verdict === "RETIRE" || k.verdict === "CONTINUE" || k.verdict === "EXTEND") && typeof k.at_windows === "number"
      ? (JSON.parse(JSON.stringify(k)) as KillVerdict)
      : null;
    return book;
  } catch {
    return freshQuietBook();
  }
}

function validCapture(c: unknown): c is QuietCapture {
  return isObj(c) && c.v === QUIET_CALL_VERSION && typeof c.ticker === "string" && Number.isFinite(c.close_time) &&
    Number.isFinite(c.yes_ask) && Number.isFinite(c.no_ask) && Number.isFinite(c.yes_mid) && typeof c.regime_key === "string" &&
    Array.isArray(c.calls) && c.calls.every((x) => isObj(x) && typeof x.seat === "string" && (x.side === "UP" || x.side === "DOWN") &&
      Number.isFinite(x.p) && typeof x.source === "string");
}

/** Pending captures plus one active window, bounded with the settlement queue. */
export function sanitizeQuietCaptures(raw: unknown): Record<string, QuietCapture> {
  if (!isObj(raw)) return {};
  const ok = Object.entries(raw).filter((e): e is [string, QuietCapture] => validCapture(e[1]) && e[0] === keyOf(e[1].ticker, e[1].close_time));
  ok.sort((a, b) => a[1].close_time - b[1].close_time);
  return Object.fromEntries(ok.slice(-QUIET_CAPTURE_CAP).map(([k, c]) => [k, JSON.parse(JSON.stringify(c)) as QuietCapture]));
}

export function quietCaptureKey(ticker: string, closeTime: number): string {
  return keyOf(ticker, closeTime);
}
