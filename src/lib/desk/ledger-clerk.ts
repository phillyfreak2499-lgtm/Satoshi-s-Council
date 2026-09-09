/**
 * LEDGER's rulebook — the pure functions the server drives once a day.
 *
 * LEDGER is a staff clerk, like SWEEP/COACH/WRENCH: it never votes and never
 * appears as a seat on the floor. It reads the ledger's per-window vote matrix
 * — each seat's directional read, the window's winner, and the chair's booked
 * economics — and mines cross-seat patterns:
 *
 *   • a PAIR card — two seats that reinforce (when they agree, the window
 *     resolves their way more often than either alone) or cancel;
 *   • a COALITION card — a group of seats whose agreement beats every member
 *     alone by a Wilson-lower-bound margin.
 *
 * A pattern is discovered on a TRAINING range of windows and promoted to
 * "cited" only when the edge also holds on the windows AFTER that range
 * (walk-forward, never in-sample). A pattern that reliably resolves AGAINST
 * its members is inverted (cite the opposite side) rather than deleted — the
 * same shadow idea the seats use. Nothing here trades, sizes, or gates; the
 * chair may cite a promoted pattern as one more labelled, non-binding line.
 */
import { opposite, wilsonLower } from "./math";
import type { LedgerCite, Lean } from "./types";

export const LEDGER = "LEDGER" as const;

export type Side = "UP" | "DOWN";
export type PatternKind = "pair" | "coalition";
export type PatternStatus = "candidate" | "cited" | "inverted" | "stale";

/** One graded window reduced to what LEDGER mines. */
export type LedgerWindow = {
  /** close_time in ms — the axis the walk-forward split is cut on. */
  t: number;
  winner: Side;
  /** The chair's booked side, or WAIT when it sat / was under the floor. */
  chair_lean: Lean;
  /** The chair's after-fee cents, present only when it booked. */
  ev_cents: number | null;
  /** seat → its directional read this window (the honest pre-gag lean). */
  stance: Record<string, Side>;
};

export type MinedPattern = {
  slug: string;
  kind: PatternKind;
  members: string[];
  agree_side: Side;
  cited_side: Side;
  status: PatternStatus;
  train_n: number;
  train_hits: number;
  train_wilson: number;
  test_n: number;
  test_hits: number;
  test_wilson: number;
  member_solo: number;
  net_cents: number;
  booked_n: number;
  note: string;
};

export type MineResult = {
  patterns: MinedPattern[];
  /** Human-readable reason mining was skipped, or null when it ran. */
  skipped: string | null;
  windows: number;
  train_n: number;
  test_n: number;
  /** ms of the first out-of-sample window. */
  split_at: number | null;
  found_from: number | null;
  found_to: number | null;
  test_to: number | null;
  considered: number;
};

// --- knobs, all named so the pane and the glossary can quote them ---
export const MIN_WINDOWS = 40; // below this, the split is too thin to trust
export const MIN_TRAIN = 25;
export const MIN_TEST = 12;
export const TEST_FRAC = 0.3; // the most-recent third is held out of sample
export const TRAIN_MIN_N = 12; // a pattern must fire at least this often in training
export const TEST_MIN_N = 6; // and this often out of sample to be judged
export const BEAT_MARGIN = 0.03; // the pattern's Wilson must clear the best member's by this
export const CITE_TEST_WILSON = 0.5; // out-of-sample Wilson lower-bound bar to be cited
export const CITE_TEST_HIT = 0.55; // out-of-sample hit-rate bar to be cited
export const INVERT_TRAIN_HIT = 0.42; // resolves against its members in training
export const TOPK_TRIPLE = 8; // coalitions of three are drawn from the top-K solo seats
export const TOPK_QUAD = 6; // coalitions of four from the top-K
export const MIN_SOLO_N = 10; // a seat needs this many training reads to enter a pattern
export const MAX_STORED = 48; // cap the cards kept per run
export const MAX_CITES = 4; // cap the citations shown in one chair read

type Cell = {
  n_tr: number;
  h_tr: number;
  n_te: number;
  h_te: number;
  book_s_n: number;
  book_s_ev: number;
  book_a_n: number;
  book_a_ev: number;
};

function blankCell(): Cell {
  return { n_tr: 0, h_tr: 0, n_te: 0, h_te: 0, book_s_n: 0, book_s_ev: 0, book_a_n: 0, book_a_ev: 0 };
}

type Solo = { n: number; hits: number; wilson: number };

/** Each seat's directional accuracy on the training windows — the bar a
 *  coalition of that seat has to beat. */
export function soloBaselines(train: LedgerWindow[]): Map<string, Solo> {
  const acc = new Map<string, { n: number; hits: number }>();
  for (const w of train) {
    for (const [seat, side] of Object.entries(w.stance)) {
      const a = acc.get(seat) ?? { n: 0, hits: 0 };
      a.n += 1;
      if (side === w.winner) a.hits += 1;
      acc.set(seat, a);
    }
  }
  const out = new Map<string, Solo>();
  for (const [seat, a] of acc) out.set(seat, { n: a.n, hits: a.hits, wilson: wilsonLower(a.hits, a.n) });
  return out;
}

function sortedMembers(members: string[]): string[] {
  return [...members].sort();
}

function slugOf(kind: PatternKind, members: string[], agree: Side): string {
  return `${kind}:${sortedMembers(members).join("+")}:${agree}`;
}

/** Walk every window once, filling the UP-agree and DOWN-agree cells for a
 *  group of members: a window counts when all members read the same side. */
function scoreGroup(windows: LedgerWindow[], members: string[], splitAt: number): { UP: Cell; DOWN: Cell } {
  const cells = { UP: blankCell(), DOWN: blankCell() };
  for (const w of windows) {
    let side: Side | null = null;
    let all = true;
    for (const m of members) {
      const s = w.stance[m];
      if (s == null) {
        all = false;
        break;
      }
      if (side == null) side = s;
      else if (side !== s) {
        all = false;
        break;
      }
    }
    if (!all || side == null) continue;
    const c = cells[side];
    const train = w.t < splitAt;
    if (train) {
      c.n_tr += 1;
      if (w.winner === side) c.h_tr += 1;
    } else {
      c.n_te += 1;
      if (w.winner === side) c.h_te += 1;
    }
    if ((w.chair_lean === "UP" || w.chair_lean === "DOWN") && w.ev_cents != null) {
      if (w.chair_lean === side) {
        c.book_s_n += 1;
        c.book_s_ev += w.ev_cents;
      } else {
        c.book_a_n += 1;
        c.book_a_ev += w.ev_cents;
      }
    }
  }
  return cells;
}

function combinations<T>(items: T[], k: number): T[][] {
  const out: T[][] = [];
  const pick = (start: number, acc: T[]) => {
    if (acc.length === k) {
      out.push(acc.slice());
      return;
    }
    for (let i = start; i < items.length; i += 1) {
      acc.push(items[i]);
      pick(i + 1, acc);
      acc.pop();
    }
  };
  pick(0, []);
  return out;
}

/** The candidate groups: every pair of qualifying seats, plus coalitions of
 *  three and four drawn from the top seats by solo accuracy. */
function candidateGroups(solo: Map<string, Solo>): { kind: PatternKind; members: string[] }[] {
  const voters = [...solo.entries()].filter(([, s]) => s.n >= MIN_SOLO_N).map(([seat]) => seat);
  const ranked = [...voters].sort((a, b) => (solo.get(b)?.wilson ?? 0) - (solo.get(a)?.wilson ?? 0));
  const groups: { kind: PatternKind; members: string[] }[] = [];
  const seen = new Set<string>();
  const add = (kind: PatternKind, members: string[]) => {
    const key = sortedMembers(members).join("+");
    if (seen.has(key)) return;
    seen.add(key);
    groups.push({ kind, members: sortedMembers(members) });
  };
  for (const p of combinations(voters, 2)) add("pair", p);
  for (const t of combinations(ranked.slice(0, TOPK_TRIPLE), 3)) add("coalition", t);
  for (const q of combinations(ranked.slice(0, TOPK_QUAD), 4)) add("coalition", q);
  return groups;
}

function memberSolo(members: string[], solo: Map<string, Solo>): number {
  let best = 0;
  for (const m of members) best = Math.max(best, solo.get(m)?.wilson ?? 0);
  return best;
}

/** Decide a candidate's status from its training cell and its out-of-sample
 *  cell. Cited: agrees, beats every member on training AND holds out of
 *  sample. Inverted: resolves against its members and the opposite holds out
 *  of sample. Candidate: earns the training bar but is not yet confirmed.
 *  Anything weaker is dropped. */
function classify(members: string[], kind: PatternKind, side: Side, cell: Cell, solo: Map<string, Solo>): MinedPattern | null {
  if (cell.n_tr < TRAIN_MIN_N) return null;
  const bar = memberSolo(members, solo);
  const trainW = wilsonLower(cell.h_tr, cell.n_tr);
  const trainHit = cell.h_tr / cell.n_tr;
  const testW = cell.n_te > 0 ? wilsonLower(cell.h_te, cell.n_te) : 0;
  const testHit = cell.n_te > 0 ? cell.h_te / cell.n_te : 0;
  // The anti side (the pattern read inverted): its hits are the misses.
  const antiTrainW = wilsonLower(cell.n_tr - cell.h_tr, cell.n_tr);
  const antiTestW = cell.n_te > 0 ? wilsonLower(cell.n_te - cell.h_te, cell.n_te) : 0;
  const antiTestHit = cell.n_te > 0 ? (cell.n_te - cell.h_te) / cell.n_te : 0;

  const base = {
    slug: slugOf(kind, members, side),
    kind,
    members,
    agree_side: side,
    train_n: cell.n_tr,
    train_hits: cell.h_tr,
    train_wilson: round3(trainW),
    test_n: cell.n_te,
    test_hits: cell.h_te,
    test_wilson: round3(testW),
    member_solo: round3(bar),
  };
  const who = members.join("+");

  // Cited: the members' own side, confirmed out of sample.
  if (trainHit > 0.5 && trainW >= bar + BEAT_MARGIN) {
    if (cell.n_te >= TEST_MIN_N && testHit >= CITE_TEST_HIT && testW >= CITE_TEST_WILSON) {
      return {
        ...base,
        cited_side: side,
        status: "cited",
        net_cents: round1(cell.book_s_ev),
        booked_n: cell.book_s_n,
        note: `${who} → ${side}: ${cell.h_tr}/${cell.n_tr} in training (W${pct(trainW)} vs best member W${pct(bar)}), ${cell.h_te}/${cell.n_te} out of sample`,
      };
    }
    return {
      ...base,
      cited_side: side,
      status: "candidate",
      net_cents: round1(cell.book_s_ev),
      booked_n: cell.book_s_n,
      note: `${who} → ${side}: ${cell.h_tr}/${cell.n_tr} in training (W${pct(trainW)}), awaiting out-of-sample confirmation`,
    };
  }

  // Inverted: resolves against the members; cite the opposite, confirmed out of sample.
  if (trainHit < INVERT_TRAIN_HIT && antiTrainW >= bar + BEAT_MARGIN) {
    if (cell.n_te >= TEST_MIN_N && antiTestHit >= CITE_TEST_HIT && antiTestW >= CITE_TEST_WILSON) {
      return {
        ...base,
        cited_side: opp(side),
        status: "inverted",
        net_cents: round1(cell.book_a_ev),
        booked_n: cell.book_a_n,
        note: `${who} agree ${side} but resolve ${opp(side)}: ${cell.n_tr - cell.h_tr}/${cell.n_tr} against in training, ${cell.n_te - cell.h_te}/${cell.n_te} out of sample`,
      };
    }
    return {
      ...base,
      cited_side: opp(side),
      status: "candidate",
      net_cents: round1(cell.book_a_ev),
      booked_n: cell.book_a_n,
      note: `${who} lean ${side} but tend to resolve ${opp(side)} in training, awaiting out-of-sample confirmation`,
    };
  }

  return null;
}

/** The mine. Splits the windows walk-forward, scores every candidate group on
 *  both sides, and returns the promoted and candidate cards. */
export function mine(windowsIn: LedgerWindow[], _now = Date.now()): MineResult {
  const windows = [...windowsIn].sort((a, b) => a.t - b.t);
  const empty = (skipped: string): MineResult => ({
    patterns: [],
    skipped,
    windows: windows.length,
    train_n: 0,
    test_n: 0,
    split_at: null,
    found_from: windows[0]?.t ?? null,
    found_to: null,
    test_to: null,
    considered: 0,
  });
  if (windows.length < MIN_WINDOWS) return empty(`only ${windows.length} graded windows, need ${MIN_WINDOWS}`);

  let splitIdx = Math.floor(windows.length * (1 - TEST_FRAC));
  splitIdx = Math.min(Math.max(splitIdx, MIN_TRAIN), windows.length - MIN_TEST);
  if (splitIdx < MIN_TRAIN || windows.length - splitIdx < MIN_TEST) {
    return empty(`the ${MIN_TRAIN}/${MIN_TEST} train/test split does not fit ${windows.length} windows yet`);
  }
  const splitAt = windows[splitIdx].t;
  const train = windows.slice(0, splitIdx);
  const test = windows.slice(splitIdx);

  const solo = soloBaselines(train);
  const groups = candidateGroups(solo);
  const found: MinedPattern[] = [];
  for (const g of groups) {
    const cells = scoreGroup(windows, g.members, splitAt);
    for (const side of ["UP", "DOWN"] as Side[]) {
      const p = classify(g.members, g.kind, side, cells[side], solo);
      if (p) found.push(p);
    }
  }
  // Promoted first, then by out-of-sample strength, capped.
  const rank = (p: MinedPattern) => (p.status === "cited" || p.status === "inverted" ? 2 : p.status === "candidate" ? 1 : 0);
  found.sort((a, b) => rank(b) - rank(a) || b.test_wilson - a.test_wilson || b.train_wilson - a.train_wilson);
  const patterns = found.slice(0, MAX_STORED);

  return {
    patterns,
    skipped: null,
    windows: windows.length,
    train_n: train.length,
    test_n: test.length,
    split_at: splitAt,
    found_from: train[0]?.t ?? null,
    found_to: train[train.length - 1]?.t ?? null,
    test_to: test[test.length - 1]?.t ?? null,
    considered: groups.length,
  };
}

/** A promoted card as the chair sees it. The Wilson it carries is the bound on
 *  the side it points to — for an inverted card that is the anti side, whose
 *  hits are the members'-side misses. */
export function citedWilson(p: { status: PatternStatus; test_n: number; test_hits: number; test_wilson: number }): number {
  if (p.status !== "inverted") return p.test_wilson;
  return round3(wilsonLower(p.test_n - p.test_hits, p.test_n));
}

export function toCite(p: MinedPattern): LedgerCite {
  return {
    members: p.members,
    agree_side: p.agree_side,
    cited_side: p.cited_side,
    status: p.status === "inverted" ? "inverted" : "cited",
    wilson: citedWilson(p),
    n: p.test_n,
  };
}

/** Each seat's live directional read from the current votes (the honest
 *  pre-gag lean when present, else the spoken lean). */
export function stancesFromVotes(votes: readonly { seat: string; lean: Lean; raw_lean?: Lean }[]): Record<string, Side> {
  const out: Record<string, Side> = {};
  for (const v of votes) {
    const d = v.raw_lean === "UP" || v.raw_lean === "DOWN" ? v.raw_lean : v.lean;
    if (d === "UP" || d === "DOWN") out[v.seat] = d;
  }
  return out;
}

/** Which promoted patterns fire on the current window: every member reads the
 *  pattern's agree side. Read-only — this decides nothing, it only surfaces a
 *  labelled note for the chair's read. */
export function firingCitations(stances: Record<string, Side>, promoted: readonly LedgerCite[]): LedgerCite[] {
  const out: LedgerCite[] = [];
  for (const p of promoted) {
    if (p.members.length && p.members.every((m) => stances[m] === p.agree_side)) out.push(p);
  }
  out.sort((a, b) => b.members.length - a.members.length || b.wilson - a.wilson);
  return out.slice(0, MAX_CITES);
}

function opp(s: Side): Side {
  const o = opposite(s);
  return o === "UP" || o === "DOWN" ? o : s;
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
function pct(n: number): number {
  return Math.round(n * 100);
}
