/** Client side of the first-screen brief: the shapes GET /brief returns and one fetcher. Mirrors brief.server.ts. */
import type { GavelRow } from "./gavel";
export type { GavelPaperStatus, GavelRow } from "./gavel";

export type Overnight = {
  up: number;
  down: number;
  wait: number;
  wait_streak: number;
  btc_open: number | null;
  btc_now: number | null;
  btc_lo: number | null;
  btc_hi: number | null;
  last: { t: string; lean: "UP" | "DOWN" | "WAIT"; settle: number | null } | null;
};

export type Brief = { gavel: GavelRow[]; overnight: Overnight; at: number };

export async function fetchBrief(): Promise<Brief> {
  const r = await fetch("/brief", { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
  const j = (await r.json()) as Brief & { error?: string };
  if (!r.ok || (j as { error?: string }).error) throw new Error((j as { error?: string }).error || `brief ${r.status}`);
  return j;
}
