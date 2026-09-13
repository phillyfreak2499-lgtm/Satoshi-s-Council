/**
 * Chamber PR 1 — pure reaction helper.
 *
 * CHAIR_WAIT_MILESTONE → one SATOSHI statement.
 * No WARDEN, no ALCHEMIST, no LLM, no second speaker.
 * Text is the stored plainLine() result — never paraphrased.
 */
import type { PublicSystemEvent } from "./system-events";

export type ChamberStatement = {
  event_key: string;
  speaker: "SATOSHI";
  text: string;
  occurred_at: string;
  source_type: string;
  source_id: string;
  evidence: {
    wait_reason: string;
    ticker: string;
    close_time: number | null;
    quorum: { up: number; down: number; wait: number } | null;
    score: number | null;
    bar: number | null;
    failed_hard: string[];
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

/** Map one public event to a SATOSHI line. Any other type/speaker is silent. */
export function statementFromEvent(ev: PublicSystemEvent): ChamberStatement | null {
  if (ev.event_type !== "CHAIR_WAIT_MILESTONE") return null;
  if (ev.character !== "SATOSHI") return null;
  const text = asString(ev.payload.text).trim();
  if (!text) return null;
  const wait_reason = asString(ev.payload.wait_reason);
  return {
    event_key: ev.event_key,
    speaker: "SATOSHI",
    text,
    occurred_at: ev.occurred_at,
    source_type: ev.source_type,
    source_id: ev.source_id,
    evidence: {
      wait_reason,
      ticker: asString(ev.payload.ticker),
      close_time: asNum(ev.payload.close_time),
      quorum: asQuorum(ev.payload.quorum),
      score: asNum(ev.payload.score),
      bar: asNum(ev.payload.bar),
      failed_hard: asIds(ev.payload.failed_hard),
    },
  };
}
