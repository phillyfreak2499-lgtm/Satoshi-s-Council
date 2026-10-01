# REQ-DISCORD-001 — outbound Discord publication

Draft only. Owner approves merge and deployment separately. No webhook has been configured and no live Discord message has been sent during preparation.

## Rollout decision

**Superseded (Discord release flag):** Discord no longer shares #387's per-commit web-push rollout gate. Because main auto-deploys, that gate re-held Discord on every merge. Discord now has its own durable owner-set release flag, `desk_discord_release` (migration `0072_discord_release.sql`, one row, no seed). No row or `released=false` means HELD, which is the default. The flag is not keyed by build, so it survives deploys. A missing/invalid `RENDER_GIT_COMMIT` or a SQL failure still keeps Discord held.

Web push is unchanged: `rolloutReady(db, RENDER_GIT_COMMIT)` still requires a `desk_alert_rollout` row for the exact deployed commit.

Owner control (admin key, same `adminKeyOk`/`DESK_ADMIN_KEY` pattern as the other owner routes):

```
curl -sS -X POST https://satoshiscouncil.com/api/discord-release \
  -H 'content-type: application/json' \
  -d '{"key":"<DESK_ADMIN_KEY>","action":"status"}'   # or "release" / "hold"
```

The release step also settles the held backlog in the same SQL statement:
- Every held directional read is marked `expired` with `error_code='collapsed_on_release'`. None is replayed.
- Held paper calls and settlements still inside their 24h expiry are re-queued once and posted once, keeping their original key and embed timestamp.
- Held paper rows already past expiry are marked `expired` (`expired_while_held`).

A held read captured before the release time stays held. A booked paper call is judged against the current flag, so journal lag cannot drop it. `hold` clears the flag, and the worker re-holds anything pending on its next drain. A destination (webhook) rotation still holds pending rows rather than rerouting them. A deploy by itself no longer holds anything.

## Configuration

Owner supplies these **server-side Render env vars**, never GitHub, source, browser code, or public settings:

- `DISCORD_PAPER_CALLS_WEBHOOK` — incoming webhook created in #paper-calls.
- `DISCORD_DIRECTIONAL_READS_WEBHOOK` — incoming webhook created in #directional-reads.

Use ordinary text channels. Only HTTPS `discord.com/api[/v10]/webhooks/{id}/{token}` is accepted, with no extra query, fragment, credentials, or port. `wait=true` is added by the poster. Distinct channels require distinct webhook URLs; configuring the same endpoint for both disables both. A missing URL disables that tier. Malformed configurations log only a generic code. Rotation starts a new target fingerprint; old queued events never move to the new target.

No bot token, Discord message reading, member access, gateway subscription, new hosted service, or third-party package is needed. Incremental API/AI fees: none; uses the existing deployment, data disk, and Postgres. Delivery/storage volume follows actual changed research leans and fills.

## Event semantics and exact copy examples

#paper-calls receives only recorded booked paper positions. Canonical seat is SATOSHI; an existing separately labeled RECOVERY_FAV85_V1 pilot is identified by its own source, never misrepresented as a Chair decision. Event identity includes ticker, exact close, source, and side. Existing entry/fee/booking gates are unchanged.

Example booked embed (green):

- **■ PAPER POSITION BOOKED · UP**
- “Recorded paper fill. No live trade.”
- Seat SATOSHI; Direction UP; Entry 83.0¢; Window closes (UTC) ISO timestamp; Window ticker.

Example settlement follow-up (green for win, red for loss):

- **■ PAPER POSITION SETTLED · WIN**
- “Follow-up to the recorded paper fill. Net P&L includes the book's actual fee.”
- Seat SATOSHI; Booked direction UP; Outcome UP; Net after fees +15.0¢; exact window close and ticker.

Settlements are separate follow-up embeds, not replies requiring a bot or reading an existing message. They are created only for a successfully delivered fill after an exact-window/source/entry-side match in `desk_ledger_research`. Net P&L is the stored `ev_cents`, never gross payout or a freshly assumed fee. Invalid research rows and windows without a delivered Discord fill produce no follow-up. Retry/restart does not normally repost an accepted event.

#directional-reads receives **at most one research-outlook summary per 15-minute Kalshi window**. The previous per-seat lean-change posts were superseded because they produced roughly 1,000 posts a day. The summary is taken on the first published frame with 10 minutes or less to close (`READ_SUMMARY_MS_LEFT`) that has at least one bullish or bearish seat lean. Its event key is `readwin|<ticker>|<close>`, so the outbox primary key keeps it to one row per window across ticks, restarts and workers. A window with no directional lean by close gets no post. The summary reuses `seatFacts` and `seatDirectionalLeans`, exactly as Guided/Pro do. Pre-summary per-seat events still in the disk journal are dropped, not replayed. The `desk_discord_read_state` cursor table is no longer written and is left in place (no drop).

Example research outlook embed (purple):

- **◇ RESEARCH OUTLOOK · SEAT LEANS**
- “Research only, one summary per 15-minute window. Seat leans are direction and intensity (0–100), not probabilities. Not a SATOSHI call and not a paper position. Paper-only desk: no real trades.”
- Research outlook · seat leans: `TAPE 71 · Bullish`, `DRIFT 35 · Bearish` (directional seats only, strongest first); Seat count; **SATOSHI decision · Chair**: `WAIT — SATOSHI is not making a call on this frame.` or `UP — the Chair's call on this frame. It is a paper position only if booked.`; **Paper position**: `None in this post. Booked paper calls post separately in the paper-calls channel, one post per booked call.`; Snapshot, window close and ticker.

Booked paper embeds also carry a **Decision** field: `SATOSHI decision (the Chair's call), booked as a paper position`, or for the pilot `RECOVERY_FAV85_V1 paper pilot, not a SATOSHI Chair decision`. Paper calls remain one post per booked call.

These are separate Discord payloads. #387's approved browser alert titles, messages, and badge assets are unchanged.

## Reliability and isolation

Event hooks only observe existing publication points. Booking/Chair/learner behavior is unchanged. A lazy adapter observes existing paper notification publication and the exact public-frame publication point, after snapshot/vote/Chair cache assignment. A failed provisional tick cannot announce its unpublished leans. Telemetry sampling/configuration is untouched. No provider or SQL work is awaited by the decision loop. Errors are caught and emit sanitized codes without URLs, exception text, or provider response bodies. Outage/watchdog alert path is unchanged.

A write-ahead journal on the existing data disk survives database outages. Migration 0070 adds **three new tables and one index only**: outbox, per-destination cooldown/disable state, and retained research publication cursor. It makes no ALTER, seed, update, delete, or change to any existing table. Cursor advancement and research event enqueue are atomic. Queue claims have leases and skip locked rows. SQL retries and provider attempts run every five seconds outside the desk loop.

Provider POST uses an eight-second timeout, no redirects, mentions disabled, and `wait=true` to require an accepted-message receipt. Network/5xx/429 retry with exponential backoff, at most eight delivery attempts; Discord retry/reset headers and `retry_after` determine longer waits. Cooldowns are durable and conservatively shared across both destinations, including global 429s. Permanent 4xx disables that target; rotate its webhook rather than repeatedly hammering a rejected endpoint. Research messages expire at window close; fills and settlement follow-ups expire 24 hours after their close/grade respectively.

Delivery is **at least once**, not exactly once: if Discord accepts a POST but the response or subsequent receipt write is lost, a retry can duplicate it. Discord Execute Webhook provides no idempotency key. The event footer/window fields and durable receipts support correlation. Journal/disk failures are logged and fail open; they cannot alter a call, and cannot promise lossless capture when storage itself is unavailable.

## Approval/verification sequence

1. Owner reviews draft PR and exact-head CI; merge approval remains separate from deploy approval (main currently auto-deploys, so approvals must account for that trigger).
2. Owner provides the two secrets through Render only when deployment/configuration is approved.
3. After approved deployment, confirm Discord remains HELD (`action: "status"` on `/api/discord-release`). Review the PR’s embed examples privately; do not bypass the hold or send test fixtures to public follower channels.
4. Release Discord once with `action: "release"` on `/api/discord-release`. This is durable across later deploys. Web push still needs the existing owner-only #387 device-display verification for each deployed commit; that process is unchanged.
5. Verify the first window summary in #directional-reads and first genuinely booked fill plus recorded settlement follow-up in #paper-calls; inspect private outbox rows/log codes. Do not manufacture a paper position to test publication.

The September 14 recovery, owner-alert incident repair, and historical measurement issue #385 remain separate.

Settlement embeds also show the all-time public Books paper scoreboard: W-L and cumulative recorded net after fees, including the just-settled fill. One SQL snapshot reads the same valid ledger population, entry count, positive-net wins and stored net sum as Books; no 30-second cache lag, hypothetical/shadow totals, or Discord-delivery-only record. Historical wins retain Books’ positive-net definition. Retries reuse the captured totals. No pre-call scoreboard is added.
