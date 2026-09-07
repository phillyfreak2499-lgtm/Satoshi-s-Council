/** Client side of window replay: the shape GET /replay returns and one fetcher. */
export type ReplayCols = {
  t0: number;
  t: number[];
  spot: number[];
  yes_bid: number[];
  yes_ask: number[];
  fair: (number | null)[];
  lean: number[];
  conf: number[];
  ups: number[];
  downs: number[];
  booked: number[];
  seats: Record<string, number[]>;
};

export type Replay = {
  ticker: string;
  close_time: string;
  strike: number | null;
  winner: "UP" | "DOWN" | null;
  n: number;
  step_ms: number;
  partial: boolean;
  cols: ReplayCols;
  official: number | null;
  call: { entry: number; settle: number | null; ev: number | null } | null;
};

export async function fetchReplay(ticker: string): Promise<Replay> {
  const r = await fetch(`/replay?ticker=${encodeURIComponent(ticker)}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  const j = (await r.json()) as Replay & { error?: string };
  if (!r.ok || j.error) throw new Error(j.error || `replay ${r.status}`);
  return j;
}
