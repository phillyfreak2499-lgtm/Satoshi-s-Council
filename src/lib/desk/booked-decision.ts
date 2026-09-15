/**
 * The paper position as it existed when the book paid.
 *
 * This is measurement only. It joins the canonical held call to the entry-frame
 * facts already captured by the server. Nothing here can vote, gate, book,
 * settle, tune, or teach the learner.
 */
import type { EntrySkillRoster } from "./entry-skill-roster";
export type BookedDecisionState = {
  /** Added prospectively; null keeps an older in-flight state readable. */
  lean: "UP" | "DOWN" | null;
  regime: string;
  secs_left: number | null;
  conf: number | null;
  score: number | null;
  bar: number | null;
  fair_yes: number | null;
  spread_cents: number | null;
  leftover_cents: number | null;
  touch_size: number | null;
  fee_cents: number | null;
  /** The Render commit that made the booked decision, when available. */
  build_sha: string;
  /** Same-tick card roster, captured only after a bookable paper fill. */
  entry_roster?: EntrySkillRoster | null;
};

type BookedCallLike = {
  ticker: string;
  close_time: number;
  lean: "UP" | "DOWN";
  cents: number;
};

export type BookedDecisionAtGrade = {
  lean: "UP" | "DOWN";
  cents: number;
  conf: number | null;
  score: number | null;
  bar: number | null;
  build_sha: string | null;
};

function finite(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  return Number.isFinite(Number(v)) ? Number(v) : null;
}

function buildSha(v: unknown): string {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return /^[0-9a-f]{7,40}$/.test(s) ? s : "";
}

function roster(raw: unknown): EntrySkillRoster | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<EntrySkillRoster>;
  if (((r as { version?: string }).version !== "ENTRY_SKILL_ROSTER_V1" && r.version !== "ENTRY_SKILL_ROSTER_V2") ||
      (r.version === "ENTRY_SKILL_ROSTER_V2" && (!r.book || typeof r.book !== "object")) ||
      r.scope !== "booked_paper_entry" ||
      (r.side !== "UP" && r.side !== "DOWN") || typeof r.ticker !== "string" ||
      !Number.isFinite(r.close_time_ms) || !Number.isFinite(r.entry_at_ms) ||
      !Array.isArray(r.chair_rows) || !Array.isArray(r.seat_reads)) return null;
  return r as EntrySkillRoster;
}

/** Restore entry facts after a deployment without inventing missing values. */
export function sanitizeBookedDecisionState(raw: unknown): Record<string, BookedDecisionState> {
  const out: Record<string, BookedDecisionState> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    const conf = finite(row.conf);
    out[key] = {
      lean: row.lean === "UP" || row.lean === "DOWN" ? row.lean : null,
      regime: typeof row.regime === "string" ? row.regime : "",
      secs_left: finite(row.secs_left),
      conf: conf == null ? null : Math.round(conf),
      score: finite(row.score),
      bar: finite(row.bar),
      fair_yes: finite(row.fair_yes),
      spread_cents: finite(row.spread_cents),
      leftover_cents: finite(row.leftover_cents),
      touch_size: finite(row.touch_size),
      fee_cents: finite(row.fee_cents),
      build_sha: buildSha(row.build_sha),
      entry_roster: roster(row.entry_roster),
    };
  }
  return out;
}

/**
 * Join a graded window back to its actual held position.
 *
 * The call log is authoritative for whether the paper book paid and which side
 * it held. Entry state supplies the same-tick score metadata. Requiring the call
 * prevents a stray measurement object from being mistaken for a position.
 */
export function bookedDecisionAtGrade(
  calls: readonly BookedCallLike[],
  ticker: string,
  closeTime: number,
  entry: BookedDecisionState | null | undefined,
): BookedDecisionAtGrade | null {
  const matching = calls.filter(
    (call) => call.ticker === ticker && Math.abs(call.close_time - closeTime) < 90_000,
  );
  const call = matching[matching.length - 1] ?? null; // call log is newest-first
  if (!call) return null;
  return {
    lean: call.lean,
    cents: call.cents,
    conf: entry?.conf ?? null,
    score: entry?.score ?? null,
    bar: entry?.bar ?? null,
    build_sha: entry?.build_sha || null,
  };
}
