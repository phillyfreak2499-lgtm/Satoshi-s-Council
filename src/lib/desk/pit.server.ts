/**
 * THE PIT (server only): the thin public room over the Arena. Watchers poll
 * a tiny rack every few seconds; the current window's aggregate (how many
 * locked, the split, the average paper lock) is computed once per few
 * seconds in memory and bumped in place on every lock, never counted per
 * GET. The split and average are only sent to a token that has locked this
 * window. Paper only.
 */
import { RANK_MIN_N, type HumanCall } from "./arena.server";
import { publicLabel } from "./callsign-guard";

async function sql() {
  const { getSql } = await import("@/lib/db");
  return getSql();
}

const TOKEN_RE = /^[A-Za-z0-9\-_]{16,64}$/;
const AGG_FRESH_MS = 3_000;
const WEEK_FRESH_MS = 20_000;
const PULSE_FRESH_MS = 5_000;
const LAST_LOOKBACK_H = 6;

export type RackWindow = {
  ticker: string;
  close_time: string;
  strike: number | null;
  yes_bid: number;
  yes_ask: number;
  no_bid: number;
  no_ask: number;
  /** YES mid in cents, null when a side is missing. */
  mid: number | null;
  stale: boolean;
};

export type RackSplit = { up_pct: number; down_pct: number; avg_paper_cents: number };

export type RackMe = {
  name: string;
  n: number;
  wins: number;
  losses: number;
  net: number;
  rank_week: number | null;
  players_week: number;
};

export type Rack = {
  window: RackWindow | null;
  n_locked: number;
  /** Only for a token that has locked this window. */
  split: RackSplit | null;
  /** This token's lock on the current window. */
  mine: HumanCall | null;
  /** This token's most recent lock when it is not on the current window: settling, or settled. */
  last: HumanCall | null;
  /** How the last lock's window settled: Kalshi's official value (our own average until it lands) and the strike. */
  last_settle: { value: number | null; strike: number | null } | null;
  chair: string | null;
  me: RackMe | null;
  at: number;
};

/** The current window's aggregate, pure so it can be tested without a database. */
export type Agg = { ticker: string; n: number; up: number; down: number; sum_entry: number; at: number };

export function emptyAgg(ticker: string, at = Date.now()): Agg {
  return { ticker, n: 0, up: 0, down: 0, sum_entry: 0, at };
}

export function applyLock(agg: Agg, call: Pick<HumanCall, "ticker" | "lean" | "entry_cents">): Agg {
  if (call.ticker !== agg.ticker) return agg;
  return {
    ...agg,
    n: agg.n + 1,
    up: agg.up + (call.lean === "UP" ? 1 : 0),
    down: agg.down + (call.lean === "DOWN" ? 1 : 0),
    sum_entry: agg.sum_entry + call.entry_cents,
  };
}

export function splitOf(agg: Agg): RackSplit | null {
  if (!agg.n) return null;
  const up_pct = Math.round((100 * agg.up) / agg.n);
  return { up_pct, down_pct: 100 - up_pct, avg_paper_cents: Math.round((agg.sum_entry / agg.n) * 10) / 10 };
}

const S: { agg: Agg | null; aggInflight: Promise<Agg> | null; chair: string | null; chairAt: number; week: { ranks: string[]; at: number } | null; weekInflight: Promise<string[]> | null } = {
  agg: null,
  aggInflight: null,
  chair: null,
  chairAt: 0,
  week: null,
  weekInflight: null,
};

async function aggFor(ticker: string): Promise<Agg> {
  const cur = S.agg;
  if (cur && cur.ticker === ticker && Date.now() - cur.at < AGG_FRESH_MS) return cur;
  if (!S.aggInflight) {
    S.aggInflight = (async () => {
      const db = await sql();
      const [r] = await db<{ n: number; up: number; down: number; sum_entry: number }>`
        select count(*)::int as n,
               count(*) filter (where lean = 'UP')::int as up,
               count(*) filter (where lean = 'DOWN')::int as down,
               coalesce(sum(entry_cents), 0)::float as sum_entry
          from desk_human_calls
         where ticker = ${ticker}
      `;
      const agg: Agg = { ticker, n: r?.n ?? 0, up: r?.up ?? 0, down: r?.down ?? 0, sum_entry: r?.sum_entry ?? 0, at: Date.now() };
      S.agg = agg;
      return agg;
    })().finally(() => {
      S.aggInflight = null;
    });
  }
  return S.aggInflight;
}

/** Forget the cached aggregate and week ranks (after an admin reset). */
export function resetPitCaches(): void {
  S.agg = null;
  S.week = null;
}

/** Bump the cached aggregate the moment a lock lands, so the locker's own rack is exact. */
export function noteLock(call: Pick<HumanCall, "ticker" | "lean" | "entry_cents">): void {
  if (S.agg && S.agg.ticker === call.ticker) S.agg = applyLock(S.agg, call);
}

async function weekRanks(): Promise<string[]> {
  if (S.week && Date.now() - S.week.at < WEEK_FRESH_MS) return S.week.ranks;
  if (!S.weekInflight) {
    S.weekInflight = (async () => {
      const db = await sql();
      const rows = await db<{ token: string }>`
        select token
          from desk_human_calls
         where winner is not null and close_time > now() - interval '7 days'
         group by token
        having count(*) >= ${RANK_MIN_N}
         order by sum(cents) desc, count(*) desc
         limit 25
      `;
      const ranks = rows.map((r) => r.token);
      S.week = { ranks, at: Date.now() };
      return ranks;
    })().finally(() => {
      S.weekInflight = null;
    });
  }
  return S.weekInflight;
}

async function chairLine(): Promise<string | null> {
  if (Date.now() - S.chairAt < AGG_FRESH_MS) return S.chair;
  try {
    const { getServerFrame } = await import("./server-engine");
    const f = await getServerFrame();
    const c = f.chair;
    if (!c) S.chair = null;
    else if (c.lean === "UP" || c.lean === "DOWN") {
      const ask = c.lean === "UP" ? f.snap?.yes_ask : f.snap?.no_ask;
      S.chair = `SATOSHI: ${c.lean}${ask && ask > 0 ? ` @ ${ask.toFixed(0)}¢` : ""} · conf ${Math.round(c.confidence)}`;
    } else S.chair = "SATOSHI: WAIT";
  } catch {
    S.chair = null;
  }
  S.chairAt = Date.now();
  return S.chair;
}

async function currentWindow(): Promise<RackWindow | null> {
  const { getServerSnap, getPulse } = await import("./server-engine");
  const snap = getServerSnap();
  if (!snap || !snap.ticker || !(snap.close_time > 0)) return null;
  const now = Date.now();
  const pulse = getPulse();
  const fresh = pulse && !pulse.stale && pulse.ticker === snap.ticker && now - pulse.as_of < PULSE_FRESH_MS ? pulse : null;
  const yes_bid = fresh?.yes_bid ?? snap.yes_bid;
  const yes_ask = fresh?.yes_ask ?? snap.yes_ask;
  const no_bid = fresh?.no_bid ?? snap.no_bid;
  const no_ask = fresh?.no_ask ?? snap.no_ask;
  const strike = (fresh?.strike ?? snap.strike) > 0 ? (fresh?.strike ?? snap.strike) : null;
  return {
    ticker: snap.ticker,
    close_time: new Date(fresh?.close_time && fresh.close_time > 0 ? fresh.close_time : snap.close_time).toISOString(),
    strike,
    yes_bid,
    yes_ask,
    no_bid,
    no_ask,
    mid: yes_bid > 0 && yes_ask > 0 ? Math.round(((yes_bid + yes_ask) / 2) * 10) / 10 : null,
    stale: !fresh && snap.quote_age_s > 20,
  };
}


/** The rack for one watcher. Cheap: the aggregate and the chair line come from memory. */
export async function rackFor(tokenRaw: unknown): Promise<Rack> {
  const token = typeof tokenRaw === "string" && TOKEN_RE.test(tokenRaw.trim()) ? tokenRaw.trim() : null;
  const window = await currentWindow();
  const [agg, chair] = await Promise.all([window ? aggFor(window.ticker) : Promise.resolve(null), chairLine()]);
  let mine: HumanCall | null = null;
  let last: HumanCall | null = null;
  let last_settle: Rack["last_settle"] = null;
  let me: RackMe | null = null;
  if (token) {
    const db = await sql();
    const [recent, tot, ranks] = await Promise.all([
      db<HumanCall>`
        select ticker, close_time::text as close_time, lean, conf, entry_cents, fee, mins_left, t::text as t, winner, cents
          from desk_human_calls
         where token = ${token} and close_time > now() - (${LAST_LOOKBACK_H} || ' hours')::interval
         order by close_time desc
         limit 1
      `,
      db<{ name: string; hidden_at: Date | string | null; n: number; wins: number; losses: number; net: number }>`
        select p.name, p.hidden_at,
               count(c.id) filter (where c.winner is not null)::int as n,
               count(c.id) filter (where c.cents > 0)::int as wins,
               count(c.id) filter (where c.winner is not null and c.cents <= 0)::int as losses,
               coalesce(sum(c.cents), 0)::float as net
          from desk_players p left join desk_human_calls c using (token)
         where p.token = ${token}
         group by p.name, p.hidden_at
      `,
      weekRanks(),
    ]);
    const r = recent[0] ?? null;
    if (r && window && r.ticker === window.ticker) mine = r;
    else if (r) last = r;
    if (last && last.winner != null) {
      const [st] = await db<{ value: number | null; settle_avg: number | null; strike: number | null }>`
        -- BOTH halves, on both sides: the lock names the window it was taken on, so
        -- the ledger row and the replay's strike come from THAT close -- never from
        -- another window that happens to share the ticker.
        select l.official_value as value, l.settle_avg, r.strike
          from desk_ledger_research l
          left join desk_replay r on r.ticker = l.ticker and r.close_time = l.close_time
         where l.ticker = ${last.ticker} and l.close_time = ${last.close_time}
         limit 1
      `;
      last_settle = st ? { value: st.value ?? st.settle_avg, strike: st.strike } : null;
    }
    const t = tot[0];
    if (t) {
      const rank = ranks.indexOf(token) + 1;
      me = { name: publicLabel(t.name, { hidden: t.hidden_at != null }), n: t.n, wins: t.wins, losses: t.losses, net: Math.round(t.net * 10) / 10, rank_week: rank || null, players_week: ranks.length };
    }
  }
  return {
    window,
    n_locked: agg?.n ?? 0,
    split: mine && agg ? splitOf(agg) : null,
    mine,
    last,
    last_settle,
    chair,
    me,
    at: Date.now(),
  };
}
