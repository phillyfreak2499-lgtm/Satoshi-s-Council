/**
 * The Arena (server only): visitors make their own paper calls against the
 * shared live window and get graded by the same settlement as the chair.
 * No logins — a device token names a player. One call per window, booked
 * at the current ask plus the exact Kalshi taker fee, never inside the last
 * thirty seconds, held to settlement.
 */
import { createHash } from "node:crypto";
import { takerFeeCentsExact } from "./clock";

async function sql() {
  const { getSql } = await import("@/lib/db");
  return getSql();
}

const NAME_RE = /^[A-Za-z0-9 _\-.]{2,16}$/;
const TOKEN_RE = /^[A-Za-z0-9\-_]{16,64}$/;
const MIN_MINS_LEFT = 0.5;
/** Settled locks before a callsign is ranked on a board; fewer shows as warming up. */
export const RANK_MIN_N = 3;
/** New callsigns one network may create in a day. Enough for a household, not for hopping. */
export const NEW_NAMES_PER_DAY = 3;

/** A one-way id for a network: hash of a server secret and the address. The address itself is never stored. */
export function netHash(ip: unknown): string | null {
  const s = typeof ip === "string" ? ip.split(",")[0]!.trim() : "";
  if (!s) return null;
  const salt = process.env.DESK_ADMIN_KEY || "satoshi-pit";
  return createHash("sha256").update(`${salt}|${s}`).digest("hex").slice(0, 32);
}

export type CallInput = { token: unknown; name?: unknown; lean: unknown; conf?: unknown; net?: string | null };
export type CallResult =
  | { ok: true; call: HumanCall }
  | { ok: false; error: string; status: number };

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

export function cleanName(v: unknown): string | null {
  const s = String(v ?? "").trim().replace(/\s+/g, " ");
  return NAME_RE.test(s) ? s : null;
}

export function cleanToken(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return TOKEN_RE.test(s) ? s : null;
}

export async function placeCall(input: CallInput): Promise<CallResult> {
  const token = cleanToken(input.token);
  if (!token) return { ok: false, error: "bad token", status: 400 };
  const lean = input.lean === "UP" || input.lean === "DOWN" ? input.lean : null;
  if (!lean) return { ok: false, error: "lean must be UP or DOWN", status: 400 };
  const confRaw = Number(input.conf);
  const conf = Number.isFinite(confRaw) ? Math.max(50, Math.min(99, Math.round(confRaw))) : null;
  const { getServerSnap, getPulse } = await import("./server-engine");
  const snap = getServerSnap();
  if (!snap || !snap.ticker || !(snap.close_time > 0)) return { ok: false, error: "no live window yet", status: 503 };
  const now = Date.now();
  const minsLeft = (snap.close_time - now) / 60_000;
  if (minsLeft < MIN_MINS_LEFT) return { ok: false, error: "too late — the window is inside its last 30 seconds", status: 409 };
  // Prefer the fast lane's quote when it is fresh; fall back to the frame.
  const pulse = getPulse();
  const fresh = pulse && !pulse.stale && pulse.ticker === snap.ticker && now - pulse.as_of < 5_000 ? pulse : null;
  const ask = lean === "UP" ? (fresh?.yes_ask ?? snap.yes_ask) : (fresh?.no_ask ?? snap.no_ask);
  if (!(ask > 0) || ask >= 99) return { ok: false, error: "no price to buy at right now", status: 409 };
  const fee = takerFeeCentsExact(ask);
  const db = await sql();
  const name = cleanName(input.name);
  const existing = await db<{ name: string }>`select name from desk_players where token = ${token}`;
  const taken = async (n: string) => {
    const holder = await db<{ token: string }>`select token from desk_players where lower(name) = lower(${n}) limit 1`;
    return holder.length > 0 && holder[0]!.token !== token;
  };
  const TAKEN = { ok: false as const, error: "that callsign is taken — pick another", status: 409 };
  if (!existing.length) {
    if (!name) return { ok: false, error: "pick a callsign first (2–16 letters or digits)", status: 400 };
    if (await taken(name)) return TAKEN;
    const net = input.net ?? null;
    if (net) {
      const [c] = await db<{ n: number }>`
        select count(*)::int as n from desk_players where net_hash = ${net} and created_at > now() - interval '24 hours'
      `;
      if ((c?.n ?? 0) >= NEW_NAMES_PER_DAY) {
        return { ok: false, error: `${NEW_NAMES_PER_DAY} new callsigns from one network in a day is the limit — use the one you have`, status: 429 };
      }
    }
    try {
      await db`insert into desk_players (token, name, net_hash) values (${token}, ${name}, ${net}) on conflict (token) do nothing`;
    } catch {
      return TAKEN;
    }
  } else if (name && name !== existing[0]!.name) {
    if (await taken(name)) return TAKEN;
    try {
      await db`update desk_players set name = ${name}, last_seen = now() where token = ${token}`;
    } catch {
      return TAKEN;
    }
  } else {
    await db`update desk_players set last_seen = now() where token = ${token}`;
  }
  const closeIso = new Date(snap.close_time).toISOString();
  const rows = await db<HumanCall>`
    insert into desk_human_calls (token, ticker, close_time, lean, conf, entry_cents, fee, mins_left)
    values (${token}, ${snap.ticker}, ${closeIso}, ${lean}, ${conf}, ${ask}, ${fee}, ${Math.round(minsLeft * 10) / 10})
    on conflict (token, ticker) do nothing
    returning ticker, close_time::text as close_time, lean, conf, entry_cents, fee, mins_left, t::text as t, winner, cents
  `;
  if (!rows.length) return { ok: false, error: "you already called this window — one call per window", status: 409 };
  return { ok: true, call: rows[0]! };
}

/** Called by the engine at grade time for every settled window. */
export async function settleHumanCalls(ticker: string, winner: "UP" | "DOWN"): Promise<{ token: string; cents: number }[]> {
  try {
    const db = await sql();
    return await db<{ token: string; cents: number }>`
      update desk_human_calls
         set winner = ${winner},
             cents = case when lean = ${winner} then 100 - entry_cents - fee else -entry_cents - fee end
       where ticker = ${ticker} and winner is null
       returning token, cents
    `;
  } catch {
    /* the next grade retries nothing; a missed settle shows as an open call */
    return [];
  }
}

export type ArenaRow = { name: string; n: number; wins: number; net: number; avg_conf: number | null; hit_pct: number | null; me?: boolean; warming?: boolean; since?: string | null };

async function humanRows(days: number | null, token: string | null): Promise<ArenaRow[]> {
  const db = await sql();
  const rows = await db<{ token: string; name: string; since: Date | string; n: number; wins: number; net: number; avg_conf: number | null; hits: number }>`
    select p.token, p.name, p.created_at as since,
           count(*) filter (where c.winner is not null)::int as n,
           count(*) filter (where c.cents > 0)::int as wins,
           coalesce(sum(c.cents), 0) as net,
           avg(c.conf) filter (where c.winner is not null) as avg_conf,
           count(*) filter (where c.winner is not null and c.lean = c.winner)::int as hits
      from desk_human_calls c join desk_players p using (token)
     where c.winner is not null
       and (${days == null} or c.close_time > now() - (${days ?? 0} || ' days')::interval)
     group by p.token, p.name, p.created_at
    having count(*) filter (where c.winner is not null) > 0
     order by net desc, n desc
     limit 25
  `;
  const mapped = rows.map((r) => ({
    name: r.name,
    n: r.n,
    wins: r.wins,
    net: Math.round(Number(r.net) * 10) / 10,
    avg_conf: r.avg_conf == null ? null : Math.round(Number(r.avg_conf)),
    hit_pct: r.n ? Math.round((100 * r.hits) / r.n) : null,
    me: token != null && r.token === token,
    warming: r.n < RANK_MIN_N,
    since: r.since instanceof Date ? r.since.toISOString() : r.since ? new Date(r.since).toISOString() : null,
  }));
  // Ranked callsigns first (by net), then the ones still warming up.
  return [...mapped.filter((r) => !r.warming), ...mapped.filter((r) => r.warming)];
}

async function deskRows(days: number | null): Promise<ArenaRow[]> {
  const db = await sql();
  const [chair] = await db<{ n: number; wins: number; net: number }>`
    select count(*) filter (where entry_cents is not null)::int as n,
           count(*) filter (where entry_cents is not null and ev_cents > 0)::int as wins,
           coalesce(sum(ev_cents) filter (where entry_cents is not null), 0) as net
      from desk_ledger
     where (${days == null} or close_time > now() - (${days ?? 0} || ' days')::interval)
  `;
  const mk = (name: string, r: { n: number; wins: number; net: number } | undefined): ArenaRow => ({
    name,
    n: r?.n ?? 0,
    wins: r?.wins ?? 0,
    net: Math.round(Number(r?.net ?? 0) * 10) / 10,
    avg_conf: null,
    hit_pct: r?.n ? Math.round((100 * r.wins) / r.n) : null,
  });
  // Chair v2 stays on the desk (SATOSHI tab) while it earns its voice; the public boards compare people with the chair.
  return [mk("SATOSHI (the chair)", chair)];
}

export async function arenaSummary(tokenRaw: unknown): Promise<unknown> {
  const token = cleanToken(tokenRaw);
  const db = await sql();
  const [week, all, desk7, deskAll] = await Promise.all([humanRows(7, token), humanRows(null, token), deskRows(7), deskRows(null)]);
  let me: unknown = null;
  if (token) {
    const player = await db<{ name: string }>`select name from desk_players where token = ${token}`;
    if (player.length) {
      const calls = await db<HumanCall>`
        select ticker, close_time::text as close_time, lean, conf, entry_cents, fee, mins_left, t::text as t, winner, cents
          from desk_human_calls where token = ${token} order by close_time desc limit 30
      `;
      const [tot] = await db<{ n: number; wins: number; net: number; avg_conf: number | null; hits: number; open: number }>`
        select count(*) filter (where winner is not null)::int as n,
               count(*) filter (where cents > 0)::int as wins,
               coalesce(sum(cents), 0) as net,
               avg(conf) filter (where winner is not null) as avg_conf,
               count(*) filter (where winner is not null and lean = winner)::int as hits,
               count(*) filter (where winner is null)::int as open
          from desk_human_calls where token = ${token}
      `;
      const rank7 = week.findIndex((r) => r.me && !r.warming) + 1;
      me = {
        name: player[0]!.name,
        calls,
        n: tot?.n ?? 0,
        wins: tot?.wins ?? 0,
        net: Math.round(Number(tot?.net ?? 0) * 10) / 10,
        avg_conf: tot?.avg_conf == null ? null : Math.round(Number(tot.avg_conf)),
        hit_pct: tot?.n ? Math.round((100 * tot.hits) / tot.n) : null,
        open: tot?.open ?? 0,
        rank_week: rank7 || null,
        players_week: week.filter((r) => !r.warming).length,
      };
    }
  }
  return { me, week, all, desk_week: desk7, desk_all: deskAll, at: Date.now() };
}

/** Clear every callsign and paper lock. Admin only; the route checks the key. */
export async function resetArena(): Promise<{ locks: number; players: number }> {
  const db = await sql();
  const [c] = await db<{ n: number }>`select count(*)::int as n from desk_human_calls`;
  const [p] = await db<{ n: number }>`select count(*)::int as n from desk_players`;
  await db`delete from desk_human_calls`;
  await db`delete from desk_players`;
  return { locks: c?.n ?? 0, players: p?.n ?? 0 };
}

/** One recap line for the nightly digest. */
export async function arenaDigestLine(): Promise<string | null> {
  try {
    const db = await sql();
    const [a] = await db<{ n: number; players: number; net: number; top_name: string | null; top_net: number | null }>`
      with day as (
        select c.*, p.name from desk_human_calls c join desk_players p using (token)
         where c.winner is not null
           and (c.close_time at time zone 'America/Chicago')::date = (now() at time zone 'America/Chicago')::date - 1
      ), tops as (
        select name, sum(cents) as net from day group by name order by net desc limit 1
      )
      select (select count(*)::int from day) as n,
             (select count(distinct name)::int from day) as players,
             (select coalesce(sum(cents), 0) from day) as net,
             (select name from tops) as top_name,
             (select net from tops) as top_net
    `;
    if (!a || !a.n) return null;
    const net = Number(a.net);
    return `arena: ${a.players} player${a.players === 1 ? "" : "s"}, ${a.n} call${a.n === 1 ? "" : "s"}, net ${net >= 0 ? "+" : ""}${net.toFixed(0)}¢${
      a.top_name ? ` · top ${a.top_name} ${Number(a.top_net) >= 0 ? "+" : ""}${Number(a.top_net).toFixed(0)}¢` : ""
    }`;
  } catch {
    return null;
  }
}
