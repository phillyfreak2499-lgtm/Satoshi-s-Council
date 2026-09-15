/**
 * Chamber reaction mapper.
 *
 * It translates immutable public system events into display-only statements.
 * Stored wording is preserved as evidence when a known mixed-clock template is corrected.
 */
import type { PublicSystemEvent } from "./system-events.ts";
import { legacyBookedText, quorumCheck, readRoster, type RosterCheck, type RosterReceipt } from "./roster-evidence.ts";

export type ChamberSpeaker = "SATOSHI" | "WARDEN" | "ALCHEMIST" | "SWEEP";

export type ChamberStatement = {
  event_key: string;
  event_type: PublicSystemEvent["event_type"];
  speaker: ChamberSpeaker;
  text: string;
  /** Original wording retained when a known legacy mixed-clock sentence is corrected. */
  original_text?: string;
  occurred_at: string;
  source_type: string;
  source_id: string;
  evidence: {
    kind: "chair-wait" | "chair-directional" | "system-health" | "experiment" | "seat-audit";
    wait_reason: string;
    ticker: string;
    close_time: number | null;
    quorum: { up: number; down: number; wait: number } | null;
    score: number | null;
    bar: number | null;
    failed_hard: string[];
    feed: string;
    receipt_age_s: number | null;
    last_change_age_s: number | null;
    gap: string;
    lean: string;
    entry_cents: number | null;
    candidate_id: string;
    candidate_label: string;
    sample_n: number | null;
    paired_n: number | null;
    paired_delta: number | null;
    milestone: number | null;
    control_id: string;
    frozen_at: string;
    paper_only: boolean;
    authority: string;
    seat?: string;
    action?: string;
    reads?: number | null;
    spoke?: number | null;
    gagged?: number | null;
    mid_n?: number | null;
    mid_hit_pct?: number | null;
    mid_cents?: number | null;
    grade_n?: number | null;
    roster?: RosterReceipt | null;
    roster_check?: RosterCheck;
    books_check?: RosterCheck;
    books_roster?: RosterReceipt | null;
    books_seats?: { n: number; right: number };
  };
};

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asQuorum(v: unknown): { up: number; down: number; wait: number } | null {
  if (!v || typeof v !== "object") return null;
  const q = v as { up?: unknown; down?: unknown; wait?: unknown };
  const up = asNum(q.up);
  const down = asNum(q.down);
  const wait = asNum(q.wait);
  if (up == null || down == null || wait == null) return null;
  return { up, down, wait };
}

function asIds(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, 12);
}

function baseEvidence(ev: PublicSystemEvent) {
  return {
    ticker: asString(ev.payload.ticker),
    close_time: asNum(ev.payload.close_time),
    candidate_id: "",
    candidate_label: "",
    sample_n: null,
    paired_n: null,
    paired_delta: null,
    milestone: null,
    control_id: "",
    frozen_at: "",
    paper_only: false,
    authority: "",
  };
}

/** Map one public event to a deterministic Chamber line. Unsupported events stay silent. */
export function statementFromEvent(ev: PublicSystemEvent): ChamberStatement | null {
  const text = asString(ev.payload.text).trim();
  if (!text) return null;

  if (ev.event_type === "CHAIR_WAIT_MILESTONE" && ev.character === "SATOSHI") {
    const roster = readRoster(ev.payload.roster);
    const check = roster && (roster.phase !== "observation" || roster.population !== "chair-quorum" || roster.ticker !== ev.payload.ticker || roster.close_time !== ev.payload.close_time || roster.snapshot_at !== Date.parse(ev.occurred_at))
      ? { status: "MISMATCH" as const, note: "The saved roster belongs to a different window or observation time. Agreement claim withheld." }
      : quorumCheck(roster, ev.payload.quorum);
    const corrected = legacyBookedText(text);
    const display = check.status === "MISMATCH" ? "Agreement claim withheld: the saved counts disagree with the seat roster." : corrected ?? text;
    return {
      event_key: ev.event_key,
      event_type: ev.event_type,
      speaker: "SATOSHI",
      text: display,
      ...(display !== text ? { original_text: text } : {}),
      occurred_at: ev.occurred_at,
      source_type: ev.source_type,
      source_id: ev.source_id,
      evidence: {
        kind: "chair-wait",
        ...baseEvidence(ev),
        wait_reason: asString(ev.payload.wait_reason),
        quorum: check.status === "MISMATCH" ? null : asQuorum(ev.payload.quorum),
        roster,
        roster_check: check,
        score: asNum(ev.payload.score),
        bar: asNum(ev.payload.bar),
        failed_hard: asIds(ev.payload.failed_hard),
        feed: "",
        receipt_age_s: null,
        last_change_age_s: null,
        gap: "",
        lean: "",
        entry_cents: null,
      },
    };
  }

  if (ev.event_type === "CHAIR_DIRECTIONAL" && ev.character === "SATOSHI") {
    return {
      event_key: ev.event_key,
      event_type: ev.event_type,
      speaker: "SATOSHI",
      text,
      occurred_at: ev.occurred_at,
      source_type: ev.source_type,
      source_id: ev.source_id,
      evidence: {
        kind: "chair-directional",
        ...baseEvidence(ev),
        wait_reason: "",
        quorum: null,
        score: null,
        bar: null,
        failed_hard: [],
        feed: "",
        receipt_age_s: null,
        last_change_age_s: null,
        gap: "",
        lean: asString(ev.payload.lean),
        entry_cents: asNum(ev.payload.entry_cents),
      },
    };
  }

  if (
    (ev.event_type === "SYSTEM_HEALTH_ALERT" || ev.event_type === "SYSTEM_HEALTH_RECOVERED") &&
    ev.character === "WARDEN"
  ) {
    return {
      event_key: ev.event_key,
      event_type: ev.event_type,
      speaker: "WARDEN",
      text,
      occurred_at: ev.occurred_at,
      source_type: ev.source_type,
      source_id: ev.source_id,
      evidence: {
        kind: "system-health",
        ...baseEvidence(ev),
        wait_reason: "",
        quorum: null,
        score: null,
        bar: null,
        failed_hard: [],
        feed: asString(ev.payload.feed),
        receipt_age_s: asNum(ev.payload.receipt_age_s),
        last_change_age_s: asNum(ev.payload.last_change_age_s),
        gap: asString(ev.payload.gap),
        lean: "",
        entry_cents: null,
      },
    };
  }

  if (
    (ev.event_type === "EXPERIMENT_STARTED" || ev.event_type === "EXPERIMENT_EVIDENCE_MILESTONE") &&
    ev.character === "ALCHEMIST"
  ) {
    return {
      event_key: ev.event_key,
      event_type: ev.event_type,
      speaker: "ALCHEMIST",
      text,
      occurred_at: ev.occurred_at,
      source_type: ev.source_type,
      source_id: ev.source_id,
      evidence: {
        kind: "experiment",
        ticker: "",
        close_time: null,
        wait_reason: "",
        quorum: null,
        score: null,
        bar: null,
        failed_hard: [],
        feed: "",
        receipt_age_s: null,
        last_change_age_s: null,
        gap: "",
        lean: "",
        entry_cents: null,
        candidate_id: asString(ev.payload.candidate_id),
        candidate_label: asString(ev.payload.candidate_label),
        sample_n: asNum(ev.payload.sample_n),
        paired_n: asNum(ev.payload.paired_n),
        paired_delta: asNum(ev.payload.paired_delta),
        milestone: asNum(ev.payload.milestone),
        control_id: asString(ev.payload.control_id),
        frozen_at: asString(ev.payload.frozen_at),
        paper_only: ev.payload.paper_only === true,
        authority: asString(ev.payload.authority),
      },
    };
  }

  if (ev.event_type === "DESK_UPDATE" && ev.character === "SWEEP" && ev.payload.kind === "sweep-seat-audit") {
    return {
      event_key: ev.event_key,
      event_type: ev.event_type,
      speaker: "SWEEP",
      text,
      occurred_at: ev.occurred_at,
      source_type: ev.source_type,
      source_id: ev.source_id,
      evidence: {
        kind: "seat-audit",
        ...baseEvidence(ev),
        wait_reason: "",
        quorum: null,
        score: null,
        bar: null,
        failed_hard: [],
        feed: "",
        receipt_age_s: null,
        last_change_age_s: null,
        gap: "",
        lean: "",
        entry_cents: null,
        seat: asString(ev.payload.seat),
        action: asString(ev.payload.action),
        reads: asNum(ev.payload.reads),
        spoke: asNum(ev.payload.spoke),
        gagged: asNum(ev.payload.gagged),
        mid_n: asNum(ev.payload.mid_n),
        mid_hit_pct: asNum(ev.payload.mid_hit_pct),
        mid_cents: asNum(ev.payload.mid_cents),
        grade_n: asNum(ev.payload.grade_n),
      },
    };
  }

  return null;
}
