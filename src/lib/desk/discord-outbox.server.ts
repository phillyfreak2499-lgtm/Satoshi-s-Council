import type { Sql } from "@/lib/db";
import { latePayload, postDiscord, settlementEvent, READ_SUMMARY_PREFIX, type DiscordEvent, type DiscordPayload, type PostResult } from "./discord-posts";
export type DiscordConfig = { build: string; paper: { url: string; hash: string } | null; read: { url: string; hash: string } | null };
type Row = {
  event_key: string; kind: DiscordEvent["kind"]; ticker: string; close_time: string; seat: string;
  side: "UP" | "DOWN"; source: string | null; observed_at: string; build_sha: string; target_hash: string;
  payload: DiscordPayload; expires_at: string; attempts: number; parent_key?: string | null;
};
const eventOf = (r: Row): DiscordEvent => ({ key: r.event_key, kind: r.kind, ticker: r.ticker, close: new Date(r.close_time).getTime(),
  seat: r.seat, side: r.side, source: r.source, observed: new Date(r.observed_at).getTime(), build: r.build_sha,
  target: r.target_hash, payload: r.payload, expires: new Date(r.expires_at).getTime() });
/** SQL queue and provider I/O run downstream, never awaited by the desk.
 * `ready` is the owner-set durable Discord release (desk_discord_release), not the
 * per-commit web-push rollout: a new deploy does not re-hold Discord. */
export class DiscordOutbox {
  private busy = false;
  constructor(private db: Sql, private config: DiscordConfig, private ready: () => Promise<boolean>,
    private now = Date.now, private post: typeof postDiscord = postDiscord,
    private log: (code: string) => void = (code) => console.error(`Discord delivery: ${code}`)) {}
  private async released(observed?: number): Promise<boolean> {
    if (!/^[a-f0-9]{40}$/.test(this.config.build) || !(await this.ready())) return false;
    if (observed == null) return true;
    const rows = await this.db`select id from desk_discord_release where id=1 and released and released_at<=${new Date(observed)}`;
    return rows.length > 0;
  }
  /** Late = booked/graded before the current owner release, i.e. held then posted after it.
   * Derived from durable outbox + flag rows, so it survives restarts. Read-only lookups. */
  private async late(row: Row): Promise<DiscordPayload> {
    const parent = row.kind === "settle" && row.parent_key
      ? (await this.db<{ observed_at: string }>`select observed_at from desk_discord_outbox where event_key=${row.parent_key}`)[0] : undefined;
    const [l] = await this.db<{ winner: "UP" | "DOWN"; ev_cents: number }>`select winner,ev_cents from desk_ledger_research
      where ticker=${row.ticker} and close_time=${new Date(row.close_time)} and entry_lean=${row.side}
        and entry_source is not distinct from ${row.source} and winner in ('UP','DOWN') and ev_cents is not null limit 1`;
    return latePayload(row.payload, { kind: row.kind === "settle" ? "settle" : "paper", side: row.side,
      booked: new Date(parent?.observed_at ?? row.observed_at).getTime(), close: new Date(row.close_time).getTime(),
      posted: this.now(), outcome: l ? { winner: l.winner, net: Number(l.ev_cents) } : null });
  }
  async enqueue(event: DiscordEvent): Promise<void> {
    const target = event.kind === "read" ? this.config.read : this.config.paper;
    if (!target || target.hash !== event.target) return;
    // Only the per-window research summary is a read event; superseded per-seat
    // journal entries (pre-summary format) are dropped, never replayed.
    if (event.kind === "read" && !event.key.startsWith(READ_SUMMARY_PREFIX)) return;
    // Reads captured while held stay held (and are collapsed on release). A paper call is
    // judged against the current release so journal lag can never drop a booked call.
    const released = await this.released(event.kind === "read" ? event.observed : undefined);
    // Event key = window for reads, booked call for paper: one row each, ever.
    await this.db`insert into desk_discord_outbox(event_key,kind,ticker,close_time,seat,side,source,observed_at,build_sha,target_hash,payload,state,expires_at,parent_key)
      values (${event.key},${event.kind},${event.ticker},${new Date(event.close)},${event.seat},${event.side},${event.source},
        ${new Date(event.observed)},${event.build},${event.target},${JSON.stringify(event.payload)}::jsonb,
        ${released ? "pending" : "held"},${new Date(event.expires)},${event.parent ?? null}) on conflict do nothing`;
  }
  private async settlements() {
    if (!this.config.paper) return;
    // Exact window + source + recorded entry side. Invalid research rows are never announced.
    const rows = await this.db<Row & { winner: "UP" | "DOWN"; ev_cents: number; graded_at: string; scoreboard_wins: number; scoreboard_losses: number; scoreboard_net: number }>`
      select o.*,l.winner,l.ev_cents,l.graded_at, totals.scoreboard_wins, totals.scoreboard_losses, totals.scoreboard_net from desk_discord_outbox o
      join desk_ledger_research l on l.ticker=o.ticker and l.close_time=o.close_time
        and l.entry_lean=o.side and l.entry_source is not distinct from o.source
      cross join (
        -- Same all-time population and arithmetic as Books: valid ledger only,
        -- positive/negative recorded net defines wins/losses; pending and zero
        -- net entries count as neither. Actual stored fees are retained.
        -- One statement snapshot includes the settlement and excludes cache lag.
        select (count(*) filter (where entry_cents is not null and ev_cents < 0))::int as scoreboard_losses,
          (count(*) filter (where entry_cents is not null and ev_cents > 0))::int as scoreboard_wins,
          coalesce(sum(ev_cents), 0)::float as scoreboard_net
        from desk_ledger_research
      ) totals
      where o.kind='paper' and o.state='sent' and o.target_hash=${this.config.paper.hash}
        and l.winner in ('UP','DOWN') and l.ev_cents is not null
        and not exists(select 1 from desk_discord_outbox s where s.parent_key=o.event_key)
      order by l.graded_at limit 20`;
    for (const row of rows) {
      // Created now from an already-recorded settlement; timestamp stays the actual grade time.
      const e = settlementEvent(eventOf(row), row.winner, row.ev_cents, new Date(row.graded_at).getTime(), this.config.build,
        { wins: row.scoreboard_wins, losses: row.scoreboard_losses, net: row.scoreboard_net });
      // A held/restarted build may resume an earlier accepted fill's follow-up once released.
      // Use current release eligibility instead of treating an earlier grade time as a held capture.
      if (await this.released()) {
        await this.db`insert into desk_discord_outbox(event_key,kind,ticker,close_time,seat,side,source,observed_at,build_sha,target_hash,payload,state,expires_at,parent_key)
          values (${e.key},'settle',${e.ticker},${new Date(e.close)},${e.seat},${e.side},${e.source},${new Date(e.observed)},${e.build},${e.target},
            ${JSON.stringify(e.payload)}::jsonb,'pending',${new Date(e.expires)},${e.parent}) on conflict do nothing`;
      }
    }
  }
  async drain(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const now = this.now();
      if (!(await this.released())) {
        await this.db`update desk_discord_outbox set state='held',lease_until=null,error_code='discord_release_held' where state='pending'`;
        return;
      }
      // No rerouting after a URL rotation. A deploy alone no longer holds Discord; stale reads
      // still cannot replay because each expires at its own window close.
      await this.db`update desk_discord_outbox set state='held',error_code='destination_changed'
        where state='pending' and target_hash not in (${this.config.paper?.hash ?? ""},${this.config.read?.hash ?? ""})`;
      await this.db`update desk_discord_outbox set state='expired',lease_until=null where state='pending' and expires_at<=${new Date(now)}`;
      const [flag] = await this.db<{ released_at: string | null }>`select released_at from desk_discord_release where id=1 and released`;
      const releasedAt = flag?.released_at ? new Date(flag.released_at).getTime() : null;
      await this.settlements();
      for (let i = 0; i < 10; i++) {
        const time = this.now();
        const rows = await this.db<Row>`with candidate as (
          select o.event_key from desk_discord_outbox o left join desk_discord_destinations d on d.target_hash=o.target_hash
          where o.state='pending' and o.next_attempt<=${new Date(time)} and o.expires_at>${new Date(time)}
            and (o.lease_until is null or o.lease_until<${new Date(time)})
            and (d.target_hash is null or (not d.disabled and d.blocked_until<=${new Date(time)}))
          order by o.observed_at,o.event_key for update of o skip locked limit 1
        ) update desk_discord_outbox o set lease_until=${new Date(time + 60000)},attempts=attempts+1
          from candidate c where o.event_key=c.event_key returning o.*`;
        if (!rows.length) break;
        const row = rows[0]!;
        const target = row.kind === "read" ? this.config.read : this.config.paper;
        if (!target || row.target_hash !== target.hash || !(await this.released())) {
          await this.db`update desk_discord_outbox set state='held',lease_until=null where event_key=${row.event_key}`;
          continue;
        }
        // A held paper call/settlement posted after release is relabelled late; normal posts are untouched.
        const late = row.kind !== "read" && releasedAt != null && new Date(row.observed_at).getTime() < releasedAt;
        const result: PostResult = await this.post(target.url, late ? await this.late(row) : row.payload, row.attempts - 1);
        // Cooldowns are persisted and shared by both tiers, including global 429 responses.
        // Conservatively block both destinations: this also covers identical Discord bucket routing.
        for (const t of [this.config.paper, this.config.read]) {
          if (!t) continue;
          await this.db`insert into desk_discord_destinations(target_hash,blocked_until,disabled)
            values (${t.hash},${new Date(this.now() + result.retryMs)},${result.terminal && t.hash === target.hash})
            on conflict(target_hash) do update set blocked_until=greatest(desk_discord_destinations.blocked_until,excluded.blocked_until),
              disabled=desk_discord_destinations.disabled or excluded.disabled`;
        }
        const terminal = result.terminal || row.attempts >= 8;
        await this.db`update desk_discord_outbox set state=${result.ok ? "sent" : terminal ? "failed" : "pending"},
          lease_until=null,next_attempt=${new Date(this.now() + result.retryMs)},message_id=${result.message},last_status=${result.status},
          error_code=${result.code},delivered_at=${result.ok ? new Date(this.now()) : null} where event_key=${row.event_key}`;
        if (!result.ok) this.log(`${row.kind}:${result.code}:${result.status ?? "network"}`);
      }
    } catch { this.log("queue_failure"); } finally { this.busy = false; }
  }
}
