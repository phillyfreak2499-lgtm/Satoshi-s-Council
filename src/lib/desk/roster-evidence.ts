/** Read-only roster receipts. Counts never stand in for seat identities or clocks. */
import type { ChairResult, Snapshot } from "./types.ts";

type Side = "UP" | "DOWN";
type Member = { seat: string; lean: Side | "WAIT" };
export type RosterReceipt = {
  ticker: string;
  close_time: number;
  snapshot_at: number | null;
  phase: "observation" | "grade";
  population: "chair-quorum" | "graded-speaking-seats";
  members: Member[];
};
export type RosterCheck = { status: "MATCH" | "MISMATCH" | "DIFFERENT" | "MISSING"; note: string };
type LedgerSeat = { lean?: string; hit?: boolean | null; raw_lean?: string };

const directional = (v: unknown): v is Side => v === "UP" || v === "DOWN";
const stamp = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

export function readRoster(v: unknown): RosterReceipt | null {
  if (!v || typeof v !== "object") return null;
  const r = v as RosterReceipt;
  if (typeof r.ticker !== "string" || !r.ticker || !stamp(r.close_time)) return null;
  if (r.snapshot_at !== null && !stamp(r.snapshot_at)) return null;
  if (r.phase !== "observation" && r.phase !== "grade") return null;
  if (r.population !== "chair-quorum" && r.population !== "graded-speaking-seats") return null;
  if (!Array.isArray(r.members)) return null;
  const seen = new Set<string>();
  for (const m of r.members) {
    if (!m || typeof m.seat !== "string" || !m.seat || seen.has(m.seat)) return null;
    if (!directional(m.lean) && m.lean !== "WAIT") return null;
    seen.add(m.seat);
  }
  return { ...r, members: r.members.map(({ seat, lean }) => ({ seat, lean })).sort((a, b) => a.seat.localeCompare(b.seat)) };
}

export function rosterCounts(r: RosterReceipt): { up: number; down: number; wait: number } {
  return {
    up: r.members.filter((m) => m.lean === "UP").length,
    down: r.members.filter((m) => m.lean === "DOWN").length,
    wait: r.members.filter((m) => m.lean === "WAIT").length,
  };
}

/** Mirrors the already-finalized Chair quorum population; grants no authority. */
export function chairRoster(snap: Snapshot, chair: ChairResult): RosterReceipt | null {
  if (!Array.isArray(chair.rows)) return null;
  return readRoster({
    ticker: snap.ticker, close_time: snap.close_time, snapshot_at: stamp(snap.as_of) ? snap.as_of : null,
    phase: "observation", population: "chair-quorum",
    members: chair.rows.filter((r) => !["WARDEN", "ORBIT", "WIRE"].includes(r.seat) && r.status !== "MUTED")
      .map((r) => ({ seat: r.seat, lean: r.lean })),
  });
}

export function quorumCheck(roster: RosterReceipt | null, counts: unknown): RosterCheck {
  if (!roster || !counts || typeof counts !== "object") return { status: "MISSING", note: "Saved seat roster: MISSING. Counts cannot be verified." };
  const q = counts as { up?: unknown; down?: unknown; wait?: unknown };
  const expected = rosterCounts(roster);
  if (["up", "down", "wait"].every((k) => q[k as keyof typeof q] === expected[k as keyof typeof expected])) {
    return { status: "MATCH", note: "Counts match the saved seat names and sides at this observation." };
  }
  return { status: "MISMATCH", note: "Seat counts disagree with the saved roster. Agreement claim withheld." };
}

/** Exact identities first. Different frames or populations are never declared equal. */
export function compareRosters(left: RosterReceipt | null, right: RosterReceipt | null): RosterCheck {
  if (!left || !right) return { status: "MISSING", note: "Chamber-to-Books comparison: saved roster MISSING." };
  if (left.ticker !== right.ticker || left.close_time !== right.close_time) return { status: "MISMATCH", note: "Chamber and Books refer to different windows." };
  if (left.phase !== right.phase || left.population !== right.population) return { status: "DIFFERENT", note: "Different readings: Chamber counts the Chair observation; Books counts seats at grade. No equality claim." };
  if (left.snapshot_at == null || right.snapshot_at == null) return { status: "MISSING", note: "Snapshot time MISSING. Roster equality cannot be verified." };
  if (left.snapshot_at !== right.snapshot_at) return { status: "DIFFERENT", note: "Different snapshot times. No equality claim." };
  const key = (r: RosterReceipt) => JSON.stringify(r.members.map((m) => [m.seat, m.lean]).sort((a, b) => a[0].localeCompare(b[0])));
  return key(left) === key(right)
    ? { status: "MATCH", note: "Same window, snapshot, population, seat names and sides." }
    : { status: "MISMATCH", note: "Same snapshot, but seat names or sides disagree. Agreement claim withheld." };
}

/** The existing Books arithmetic, shared with the Chamber's ledger evidence. */
export function booksSeatEvidence(ticker: string, closeTime: number, winner: Side, seats: Record<string, LedgerSeat> | null) {
  let n = 0, right = 0, rawN = 0, rawRight = 0;
  const members: Member[] = [];
  let complete = seats != null;
  for (const [seat, v] of Object.entries(seats ?? {})) {
    if (!v || typeof v !== "object") { complete = false; continue; }
    if (v.hit === true || v.hit === false) {
      n++;
      if (v.hit) right++;
      if (directional(v.lean)) members.push({ seat, lean: v.lean });
      else complete = false;
    }
    const raw = v.raw_lean ?? v.lean;
    if (directional(raw)) { rawN++; if (raw === winner) rawRight++; }
  }
  // The ledger does not store its input snapshot time. Its close is not that clock.
  const roster = complete ? readRoster({ ticker, close_time: closeTime, snapshot_at: null,
    phase: "grade", population: "graded-speaking-seats", members }) : null;
  return { seats: { n, right }, raw: { n: rawN, right: rawRight }, roster };
}

/** Fix only the known mixed-clock legacy template; keep the original in evidence. */
export function legacyBookedText(text: string): string | null {
  const m = /^Booked (UP|DOWN) at (\d+)¢ with \d+ seats? agreeing and \d+ seats? against, graded at the close\./.exec(text);
  return m ? `Paper entry: ${m[1]} at ${m[2]}¢. Entry-time agreement: MISSING. The saved dispatch combined this entry with the observation's seat count. The paper position is held to settlement.` : null;
}
