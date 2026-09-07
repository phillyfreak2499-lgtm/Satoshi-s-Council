/** Client side of THE PIT: the rack's shape and the two calls the room makes.
 *  Reuses the Arena's device token and callsign. */
import { arenaName, arenaToken, type HumanCall } from "./arena";

export type RackWindow = {
  ticker: string;
  close_time: string;
  strike: number | null;
  yes_bid: number;
  yes_ask: number;
  no_bid: number;
  no_ask: number;
  mid: number | null;
  stale: boolean;
};

export type RackSplit = { up_pct: number; down_pct: number; avg_paper_cents: number };

export type RackMe = { name: string; n: number; wins: number; losses: number; net: number; rank_week: number | null; players_week: number };

export type Rack = {
  window: RackWindow | null;
  n_locked: number;
  split: RackSplit | null;
  mine: HumanCall | null;
  last: HumanCall | null;
  chair: string | null;
  me: RackMe | null;
  at: number;
};

export async function fetchRack(): Promise<Rack> {
  const r = await fetch(`/arena/rack?token=${encodeURIComponent(arenaToken())}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  const j = (await r.json()) as Rack & { error?: string };
  if (!r.ok || j.error) throw new Error(j.error || `rack ${r.status}`);
  return j;
}

/** One paper lock on the live window. The reply carries the rack so the room
 *  can show YOU LOCKED and the new count without another round trip. */
export async function lockCall(lean: "UP" | "DOWN"): Promise<{ call: HumanCall; rack: Rack | null }> {
  const r = await fetch("/call", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ token: arenaToken(), name: arenaName() || undefined, lean }),
    signal: AbortSignal.timeout(12_000),
  });
  const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string; call?: HumanCall; rack?: Rack | null } | null;
  if (!r.ok || !j?.ok || !j.call) throw new Error(j?.error || `lock ${r.status}`);
  return { call: j.call, rack: j.rack ?? null };
}
