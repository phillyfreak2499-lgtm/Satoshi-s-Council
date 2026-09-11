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
  /**
   * The shadow microstructure reads at each instant, null wherever the lab was
   * dark or the feed had not filled a window yet. Research: no seat reads these
   * and the chair never saw them. Absent entirely on windows recorded before
   * 2026-09-11, which is why every field is optional.
   */
  imb?: (number | null)[];
  micro?: (number | null)[];
  ofi?: (number | null)[];
  cancel?: (number | null)[];
  tflow?: (number | null)[];
  resid?: (number | null)[];
  /** Who moved first over 30s: 1 spot, -1 Kalshi, 0 together, null neither. */
  lead?: (number | null)[];
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
