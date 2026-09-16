import { chairDecisionOf } from "./booked-side";

export type GavelPaperStatus = "FILLED" | "SKIPPED" | "NONE";

export type GavelRow = {
  t: string;
  lean: "UP" | "DOWN" | "WAIT";
  paper: GavelPaperStatus;
  conf: number;
  score: number;
  bar: number;
  entry: number | null;
  settle: number | null;
  ev: number | null;
  winner: "UP" | "DOWN" | null;
};

export type GavelSourceRow = {
  close_time: Date | string;
  chair_lean: string | null;
  chair_conf: number | null;
  score: number | null;
  bar: number | null;
  entry_lean: string | null;
  entry_cents: number | null;
  entry_conf: number | null;
  entry_score: number | null;
  entry_bar: number | null;
  settle_cents: number | null;
  ev_cents: number | null;
  winner: string | null;
  first_directional_lean: string | null;
  first_directional_conf: number | null;
  first_directional_score: number | null;
  first_directional_bar: number | null;
};

const direction = (v: string | null | undefined): "UP" | "DOWN" | null =>
  v === "UP" ? "UP" : v === "DOWN" ? "DOWN" : null;

const winnerOf = (v: string | null | undefined): "UP" | "DOWN" | null =>
  v === "UP" ? "UP" : v === "DOWN" ? "DOWN" : null;

export function gavelLeanOf(
  r: Pick<GavelSourceRow, "chair_lean" | "entry_lean" | "entry_cents" | "settle_cents" | "winner" | "first_directional_lean">,
): "UP" | "DOWN" | "WAIT" {
  const winner = winnerOf(r.winner);
  if (r.entry_cents != null) {
    return direction(r.entry_lean) ?? chairDecisionOf(r.chair_lean, r.settle_cents, winner);
  }
  return direction(r.first_directional_lean) ?? chairDecisionOf(r.chair_lean, r.settle_cents, winner);
}

export function gavelPaperOf(
  r: Pick<GavelSourceRow, "entry_cents" | "first_directional_lean" | "chair_lean">,
): GavelPaperStatus {
  if (r.entry_cents != null) return "FILLED";
  // FIRST_DIRECTIONAL is the preferred prospective receipt. Older rows can still
  // have a directional grade-frame Chair read from before that recorder existed;
  // that is also a real recorded read, so show SKIP rather than the ambiguous UP · —.
  return direction(r.first_directional_lean) ?? direction(r.chair_lean) ? "SKIPPED" : "NONE";
}

function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

export function toGavelRow(r: GavelSourceRow): GavelRow {
  const paper = gavelPaperOf(r);
  const booked = paper === "FILLED";
  const skipped = paper === "SKIPPED";
  const winner = winnerOf(r.winner);
  const hasFirstDirectional = direction(r.first_directional_lean) != null;
  const conf = booked
    ? r.entry_conf ?? r.chair_conf
    : skipped && hasFirstDirectional
      ? r.first_directional_conf ?? r.chair_conf
      : r.chair_conf;
  const score = booked
    ? r.entry_score ?? r.score
    : skipped && hasFirstDirectional
      ? r.first_directional_score ?? r.score
      : r.score;
  const bar = booked
    ? r.entry_bar ?? r.bar
    : skipped && hasFirstDirectional
      ? r.first_directional_bar ?? r.bar
      : r.bar;

  return {
    t: iso(r.close_time),
    lean: gavelLeanOf(r),
    paper,
    conf: Math.round(Number(conf ?? 0)),
    score: Number(score ?? 0),
    bar: Number(bar ?? 0),
    entry: r.entry_cents != null ? Number(r.entry_cents) : null,
    // A skipped Chair read never receives a paper settlement or EV. Those belong
    // only to a position the book actually recorded.
    settle: booked && r.settle_cents != null ? Number(r.settle_cents) : null,
    ev: booked && r.ev_cents != null ? Math.round(Number(r.ev_cents) * 10) / 10 : null,
    winner,
  };
}
