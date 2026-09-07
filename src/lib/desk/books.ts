/** Client side of the books: the shapes GET /books returns and one fetcher. */
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
  raw: { n: number; right: number };
  arena: { n: number; net: number } | null;
};

export type BooksTotals = { n: number; calls: number; wins: number; net: number; ups: number };
export type BooksDay = { day: string; n: number; calls: number; wins: number; net: number };
export type BooksPoint = { t: string; ev: number; cum: number };
export type BooksBucket = { lo: number; hi: number; n: number; wins: number; avg_entry: number; net: number };
export type BooksHeatCell = { dow: number; hour: number; n: number; calls: number; wins: number; net: number };

export type Books = {
  last: BooksWindow | null;
  today: BooksTotals;
  week: BooksTotals;
  all: BooksTotals;
  days: BooksDay[];
  curve: BooksPoint[];
  buckets: BooksBucket[];
  heat: BooksHeatCell[];
  windows: BooksWindow[];
  at: number;
};

export async function fetchBooks(): Promise<Books> {
  const r = await fetch("/books", { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
  const j = (await r.json()) as Books & { error?: string };
  if (!r.ok || j.error) throw new Error(j.error || `books ${r.status}`);
  return j;
}
