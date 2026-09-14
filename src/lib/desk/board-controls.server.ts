import { createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import type { Sql } from "@/lib/db";

const localSalt = randomBytes(32).toString("hex");

/** Use the last proxy-appended address, not a visitor-supplied leading address. */
export function boardNetworkKey(forwarded: string | undefined, secret: string): string {
  const address = forwarded?.split(",").at(-1)?.trim().toLowerCase() ?? "";
  // Without a usable trusted address, share a strict bucket rather than bypassing it.
  const network = isIP(address) ? address : "unknown-network";
  return createHmac("sha256", secret).update(network).digest("hex");
}

export async function requestNetworkKey(): Promise<string> {
  const { getRequestHeader } = await import("@tanstack/react-start/server");
  return boardNetworkKey(getRequestHeader("x-forwarded-for"), process.env.DESK_ADMIN_KEY || localSalt);
}

/** One atomic reservation: concurrent requests and name changes cannot reset it. */
export async function reserveBoardPost(sql: Sql, networkKey: string): Promise<void> {
  const rows = await sql<{ network_key: string }>`
    insert into board_rate_limits (network_key, window_start, last_post_at, posts)
    values (${networkKey}, now(), now(), 1)
    on conflict (network_key) do update set
      window_start = case when board_rate_limits.window_start <= now() - interval '1 hour' then now() else board_rate_limits.window_start end,
      posts = case when board_rate_limits.window_start <= now() - interval '1 hour' then 1 else board_rate_limits.posts + 1 end,
      last_post_at = now()
    where board_rate_limits.last_post_at <= now() - interval '30 seconds'
      and (board_rate_limits.window_start <= now() - interval '1 hour' or board_rate_limits.posts < 10)
    returning network_key
  `;
  if (!rows.length) throw new Error("Please wait 30 seconds between posts. A network can post up to 10 messages per hour.");
  // Bounded retention for one-way network keys; no raw addresses are stored.
  await sql`delete from board_rate_limits where last_post_at < now() - interval '7 days'`;
}

export async function setBoardVisibility(sql: Sql, id: number, hidden: boolean, reason: string): Promise<void> {
  const rows = await sql<{ board_id: number }>`
    with changed as (
      update board set hidden = ${hidden}, moderation_reason = ${reason}
      where id = ${id} and hidden is distinct from ${hidden}
      returning id
    )
    insert into board_moderation_log (board_id, hidden, reason)
    select id, ${hidden}, ${reason} from changed
    returning board_id
  `;
  if (!rows.length) throw new Error("That post is gone or already has this visibility. Refresh the moderation list.");
}
