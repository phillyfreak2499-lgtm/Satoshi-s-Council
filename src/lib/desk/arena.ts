/** Client side of the Arena: a device token and callsign kept in this
 *  browser (no login), and the two calls the panel and tab make. */
export type HumanCall = {
  ticker: string;
  close_time: string;
  lean: "UP" | "DOWN";
  conf: number | null;
  entry_cents: number;
  fee: number;
  mins_left: number;
  t: string;
  winner: "UP" | "DOWN" | null;
  cents: number | null;
};

export type ArenaRow = { name: string; n: number; wins: number; net: number; avg_conf: number | null; hit_pct: number | null; me?: boolean; warming?: boolean; since?: string | null };

export type ArenaMe = {
  name: string;
  calls: HumanCall[];
  n: number;
  wins: number;
  net: number;
  avg_conf: number | null;
  hit_pct: number | null;
  open: number;
  rank_week: number | null;
  players_week: number;
};

export type Arena = { me: ArenaMe | null; week: ArenaRow[]; all: ArenaRow[]; desk_week: ArenaRow[]; desk_all: ArenaRow[]; at: number };

const TOKEN_KEY = "arena.token";
const NAME_KEY = "arena.name";

function safeGet(k: string): string {
  try {
    return localStorage.getItem(k) ?? "";
  } catch {
    return "";
  }
}

function safeSet(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
}

export function arenaToken(): string {
  let t = safeGet(TOKEN_KEY);
  if (!t) {
    t = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
    safeSet(TOKEN_KEY, t);
  }
  return t;
}

export function arenaName(): string {
  return safeGet(NAME_KEY);
}

export function setArenaName(name: string): void {
  safeSet(NAME_KEY, name.trim());
}

export async function fetchArena(): Promise<Arena> {
  const r = await fetch(`/arena/summary?token=${encodeURIComponent(arenaToken())}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  const j = (await r.json()) as Arena & { error?: string };
  if (!r.ok || j.error) throw new Error(j.error || `arena ${r.status}`);
  return j;
}

export async function placeCall(lean: "UP" | "DOWN", conf: number): Promise<HumanCall> {
  const r = await fetch("/call", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: arenaToken(), name: arenaName() || undefined, lean, conf }),
    signal: AbortSignal.timeout(12_000),
  });
  const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string; call?: HumanCall } | null;
  if (!r.ok || !j?.ok || !j.call) throw new Error(j?.error || `call ${r.status}`);
  return j.call;
}
