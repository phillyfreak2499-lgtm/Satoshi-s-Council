/**
 * One public record, one scope.
 *
 * Presentation only. Numbers come from the existing books snapshot.
 * Arena, shadow Chair v2, and the 70¢ comparison are different scopes
 * and must not be mixed into this block.
 */
import type { Books, BooksTotals } from "./books";

export const CANONICAL_RECORD_HREF = "/books";
export const CANONICAL_RECORD_LABEL = "Canonical paper record";
export const CANONICAL_RECORD_OTHER_SCOPE =
  "different scope — see the canonical record";

export type CanonicalRecord = {
  scope: string;
  calls: number;
  wins: number;
  losses: number;
  net: number;
  avg: number | null;
  maxDrawdown: number | null;
  winRate: number | null;
  interval: [number, number] | null;
  windows: number;
  since: string;
};

/** Wilson score interval, same z the lab uses. Null when there are no calls. */
export function wilsonInterval(wins: number, n: number): [number, number] | null {
  if (!Number.isFinite(wins) || !Number.isFinite(n) || n <= 0) return null;
  const z = 1.959964;
  const p = Math.min(1, Math.max(0, wins / n));
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return [Math.max(0, (centre - margin) / denom), Math.min(1, (centre + margin) / denom)];
}

function fromTotals(
  t: BooksTotals,
  since: string,
  windows: number,
  maxDrawdown: number | null,
  liveCents: number,
): CanonicalRecord {
  const losses = Math.max(0, t.calls - t.wins);
  return {
    scope: `Current ${liveCents}¢ paper book · recorded fills held to official settlement · after Kalshi fees · since ${since.slice(0, 10)} · through latest graded window`,
    calls: t.calls,
    wins: t.wins,
    losses,
    net: t.net,
    avg: t.calls ? t.net / t.calls : null,
    maxDrawdown,
    winRate: t.calls ? t.wins / t.calls : null,
    interval: wilsonInterval(t.wins, t.calls),
    windows,
    since: since.slice(0, 10),
  };
}

/**
 * The canonical record is the current live price-floor population only.
 * The archived matched-window trial and all-time keeper are different scopes.
 */
export function canonicalFromBooks(books: Books): CanonicalRecord {
  const live = books.live_floor;
  return fromTotals(live.totals, live.since, live.totals.n, live.max_dd, live.live_cents);
}

export function fmtCents(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}¢`;
}

export function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${(100 * n).toFixed(0)}%`;
}
