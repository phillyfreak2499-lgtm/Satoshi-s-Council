/** Owner-set Discord release. Durable across deploys and NOT keyed by build:
 * Discord no longer shares web push's per-commit two-tier rollout gate
 * (`rolloutReady`, which is unchanged and still required for web push).
 * No row, released=false or SQL failure => HELD. Authentication is at the route. */
import type { Sql } from "@/lib/db";

export type DiscordReleaseInput = { action?: unknown };

export async function discordReleased(db: Sql): Promise<boolean> {
  const rows = await db<{ released: boolean }>`select released from desk_discord_release where id=1`;
  return rows[0]?.released === true;
}

async function status(db: Sql) {
  const flag = await db<{ released: boolean; released_at: string | null; updated_at: string }>`
    select released,released_at,updated_at from desk_discord_release where id=1`;
  const queue = await db<{ kind: string; state: string; n: number }>`
    select kind,state,count(*)::int as n from desk_discord_outbox group by kind,state order by kind,state`;
  return { held: flag[0]?.released !== true, released_at: flag[0]?.released_at ?? null,
    updated_at: flag[0]?.updated_at ?? null, queue };
}

/** release: one statement sets the flag and settles the held backlog atomically.
 *  - held directional reads are expired (`collapsed_on_release`), never replayed;
 *  - held paper calls/settlements still inside their 24h expiry are re-queued once
 *    (one post per booked call, same event key, so no duplicates);
 *  - held paper rows already past expiry are expired.
 * hold: clears the flag; the worker re-holds anything pending on its next drain. */
export async function discordReleaseControl(db: Sql, input: DiscordReleaseInput, now = Date.now()) {
  const at = new Date(now);
  if (input.action === "status") return { ok: true as const, ...(await status(db)) };
  if (input.action === "hold") {
    await db`insert into desk_discord_release(id,released,released_at,updated_at) values (1,false,null,${at})
      on conflict(id) do update set released=false,released_at=null,updated_at=excluded.updated_at`;
    return { ok: true as const, ...(await status(db)) };
  }
  if (input.action === "release") {
    const [r] = await db<{ reads: number; requeued: number; expired: number }>`with flag as (
        insert into desk_discord_release(id,released,released_at,updated_at) values (1,true,${at},${at})
        on conflict(id) do update set released=true,updated_at=excluded.updated_at,
          released_at=coalesce(case when desk_discord_release.released then desk_discord_release.released_at end, excluded.released_at)
        returning id
      ), reads as (
        update desk_discord_outbox set state='expired',lease_until=null,error_code='collapsed_on_release'
        where state='held' and kind='read' returning 1
      ), requeued as (
        update desk_discord_outbox set state='pending',lease_until=null,next_attempt=${at},error_code=null
        where state='held' and kind<>'read' and expires_at>${at} returning 1
      ), expired as (
        update desk_discord_outbox set state='expired',lease_until=null,error_code='expired_while_held'
        where state='held' and kind<>'read' and expires_at<=${at} returning 1
      ) select (select count(*) from flag)::int as flag,(select count(*) from reads)::int as reads,
        (select count(*) from requeued)::int as requeued,(select count(*) from expired)::int as expired`;
    return { ok: true as const, ...(await status(db)),
      backlog: { reads_collapsed: r?.reads ?? 0, paper_requeued: r?.requeued ?? 0, paper_expired: r?.expired ?? 0 } };
  }
  return { ok: false as const, status: 400, error: "action must be status, release or hold" };
}
