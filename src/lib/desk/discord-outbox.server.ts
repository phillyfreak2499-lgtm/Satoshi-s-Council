import type { Sql } from "@/lib/db";
import { postDiscord, settlementEvent, type DiscordEvent, type DiscordPayload, type PostResult } from "./discord-posts";
export type DiscordConfig = { build: string; paper: { url: string; hash: string } | null; read: { url: string; hash: string } | null };
type Row = {
  event_key: string; kind: DiscordEvent["kind"]; ticker: string; close_time: string; seat: string;
  side: "UP" | "DOWN"; source: string | null; observed_at: string; build_sha: string; target_hash: string;
  payload: DiscordPayload; expires_at: string; attempts: number;
};
const eventOf = (r: Row): DiscordEvent => ({ key: r.event_key, kind: r.kind, ticker: r.ticker, close: new Date(r.close_time).getTime(),
  seat: r.seat, side: r.side, source: r.source, observed: new Date(r.observed_at).getTime(), build: r.build_sha,
  target: r.target_hash, payload: r.payload, expires: new Date(r.expires_at).getTime() });
/** SQL queue and provider I/O run downstream, never awaited by the desk. */
export class DiscordOutbox {
  private busy = false;
  constructor(private db: Sql, private config: DiscordConfig, private ready: () => Promise<boolean>,
    private now = Date.now, private post: typeof postDiscord = postDiscord,
    private log: (code: string) => void = (code) => console.error(`Discord delivery: ${code}`)) {}
  private async released(observed?: number): Promise<boolean> {
    if (!/^[a-f0-9]{40}$/.test(this.config.build) || !(await this.ready())) return false;
    if (observed == null) return true;
    const rows = await this.db`select build_sha from desk_alert_rollout where build_sha=${this.config.build} and released_at<=${new Date(observed)}`;
    return rows.length > 0;
  }
  async enqueue(event: DiscordEvent): Promise<void> {
    const target = event.kind === "read" ? this.config.read : this.config.paper;
    if (!target || target.hash !== event.target) return;
    const released = event.build === this.config.build && await this.released(event.observed);
    // Cursor advancement and event insertion are atomic, including neutral resets.
    if (event.kind === "read") {
      await this.db`with changed as (
        insert into desk_discord_read_state(ticker,close_time,seat,target_hash,signature,observed_at)
        values (${event.ticker},${new Date(event.close)},${event.seat},${event.target},${event.signature ?? ""},${new Date(event.observed)})
        on conflict(ticker,close_time,seat,target_hash) do update set signature=excluded.signature,observed_at=excluded.observed_at
        where desk_discord_read_state.observed_at<excluded.observed_at and desk_discord_read_state.signature is distinct from excluded.signature
        returning ticker
      ) insert into desk_discord_outbox(event_key,kind,ticker,close_time,seat,side,source,observed_at,build_sha,target_hash,payload,state,expires_at)
        select ${event.key},'read',${event.ticker},${new Date(event.close)},${event.seat},${event.side},${event.source},
          ${new Date(event.observed)},${event.build},${event.target},${JSON.stringify(event.payload)}::jsonb,
          ${released ? "pending" : "held"},${new Date(event.expires)} from changed where not ${event.quiet === true}
        on conflict do nothing`;
    } else {
      await this.db`insert into desk_discord_outbox(event_key,kind,ticker,close_time,seat,side,source,observed_at,build_sha,target_hash,payload,state,expires_at,parent_key)
        values (${event.key},${event.kind},${event.ticker},${new Date(event.close)},${event.seat},${event.side},${event.source},
          ${new Date(event.observed)},${event.build},${event.target},${JSON.stringify(event.payload)}::jsonb,
          ${released ? "pending" : "held"},${new Date(event.expires)},${event.parent ?? null}) on conflict do nothing`;
    }
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
        await this.db`update desk_discord_outbox set state='held',lease_until=null,error_code='rollout_held' where state='pending'`;
        return;
      }
      // No stale directional/paper replay or rerouting after a deploy or URL rotation.
      await this.db`update desk_discord_outbox set state='held',error_code='build_or_destination_changed'
        where state='pending' and (build_sha<>${this.config.build} or target_hash not in (${this.config.paper?.hash ?? ""},${this.config.read?.hash ?? ""}))`;
      await this.db`update desk_discord_outbox set state='expired',lease_until=null where state='pending' and expires_at<=${new Date(now)}`;
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
        if (!target || row.target_hash !== target.hash || row.build_sha !== this.config.build || !(await this.released())) {
          await this.db`update desk_discord_outbox set state='held',lease_until=null where event_key=${row.event_key}`;
          continue;
        }
        const result: PostResult = await this.post(target.url, row.payload, row.attempts - 1);
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
