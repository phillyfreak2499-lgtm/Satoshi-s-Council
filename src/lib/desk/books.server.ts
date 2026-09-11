/**
 * The desk's books (server only): what the chair's paper calls have made
 * or lost, window by window, straight from the ledger. Read-only. A call
 * is the chair's first booked side for a window at the ask it paid; ev is
 * settle minus entry minus the taker fee, so every number here is after
 * fees. Breakeven is the win rate a set of calls needed to stand still,
 * worked from what its wins paid and its losses cost — for a call held to
 * settlement, the price paid plus the fee, in percent — and the record
 * splits at the 70¢ floor. Times are grouped in Chicago, the floor's clock.
 */
import { CHAIR_FLOOR_SINCE_ISO, FLOOR_LIVE_CENTS, FLOOR_LIVE_SINCE, FLOOR_SHADOW_CENTS } from "./book-floor";
import { bookedSideOf } from "./booked-side";
import { breakevenPct, mergeShelves, type Shelf, type ShelfRow } from "./books-math";

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
  /** A replay row exists for this window. */
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
export type BooksBucket = Shelf;
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

/**
 * KEEPER — the process scorecard. Not "did it win" (that is Totals) but "did it
 * play the way it says it does": how often it sits, how hard the calls that
 * filled cleared the bar, whether the fills honoured the 70¢ floor, and the
 * worst peak-to-trough the paper book has run (BLOT's drawdown). Straight from
 * the ledger, all after fees. Every call is graded at its own 15-minute close.
 */
export type KeeperStats = {
  /** Graded windows in the scope. */
  n: number;
  /** Share of windows the chair sat WAIT, 0–100. */
  wait_pct: number;
  /** Paper fills (a booked side at the ask). */
  booked: number;
  /** Win rate of the fills, 0–100; null with no fills. */
  hit_pct: number | null;
  /** Net cents after fees across the fills. */
  net: number;
  /** Worst peak-to-trough of the cumulative net, in cents (≤ 0). BLOT's drawdown. */
  max_dd: number;
  /** Average price paid on a fill, in cents; null with no fills. */
  avg_entry: number | null;
  /** Share of fills at or above the 70¢ floor, 0–100; null with no fills. */
  floor_pct: number | null;
  /** Average |score| / bar on the fills — how hard they cleared the confluence bar; null with no fills. */
  conf_ratio: number | null;
};
export type Keeper = { all: KeeperStats; week: KeeperStats };

/**
 * Why the scorecard is nullable. It used to answer a failed query with a zeroed
 * card, which reads on the page as "the chair sat 0% of 0 windows and booked
 * nothing" — a confident, wrong statement sitting next to totals showing a
 * hundred fills. A card that cannot be computed is now absent, so the page can
 * say it does not know instead of inventing a perfect record. Zeros from here
 * on mean an empty ledger and nothing else.
 */

/**
 * The 80¢ floor trial, both books on the same windows. `live` is the real paper
 * book at the new floor; `shadow` is what the old 70¢ floor would have made on
 * those same windows, from the ask captured live at decision time. Research
 * only: the shadow numbers are never added to any headline total.
 */
export type FloorTrial = {
  since: string;
  live_cents: number;
  shadow_cents: number;
  /** Windows closed since the trial began. */
  windows: number;
  live: BooksTotals;
  shadow: BooksTotals;
  /** Fills the live floor declined that the old floor would have taken. */
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
  lab: BooksLab | null;
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
  replay?: boolean;
};

function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function toWindow(r: LedgerRow, arena: Map<string, { n: number; net: number }>): BooksWindow {
  const winner: "UP" | "DOWN" = r.winner === "UP" ? "UP" : "DOWN";
  let call: BooksCall | null = null;
  if (r.entry_cents != null) {
    call = { lean: bookedSideOf(r.settle_cents, winner), entry: r.entry_cents, settle: r.settle_cents, ev: r.ev_cents };
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
    replay: r.replay === true,
  };
}

const EMPTY: BooksTotals = { n: 0, calls: 0, wins: 0, net: 0, ups: 0, breakeven: null };

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
  type PeriodRow = {
    period: string;
    n: number;
    calls: number;
    wins: number;
    net: number;
    ups: number;
    win_avg: number | null;
    loss_avg: number | null;
    cost_avg: number | null;
  };
  const periods = await db<PeriodRow>`
    with base as (
      select ev_cents, entry_cents, winner,
        ceil(0.07 * entry_cents * (100 - entry_cents) / 100.0) as fee,
        (close_time at time zone 'America/Chicago')::date = (now() at time zone 'America/Chicago')::date as today,
        close_time > now() - interval '7 days' as week,
        close_time >= ${CHAIR_FLOOR_SINCE_ISO}::timestamptz as floored
      from desk_ledger
    )
    select p.period,
      count(*)::int as n,
      (count(*) filter (where entry_cents is not null))::int as calls,
      (count(*) filter (where entry_cents is not null and ev_cents > 0))::int as wins,
      coalesce(sum(ev_cents), 0)::float as net,
      (count(*) filter (where winner = 'UP'))::int as ups,
      (avg(ev_cents) filter (where entry_cents is not null and ev_cents > 0))::float as win_avg,
      (avg(-ev_cents) filter (where entry_cents is not null and ev_cents < 0))::float as loss_avg,
      (avg(entry_cents + fee) filter (where entry_cents is not null))::float as cost_avg
    from base
    cross join (values ('all'), ('week'), ('floor'), ('today')) as p(period)
    where p.period = 'all'
      or (p.period = 'week' and week)
      or (p.period = 'floor' and floored)
      or (p.period = 'today' and today)
    group by 1
  `;
  const byPeriod = new Map(periods.map((r) => [r.period, r]));
  const pick = (k: "all" | "week" | "floor" | "today"): BooksTotals => {
    const r = byPeriod.get(k);
    if (!r) return EMPTY;
    const calls = Number(r.calls) || 0;
    const be = calls ? breakevenPct(num(r.win_avg), num(r.loss_avg), num(r.cost_avg)) : null;
    return {
      n: Number(r.n) || 0,
      calls,
      wins: Number(r.wins) || 0,
      net: round1(Number(r.net) || 0),
      ups: Number(r.ups) || 0,
      breakeven: be == null ? null : round1(be),
    };
  };

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

  const bucketRows = await db<ShelfRow>`
    select least(9, greatest(0, floor(entry_cents / 10)))::int as b,
      count(*)::int as n,
      (count(*) filter (where ev_cents > 0))::int as wins,
      (count(*) filter (where ev_cents < 0))::int as losses,
      avg(entry_cents)::float as avg_entry,
      (avg(ev_cents) filter (where ev_cents > 0))::float as win_avg,
      (avg(-ev_cents) filter (where ev_cents < 0))::float as loss_avg,
      avg(entry_cents + ceil(0.07 * entry_cents * (100 - entry_cents) / 100.0))::float as cost_avg,
      coalesce(sum(ev_cents), 0)::float as net
    from desk_ledger
    where entry_cents is not null
    group by 1 order by 1
  `;
  // Under 50¢ is one shelf (the chair rarely buys the cheap side); 90¢ and up is another.
  const buckets = mergeShelves(
    bucketRows.map((r) => ({
      b: Number(r.b) || 0,
      n: Number(r.n) || 0,
      wins: Number(r.wins) || 0,
      losses: Number(r.losses) || 0,
      avg_entry: Number(r.avg_entry) || 0,
      win_avg: num(r.win_avg),
      loss_avg: num(r.loss_avg),
      cost_avg: Number(r.cost_avg) || 0,
      net: Number(r.net) || 0,
    })),
  );

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
    select l.ticker, l.close_time, l.winner, l.official_value, l.settle_avg, l.brti_prints,
      l.entry_cents, l.settle_cents, l.ev_cents, l.seats,
      exists (select 1 from desk_replay r where r.ticker = l.ticker) as replay
    from desk_ledger l
    order by l.close_time desc
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
  const trial = await floorTrial(db);
  const keeper = await keeperCard(db);
  const lab = await labStudy(db);

  return {
    last: windows[0] ?? null,
    today: pick("today"),
    week: pick("week"),
    floor: pick("floor"),
    floor_since: CHAIR_FLOOR_SINCE_ISO,
    trial,
    all: pick("all"),
    keeper,
    keeper_error: keeper ? null : lastKeeperError,
    days: days.map((d) => ({ ...d, net: Math.round(d.net * 10) / 10 })),
    curve,
    buckets,
    heat: heat.map((h) => ({ ...h, net: Math.round(h.net * 10) / 10 })),
    windows,
    lab,
    at: Date.now(),
  };
}

/**
 * The 80¢ trial's two books. The live side reads the real fills; the shadow side
 * reads shadow_entry_cents / shadow_ev_cents, which the engine captured live at
 * decision time — the first ask each window at which the old floor would have
 * filled. Both are restricted to windows closing since the trial began, so the
 * comparison is on identical windows and nothing pre-trial leaks in.
 */
async function floorTrial(db: Awaited<ReturnType<typeof sql>>): Promise<FloorTrial | null> {
  try {
    const [r] = await db<Record<string, number | null>>`
      with t as (select * from desk_ledger where close_time >= ${FLOOR_LIVE_SINCE}::timestamptz)
      select
        count(*)::int as windows,
        (count(*) filter (where winner = 'UP'))::int as ups,
        (count(*) filter (where entry_cents is not null))::int as live_calls,
        (count(*) filter (where entry_cents is not null and ev_cents > 0))::int as live_wins,
        coalesce(sum(ev_cents) filter (where entry_cents is not null), 0)::float as live_net,
        (avg(entry_cents + ceil(0.07 * entry_cents * (100 - entry_cents) / 100.0))
          filter (where entry_cents is not null))::float as live_cost,
        (count(*) filter (where shadow_entry_cents is not null))::int as sh_calls,
        (count(*) filter (where shadow_entry_cents is not null and shadow_ev_cents > 0))::int as sh_wins,
        coalesce(sum(shadow_ev_cents) filter (where shadow_entry_cents is not null), 0)::float as sh_net,
        (avg(shadow_entry_cents + ceil(0.07 * shadow_entry_cents * (100 - shadow_entry_cents) / 100.0))
          filter (where shadow_entry_cents is not null))::float as sh_cost,
        (count(*) filter (where shadow_entry_cents is not null and entry_cents is null))::int as declined
      from t
    `;
    if (!r) return null;
    const windows = Number(r.windows) || 0;
    const ups = Number(r.ups) || 0;
    const side = (calls: number, wins: number, net: number, cost: number | null): BooksTotals => ({
      n: windows,
      calls,
      wins,
      net: round1(net),
      ups,
      breakeven: calls && cost != null ? round1(Number(cost)) : null,
    });
    return {
      since: FLOOR_LIVE_SINCE,
      live_cents: FLOOR_LIVE_CENTS,
      shadow_cents: FLOOR_SHADOW_CENTS,
      windows,
      live: side(Number(r.live_calls) || 0, Number(r.live_wins) || 0, Number(r.live_net) || 0, num(r.live_cost)),
      shadow: side(Number(r.sh_calls) || 0, Number(r.sh_wins) || 0, Number(r.sh_net) || 0, num(r.sh_cost)),
      declined: Number(r.declined) || 0,
    };
  } catch {
    /* the shadow columns are not migrated yet: the books still read */
    return null;
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** A nullable numeric column as the driver hands it back (number, string or null). */
function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const EMPTY_KEEPER: KeeperStats = { n: 0, wait_pct: 0, booked: 0, hit_pct: null, net: 0, max_dd: 0, avg_entry: null, floor_pct: null, conf_ratio: null };

/** The process scorecard plus BLOT's drawdown, both scopes, straight from the ledger. */
async function keeperCard(db: Awaited<ReturnType<typeof sql>>): Promise<Keeper | null> {
  try {
    const [k] = await db<Record<string, number | null>>`
      with base as (select *, close_time > now() - interval '7 days' as week from desk_ledger)
      select
        count(*)::int as n_all,
        (count(*) filter (where entry_cents is null))::int as wait_all,
        (count(*) filter (where entry_cents is not null))::int as booked_all,
        (count(*) filter (where entry_cents is not null and ev_cents > 0))::int as wins_all,
        coalesce(sum(ev_cents), 0)::float as net_all,
        (avg(entry_cents) filter (where entry_cents is not null))::float as entry_all,
        (count(*) filter (
          where entry_cents is not null
            and entry_cents >= (case
              when close_time >= ${FLOOR_LIVE_SINCE}::timestamptz then ${FLOOR_LIVE_CENTS}::float
              else ${FLOOR_SHADOW_CENTS}::float
            end)
        ))::int as floor_all,
        (avg(abs(score) / nullif(bar, 0)) filter (where entry_cents is not null))::float as conf_all,
        (count(*) filter (where week))::int as n_week,
        (count(*) filter (where week and entry_cents is null))::int as wait_week,
        (count(*) filter (where week and entry_cents is not null))::int as booked_week,
        (count(*) filter (where week and entry_cents is not null and ev_cents > 0))::int as wins_week,
        coalesce(sum(ev_cents) filter (where week), 0)::float as net_week,
        (avg(entry_cents) filter (where week and entry_cents is not null))::float as entry_week,
        (count(*) filter (
          where week and entry_cents is not null
            and entry_cents >= (case
              when close_time >= ${FLOOR_LIVE_SINCE}::timestamptz then ${FLOOR_LIVE_CENTS}::float
              else ${FLOOR_SHADOW_CENTS}::float
            end)
        ))::int as floor_week,
        (avg(abs(score) / nullif(bar, 0)) filter (where week and entry_cents is not null))::float as conf_week
      from base
    `;
    const [ddAll] = await db<{ max_dd: number }>`
      with c as (select close_time, id, sum(ev_cents) over (order by close_time, id) as cum
                 from desk_ledger where ev_cents is not null)
      select coalesce(min(cum - peak), 0)::float as max_dd
      from (select cum, max(cum) over (order by close_time, id) as peak from c) x
    `;
    const [ddWeek] = await db<{ max_dd: number }>`
      with c as (select close_time, id, sum(ev_cents) over (order by close_time, id) as cum
                 from desk_ledger where ev_cents is not null and close_time > now() - interval '7 days')
      select coalesce(min(cum - peak), 0)::float as max_dd
      from (select cum, max(cum) over (order by close_time, id) as peak from c) x
    `;
    if (!k) return { all: EMPTY_KEEPER, week: EMPTY_KEEPER };
    const stat = (s: "all" | "week", dd: number): KeeperStats => {
      const n = Number(k[`n_${s}`]) || 0;
      const booked = Number(k[`booked_${s}`]) || 0;
      const wins = Number(k[`wins_${s}`]) || 0;
      const floor = Number(k[`floor_${s}`]) || 0;
      const entry = k[`entry_${s}`];
      const conf = k[`conf_${s}`];
      return {
        n,
        wait_pct: n ? Math.round((100 * (Number(k[`wait_${s}`]) || 0)) / n) : 0,
        booked,
        hit_pct: booked ? Math.round((100 * wins) / booked) : null,
        net: round1(Number(k[`net_${s}`]) || 0),
        max_dd: round1(dd || 0),
        avg_entry: booked && entry != null ? round1(Number(entry)) : null,
        floor_pct: booked ? Math.round((100 * floor) / booked) : null,
        conf_ratio: booked && conf != null ? Math.round(Number(conf) * 100) / 100 : null,
      };
    };
    return { all: stat("all", Number(ddAll?.max_dd) || 0), week: stat("week", Number(ddWeek?.max_dd) || 0) };
  } catch (err) {
    // Absent, not zeroed: the page must not report discipline it cannot measure.
    // /books is public, so the reason is a short hint, not a raw database dump.
    lastKeeperError = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").trim().slice(0, 140);
    return null;
  }
}

/** The reason the scorecard is missing, surfaced so a silent break cannot hide again. */
let lastKeeperError: string | null = null;

/** One trade per window from desk_lag_events: the first fillable shock (still there 200 ms later) that settled. */
async function labStudy(db: Awaited<ReturnType<typeof sql>>): Promise<BooksLab | null> {
  try {
    const [r] = await db<Record<string, number | string | null>>`
      with ev as (
        select ticker, t, final_minute, ask_before, net_edge, realized, gone_ms,
               row_number() over (partition by ticker order by t) as rn_all,
               row_number() over (partition by ticker, final_minute order by t) as rn_fm
        from desk_lag_events
        where winner is not null and fill_200
      ),
      fa as (select * from ev where rn_all = 1),
      ff as (select * from ev where final_minute and rn_fm = 1)
      select
        (select count(*)::int from ev) as shocks,
        (select count(distinct ticker)::int from ev) as windows,
        (select min(t) from ev) as since,
        (select round(avg(gone_ms))::int from ev) as stale_ms,
        (select count(*)::int from fa) as fa_n,
        (select coalesce(avg(realized), 0)::float from fa) as fa_avg,
        (select coalesce(sum(realized), 0)::float from fa) as fa_sum,
        (select (count(*) filter (where realized > 0))::int from fa) as fa_pos,
        (select count(*)::int from ff) as ff_n,
        (select coalesce(avg(realized), 0)::float from ff) as ff_avg,
        (select coalesce(sum(realized), 0)::float from ff) as ff_sum,
        (select (count(*) filter (where realized > 0))::int from ff) as ff_pos,
        (select coalesce(avg(ask_before), 0)::float from ff) as ff_ask,
        (select coalesce(avg(net_edge), 0)::float from ff) as ff_claimed
    `;
    if (!r || !Number(r.windows)) return null;
    const line = (p: string): BooksLabLine => ({
      n: Number(r[`${p}_n`]) || 0,
      avg: round1(Number(r[`${p}_avg`]) || 0),
      sum: Math.round(Number(r[`${p}_sum`]) || 0),
      pos: Number(r[`${p}_pos`]) || 0,
    });
    return {
      windows: Number(r.windows) || 0,
      shocks: Number(r.shocks) || 0,
      since: r.since ? iso(r.since as Date | string) : null,
      stale_ms: r.stale_ms == null ? null : Number(r.stale_ms),
      first: line("fa"),
      final: { ...line("ff"), ask: round1(Number(r.ff_ask) || 0), claimed: round1(Number(r.ff_claimed) || 0) },
    };
  } catch {
    return null;
  }
}
