/**
 * The week on the floor, posted once by DESK on Sunday morning (Chicago):
 * the seven days ending Saturday. Chair calls and cents after fees, reads
 * held under the floor, the sharpest and roughest seats on the week's
 * graded reads, the Arena's week and the lab's one-trade-per-window count.
 * Server only; the body is composed by a pure function so it can be tested.
 */
import { CHAIR_MIN_ASK_CENTS } from "./book-floor";

type Sql = Awaited<ReturnType<typeof getDb>>;
async function getDb() {
  const { getSql } = await import("@/lib/db");
  return getSql();
}

export type RecapInput = {
  from: string;
  to: string;
  windows: number;
  calls: number;
  wins: number;
  net: number;
  floored: number;
  seats: { id: string; n: number; hits: number }[];
  arena: { locks: number; players: number; net: number; top: { name: string; net: number; n: number } | null } | null;
  lab: { windows: number; avg: number; pos: number } | null;
};

const sign = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(0)}¢`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function recapBody(i: RecapInput): string {
  const bits = [`The week of ${i.from} to ${i.to} on the floor: ${i.windows} windows graded`];
  bits.push(
    i.calls
      ? `the chair booked ${plural(i.calls, "call")} (${i.wins}W/${i.calls - i.wins}L), net ${sign(i.net)} after fees`
      : "the chair booked nothing",
  );
  if (i.floored) bits.push(`${plural(i.floored, "read")} held under the ${CHAIR_MIN_ASK_CENTS}¢ floor`);
  const ranked = i.seats.filter((s) => s.n >= 10).sort((a, b) => b.hits / b.n - a.hits / a.n);
  if (ranked.length >= 2) {
    const best = ranked[0]!;
    const worst = ranked[ranked.length - 1]!;
    bits.push(`sharpest seat ${best.id} ${best.hits}/${best.n}, roughest ${worst.id} ${worst.hits}/${worst.n}`);
  }
  if (i.arena && i.arena.locks) {
    let a = `Arena: ${plural(i.arena.locks, "paper lock")} from ${plural(i.arena.players, "callsign")}, net ${sign(i.arena.net)}`;
    if (i.arena.top) a += `; top ${i.arena.top.name} ${sign(i.arena.top.net)} over ${i.arena.top.n}`;
    bits.push(a);
  }
  if (i.lab && i.lab.windows) {
    bits.push(
      `lab: the first stale ask per window made ${sign(i.lab.avg)} on average over ${i.lab.windows} windows, ${Math.round((100 * i.lab.pos) / i.lab.windows)}% positive`,
    );
  }
  return bits.join(" · ").slice(0, 700);
}

/** Yesterday (Chicago) as YYYY-MM-DD; the recap posts when that day was a Saturday. */
export function recapDue(yesterday: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(yesterday) && new Date(`${yesterday}T12:00:00Z`).getUTCDay() === 6;
}

/** Compose and post the recap once. Returns true when a post was made. */
export async function weeklyRecap(db: Sql, yesterday: string): Promise<boolean> {
  if (!recapDue(yesterday)) return false;
  const slug = `week-${yesterday}`;
  const have = await db`select 1 from board where slug = ${slug}`;
  if (have.length) return false;
  const [tot] = await db<{ windows: number; calls: number; wins: number; net: number; floored: number; from_day: string }>`
    select
      count(*)::int as windows,
      (count(*) filter (where entry_cents is not null))::int as calls,
      (count(*) filter (where entry_cents is not null and ev_cents > 0))::int as wins,
      coalesce(sum(ev_cents), 0)::float as net,
      (count(*) filter (where chair_lean in ('UP','DOWN') and entry_cents is null))::int as floored,
      to_char(${yesterday}::date - 6, 'YYYY-MM-DD') as from_day
    from desk_ledger
    where (close_time at time zone 'America/Chicago')::date between ${yesterday}::date - 6 and ${yesterday}::date
  `;
  if (!tot || !tot.windows) return false;
  const seatRows = await db<{ seats: Record<string, { hit?: boolean | null }> | null }>`
    select seats from desk_ledger
    where (close_time at time zone 'America/Chicago')::date between ${yesterday}::date - 6 and ${yesterday}::date
  `;
  const tally: Record<string, { n: number; hits: number }> = {};
  for (const row of seatRows) {
    if (!row.seats || typeof row.seats !== "object") continue;
    for (const [seat, s] of Object.entries(row.seats)) {
      if (s?.hit == null) continue;
      const t = (tally[seat] ??= { n: 0, hits: 0 });
      t.n += 1;
      t.hits += s.hit ? 1 : 0;
    }
  }
  const [ar] = await db<{ locks: number; players: number; net: number }>`
    select count(*)::int as locks, count(distinct token)::int as players, coalesce(sum(cents), 0)::float as net
    from desk_human_calls
    where winner is not null
      and (close_time at time zone 'America/Chicago')::date between ${yesterday}::date - 6 and ${yesterday}::date
  `;
  const [top] = await db<{ name: string; net: number; n: number }>`
    select p.name, sum(c.cents)::float as net, count(*)::int as n
    from desk_human_calls c join desk_players p on p.token = c.token
    where c.winner is not null
      and (c.close_time at time zone 'America/Chicago')::date between ${yesterday}::date - 6 and ${yesterday}::date
    group by p.name having count(*) >= 3 order by net desc limit 1
  `;
  const [lab] = await db<{ windows: number; avg: number; pos: number }>`
    with ev as (
      select ticker, t, realized, row_number() over (partition by ticker order by t) as rn
      from desk_lag_events
      where winner is not null and fill_200
        and (t at time zone 'America/Chicago')::date between ${yesterday}::date - 6 and ${yesterday}::date
    )
    select count(*)::int as windows, coalesce(avg(realized), 0)::float as avg, (count(*) filter (where realized > 0))::int as pos
    from ev where rn = 1
  `;
  const body = recapBody({
    from: tot.from_day,
    to: yesterday,
    windows: tot.windows,
    calls: tot.calls,
    wins: tot.wins,
    net: Number(tot.net) || 0,
    floored: tot.floored,
    seats: Object.entries(tally).map(([id, t]) => ({ id, ...t })),
    arena: ar ? { locks: ar.locks, players: ar.players, net: Number(ar.net) || 0, top: top ? { name: top.name, net: Number(top.net) || 0, n: top.n } : null } : null,
    lab: lab ? { windows: lab.windows, avg: Number(lab.avg) || 0, pos: lab.pos } : null,
  });
  await db`
    insert into board (who, body, kind, lean, ticker, conf, slug)
    values ('DESK', ${body}, 'update', '', '', 0, ${slug})
    on conflict (slug) do nothing
  `;
  return true;
}
