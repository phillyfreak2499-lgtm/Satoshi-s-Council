import type { SystemEventInput } from "./system-events";

export type SweepCrewLogRow = {
  t: string;
  seat: string | null;
  action: string;
  detail: string;
  slug: string | null;
  evidence: Record<string, unknown> | null;
};

function finite(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Convert an already-persisted SWEEP crew-log transition into a public Chamber
 * event. This is presentation-only: the crew log is the fact and this function
 * cannot create flags, clear flags, tune seats, or touch the Chair.
 */
export function sweepCrewEvent(row: SweepCrewLogRow): SystemEventInput | null {
  const action = String(row.action ?? "").trim().toLowerCase();
  const seat = String(row.seat ?? "").trim().toUpperCase();
  const detail = String(row.detail ?? "").trim();
  const slug = String(row.slug ?? "").trim();
  const at = Date.parse(String(row.t ?? ""));
  if ((action !== "flag" && action !== "clear") || !seat || !detail || !slug || !Number.isFinite(at)) return null;

  const evidence = row.evidence ?? {};
  return {
    event_key: `DESK_UPDATE:SWEEP:${slug}`,
    event_type: "DESK_UPDATE",
    character: "SWEEP",
    occurred_at: new Date(at),
    source_type: "desk_update",
    source_id: slug,
    public: true,
    payload: {
      kind: "sweep-seat-audit",
      seat,
      action,
      text: detail,
      reads: finite(evidence.reads),
      spoke: finite(evidence.spoke),
      gagged: finite(evidence.gagged),
      max_conf: finite(evidence.max_conf),
      avg_conf: finite(evidence.avg_conf),
      spoke_hit_pct: finite(evidence.spoke_hit_pct),
      mid_n: finite(evidence.mid_n),
      mid_hit_pct: finite(evidence.mid_hit_pct),
      mid_cents: finite(evidence.mid_cents),
      grade_n: finite(evidence.grade_n),
      authority: "none",
    },
  };
}
