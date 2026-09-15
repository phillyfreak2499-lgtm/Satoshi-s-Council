/** Client side of the books: the shapes GET /api/books returns and one fetcher. */
import type { RosterReceipt } from "./roster-evidence";
export type BooksCall = { lean: "UP" | "DOWN" | null; entry: number; settle: number | null; ev: number | null };

export type BooksWindow = {
  ticker: string;
  close_time: string;
  winner: "UP" | "DOWN";
  official: number | null;
  settle_avg: number | null;
  prints: number | null;
  call: BooksCall | null;
  seats: { n: number; right: number };
  grade_roster?: RosterReceipt | null;
  raw: { n: number; right: number };
  arena: { n: number; net: number } | null;
  replay: boolean;
};

export type BooksTotals = {
  n: number;
  calls: number;
  wins: number;
  net: number;
  ups: number;
  /** Win rate the calls needed to break even, 0–100 — for calls held to settlement, entry plus fee. Null with no calls. */
  breakeven: number | null;
};
export type BooksDay = { day: string; n: number; calls: number; wins: number; net: number };
export type BooksPoint = { t: string; ev: number; cum: number };
export type BooksBucket = { lo: number; hi: number; n: number; wins: number; avg_entry: number; breakeven: number; net: number };
export type BooksHeatCell = { dow: number; hour: number; n: number; calls: number; wins: number; net: number };

/** The lab's stale-quote study, counted one trade per window so correlated shocks cannot inflate it. */
export type BooksLabLine = { n: number; avg: number; sum: number; pos: number };
export type BooksLab = {
  windows: number;
  shocks: number;
  since: string | null;
  stale_ms: number | null;
  /** First fillable shock per window: bought at the stale ask, held to settlement, after the fee. */
  first: BooksLabLine;
  /** Same, for the first fillable shock inside the final minute; ask and claimed edge are averages. */
  final: BooksLabLine & { ask: number; claimed: number };
};

/** The 80¢ floor trial, both books on the same windows. Shadow is research only. */
export type FloorTrial = {
  since: string;
  until?: string;
  live_cents: number;
  shadow_cents: number;
  windows: number;
  live: BooksTotals;
  shadow: BooksTotals;
  declined: number;
};

export type Books = {
  last: BooksWindow | null;
  today: BooksTotals;
  week: BooksTotals;
  /** The book as it plays now: windows closing since the 70¢ floor went live. */
  floor: BooksTotals;
  floor_since: string;
  /** The 80¢ floor trial: the live book and the shadow 70¢ book on the same windows. */
  trial: FloorTrial | null;
  all: BooksTotals;
  /** Null when the scorecard could not be computed — never a zeroed card. */
  keeper: Keeper | null;
  /** Why the scorecard is missing, when it is. */
  keeper_error: string | null;
  days: BooksDay[];
  curve: BooksPoint[];
  buckets: BooksBucket[];
  heat: BooksHeatCell[];
  windows: BooksWindow[];
  /** Missing ledger windows in the last 90 days; excluded from research totals. */
  missing_windows?: string[];
  lab: BooksLab | null;
  at: number;
};

/** KEEPER — the process scorecard, with BLOT's drawdown. Mirrors books.server.ts. */
export type KeeperStats = {
  n: number;
  wait_pct: number;
  booked: number;
  hit_pct: number | null;
  net: number;
  max_dd: number;
  avg_entry: number | null;
  floor_pct: number | null;
  conf_ratio: number | null;
};
export type Keeper = { all: KeeperStats; week: KeeperStats };

export async function fetchBooks(): Promise<Books> {
  const r = await fetch("/api/books", { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
  const j = (await r.json()) as Books & { error?: string };
  if (!r.ok || j.error) throw new Error(j.error || `books ${r.status}`);
  return j;
}
