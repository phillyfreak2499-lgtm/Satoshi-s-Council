/**
 * The desk's books (server only): what the chair's paper calls have made
 * or lost, window by window, straight from the ledger. Read-only. A call
 * is the chair's first booked side for a window at the ask it paid; ev is
 * settle minus entry minus the taker fee, so every number here is after
 * fees. Times are grouped in Chicago, the floor's clock.
 */
async function sql() {
  const { getSql } = await import("@/lib/db");
  return getSql();
}

export type BooksCall = {
  /** Side booked; null when the ledger only knows a cut price. */
  lean: "UP" | "DOWN" | null;
  entry: number;
  settle: number | null;
  ev: number | null;
};

export type BooksWindow = {
  ticker: string;
  close_time: string;
  winner: "UP" | "DOWN";
  official: number | null;
  settle_avg: number | null;
  prints: number | null;
  call: BooksCall | null;
  /** Seats that spoke a direction at the grade frame, and how many were right. */
  seats: { n: number; right: number };
  /** Every directional read including gagged ones, and how many were right. */
  raw: { n: number; right: number };
  /** Human calls on this window from the Arena. */
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

type LedgerRow = {
  ticker: string;
  close_time: Date | string;
  winner: string;
  official_value: number | null;
  settle_avg: number | null;
  brti_prints: number | null;
  entry_cents: number | null;
  settle_cents: number | null;
  ev_cents: number | null;
  seats: Record<string, { lean?: string; hit?: boolean | null; raw_lean?: string }> | null;
};

function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function toWindow(r: LedgerRow, arena: Map<string, { n: number; net: number }>): BooksWindow {
  const winner: "UP" | "DOWN" = r.winner === "UP" ? "UP" : "DOWN";
  let call: BooksCall | null = null;
  if (r.entry_cents != null) {
    const lean = r.settle_cents === 100 ? winner : r.settle_cents === 0 ? (winner === "UP" ? "DOWN" : "UP") : null;
    call = { lean, entry: r.entry_cents, settle: r.settle_cents, ev: r.ev_cents };
  }
  let sn = 0;
  let sr = 0;
  let rn = 0;
  let rr = 0;
  for (const v of Object.values(r.seats ?? {})) {
    if (!v || typeof v !== "object") continue;
    if (v.hit === true || v.hit === false) {
      sn++;
      if (v.hit) sr++;
    }
    const raw = v.raw_lean ?? v.lean;
    if (raw === "UP" || raw === "DOWN") {
      rn++;
      if (raw === winner) rr++;
    }
  }
  return {
    ticker: r.ticker,
    close_time: iso(r.close_time),
    winner,
    official: r.official_value,
    settle_avg: r.settle_avg,
    prints: r.brti_prints,
    call,
    seats: { n: sn, right: sr },
    raw: { n: rn, right: rr },
    arena: arena.get(r.ticker) ?? null,
  };
}

const EMPTY: BooksTotals = { n: 0, calls: 0, wins: 0, net: 0, ups: 0 };

let cache: { at: number; body: Books } | null = null;
let inflight: Promise<Books> | null = null;

/** The books. Cached 30s; the tab polls once a minute while open. */
export async function booksSummary(): Promise<Books> {
  if (cache && Date.now() - cache.at < 30_000) return cache.body;
  if (!inflight) {
    inflight = build()
      .then((body) => {
        cache = { at: Date.now(), body };
        return body;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

async function build(): Promise<Books> {
  const db = await sql();
  const [tot] = await db<Record<string, number>>`
    with base as (
      select ev_cents, entry_cents, winner,
        (close_time at time zone 'America/Chicago')::date = (now() at time zone 'America/Chicago')::date as today,
        close_time > now() - interval '7 days' as week
      from desk_ledger
    )
    select
      count(*)::int as n_all,
      (count(*) filter (where entry_cents is not null))::int as calls_all,
      (count(*) filter (where entry_cents is not null and ev_cents > 0))::int as wins_all,
      coalesce(sum(ev_cents), 0)::float as net_all,
      (count(*) filter (where winner = 'UP'))::int as ups_all,
      (count(*) filter (where week))::int as n_week,
      (count(*) filter (where week and entry_cents is not null))::int as calls_week,
      (count(*) filter (where week and entry_cents is not null and ev_cents > 0))::int as wins_week,
      coalesce(sum(ev_cents) filter (where week), 0)::float as net_week,
      (count(*) filter (where week and winner = 'UP'))::int as ups_week,
      (count(*) filter (where today))::int as n_today,
      (count(*) filter (where today and entry_cents is not null))::int as calls_today,
      (count(*) filter (where today and entry_cents is not null and ev_cents > 0))::int as wins_today,
      coalesce(sum(ev_cents) filter (where today), 0)::float as net_today,
      (count(*) filter (where today and winner = 'UP'))::int as ups_today
    from base
  `;
  const pick = (k: "all" | "week" | "today"): BooksTotals =>
    tot
      ? {
          n: tot[`n_${k}`] ?? 0,
          calls: tot[`calls_${k}`] ?? 0,
          wins: tot[`wins_${k}`] ?? 0,
          net: Math.round((tot[`net_${k}`] ?? 0) * 10) / 10,
          ups: tot[`ups_${k}`] ?? 0,
        }
      : EMPTY;

  const days = await db<BooksDay>`
    select to_char((close_time at time zone 'America/Chicago')::date, 'YYYY-MM-DD') as day,
      count(*)::int as n,
      (count(*) filter (where entry_cents is not null))::int as calls,
      (count(*) filter (where entry_cents is not null and ev_cents > 0))::int as wins,
      coalesce(sum(ev_cents), 0)::float as net
    from desk_ledger
    where close_time > now() - interval '14 days'
    group by 1 order by 1
  `;

  const curveRows = await db<{ t: Date | string; ev: number }>`
    select close_time as t, ev_cents::float as ev
    from desk_ledger
    where ev_cents is not null and close_time > now() - interval '14 days'
    order by close_time
  `;
  let cum = 0;
  const curve: BooksPoint[] = curveRows.map((r) => {
    cum = Math.round((cum + r.ev) * 10) / 10;
    return { t: iso(r.t), ev: r.ev, cum };
  });

  const bucketRows = await db<{ b: number; n: number; wins: number; avg_entry: number; net: number }>`
    select least(9, greatest(0, floor(entry_cents / 10)))::int as b,
      count(*)::int as n,
      (count(*) filter (where ev_cents > 0))::int as wins,
      avg(entry_cents)::float as avg_entry,
      coalesce(sum(ev_cents), 0)::float as net
    from desk_ledger
    where entry_cents is not null
    group by 1 order by 1
  `;
  // Under 50¢ is one shelf (the chair rarely buys the cheap side); 90¢ and up is another.
  const shelf = (b: number) => (b < 5 ? 0 : b > 8 ? 9 : b);
  const byShelf = new Map<number, BooksBucket>();
  for (const r of bucketRows) {
    const s = shelf(r.b);
    const cur = byShelf.get(s) ?? { lo: s === 0 ? 0 : s * 10, hi: s === 0 ? 50 : s === 9 ? 100 : s * 10 + 10, n: 0, wins: 0, avg_entry: 0, net: 0 };
    const n = cur.n + r.n;
    cur.avg_entry = n ? (cur.avg_entry * cur.n + r.avg_entry * r.n) / n : 0;
    cur.n = n;
    cur.wins += r.wins;
    cur.net = Math.round((cur.net + r.net) * 10) / 10;
    byShelf.set(s, cur);
  }
  const buckets = [...byShelf.values()].sort((a, b) => a.lo - b.lo);

  const heat = await db<BooksHeatCell>`
    select extract(dow from close_time at time zone 'America/Chicago')::int as dow,
      extract(hour from close_time at time zone 'America/Chicago')::int as hour,
      count(*)::int as n,
      (count(*) filter (where entry_cents is not null))::int as calls,
      (count(*) filter (where entry_cents is not null and ev_cents > 0))::int as wins,
      coalesce(sum(ev_cents), 0)::float as net
    from desk_ledger
    group by 1, 2
  `;

  const rows = await db<LedgerRow>`
    select ticker, close_time, winner, official_value, settle_avg, brti_prints,
      entry_cents, settle_cents, ev_cents, seats
    from desk_ledger
    order by close_time desc
    limit 40
  `;
  const arena = new Map<string, { n: number; net: number }>();
  if (rows.length) {
    const oldest = iso(rows[rows.length - 1].close_time);
    try {
      const hc = await db<{ ticker: string; n: number; net: number }>`
        select ticker, count(*)::int as n, coalesce(sum(cents), 0)::float as net
        from desk_human_calls
        where close_time >= ${oldest}::timestamptz
        group by 1
      `;
      for (const h of hc) arena.set(h.ticker, { n: h.n, net: Math.round(h.net * 10) / 10 });
    } catch {
      /* arena tables not migrated yet: the books still read */
    }
  }
  const windows = rows.map((r) => toWindow(r, arena));

  return {
    last: windows[0] ?? null,
    today: pick("today"),
    week: pick("week"),
    all: pick("all"),
    days: days.map((d) => ({ ...d, net: Math.round(d.net * 10) / 10 })),
    curve,
    buckets,
    heat: heat.map((h) => ({ ...h, net: Math.round(h.net * 10) / 10 })),
    windows,
    at: Date.now(),
  };
}
