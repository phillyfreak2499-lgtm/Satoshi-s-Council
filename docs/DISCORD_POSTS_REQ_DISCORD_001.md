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

**Late posts.** A paper call or settlement that posts after the release but was booked or graded before it is relabelled at send time so it cannot read as a current call. The rule is a durable `heldBeforeRelease` marker on requeued paper rows, or `observed_at < desk_discord_release.released_at` for delayed capture. The internal marker is stripped before sending to Discord. It needs no new migration and survives restarts and deploys, because both values sit in durable rows (`desk_discord_outbox` and `desk_discord_release`).

What changes on a late post:
- **Title:** `LATE · ALREADY SETTLED · posted after release, not a current call`. If the window has not closed yet, the title is `LATE · posted after release, not a current call`, so the post never claims a settlement that hasn't happened.
- **Description:** starts with the paper-position layer (`■ Paper position booked earlier · UP. …`).
- **Color:** grey `#6b7280`.
- **First field, "Originally booked (CT)":** the booking time in America/Chicago, for example `Oct 1, 2026, 1:07 PM CT`. For a settlement, this is the parent call's booking time.
- **"Settled outcome":** taken from `desk_ledger_research` for the exact window, source and side, for example `UP · paper WIN · +15.0¢ net after fees`. If no settlement is recorded, it says `Not known: no recorded settlement for this window was found when this was posted.` If the window is still open, it says `Not settled yet: the window closes … CT.`
- **Kept fields:** the original Seat, Direction, Entry and Window fields stay. Every paper format, including legacy stored rows and settlement follow-ups, has separate "Research outlook", "SATOSHI decision", and "Paper position" fields. The Chair decision is identified as the original booking-time decision; a pilot does not invent an unrecorded Chair decision.
- **Wording:** no "now", "live" or "new call".
- **Timestamp:** the embed timestamp stays the original booking time.

The 24h cutoff is unchanged. Paper posts expire at close + 24h, and settlements at grade + 24h. Normal new paper calls and settlements retain their stored presentation. Legacy payloads gain the three distinct layer fields.

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

#directional-reads receives **at most one research-outlook summary per 15-minute Kalshi window**. The previous per-seat lean-change posts were superseded because they produced roughly 1,000 posts a day. The summary is taken on the first published frame with 10 minutes or less to close (`READ_SUMMARY_MS_LEFT`) that has at least one bullish or bearish seat lean. Its event key is `readwin|<ticker>|<close>`, so the outbox primary key keeps it to one row per window across ticks, restarts and workers. A window with no directional lean by close gets no post. The summary reuses `seatFacts` and `seatDirectionalLeans`, exactly as Guided/Pro do. Pre-summary per-seat events still in the disk journal are dropped, and pending/held legacy SQL reads are expired before delivery. Neither is replayed. The `desk_discord_read_state` cursor table is no longer written and is left in place (no drop).

Example research outlook embed (purple):

- **◇ RESEARCH OUTLOOK · SEAT LEANS**
- “Research only, one summary per 15-minute window. Seat leans are direction and intensity (0–100), not probabilities. Not a SATOSHI call and not a paper position. Paper-only desk: no real trades.”
- Research outlook · seat leans: `TAPE 71 · Bullish`, `DRIFT 35 · Bearish` (directional seats only, strongest first); Seat count; **SATOSHI decision · Chair**: `WAIT — SATOSHI is not making a call on this frame.` or `UP — the Chair's call on this frame. It is a paper position only if booked.`; **Paper position**: `None in this post. Booked paper calls post separately in the paper-calls channel, one post per booked call.`; Snapshot, window close and ticker.

Every paper embed carries three separate fields: **Research outlook** (not recorded here), **SATOSHI decision** (UP/DOWN at original Chair booking, or explicitly unrecorded for the pilot), and **Paper position** (the recorded paper fill). Legacy stored payloads are normalized at send time.

These are separate Discord payloads. #387's approved browser alert titles, messages, and badge assets are unchanged.

## Reliability and isolation

Event hooks only observe existing publication points. Booking/Chair/learner behavior is unchanged. A lazy adapter observes existing paper notification publication and the exact public-frame publication point, after snapshot/vote/Chair cache assignment. A failed provisional tick cannot announce its unpublished leans. Telemetry sampling/configuration is untouched. No provider or SQL work is awaited by the decision loop. Errors are caught and emit sanitized codes without URLs, exception text, or provider response bodies. Outage/watchdog alert path is unchanged.

A write-ahead journal on the existing data disk survives database outages. Migration 0070 adds **three new tables and one index only**: outbox, per-destination cooldown/disable state, and retained research publication cursor. It makes no ALTER, seed, update, delete, or change to any existing table. Cursor advancement and research event enqueue are atomic. Queue claims have leases and skip locked rows. SQL retries and provider attempts run every five seconds outside the desk loop.

Provider POST uses an eight-second timeout, no redirects, mentions disabled, and `wait=true` to require an accepted-message receipt. Network/5xx/429 retry with exponential backoff, at most eight delivery attempts; Discord retry/reset headers and `retry_after` determine longer waits. Cooldowns are durable and conservatively shared across both destinations, including global 429s. Permanent 4xx disables that target; rotate its webhook rather than repeatedly hammering a rejected endpoint. Research messages expire at window close; fills and settlement follow-ups expire 24 hours after their close/grade respectively.

Delivery is **best-effort at most once**, not guaranteed exactly once. Before provider I/O, a durable send intent marks the row failed with `delivery_unconfirmed`. A crash, lost response, HTTP 5xx, or lost receipt never triggers an automatic repost; an accepted message may therefore have an unconfirmed receipt, or a message may be missed. Only a confirmed HTTP 429 rejection is retried, bounded to eight attempts. Discord Execute Webhook provides no idempotency key. Unconfirmed rows are not requeued by owner release. Journal/disk failures are logged and cannot alter a paper call.

## Approval/verification sequence

1. Owner reviews draft PR and exact-head CI; merge approval remains separate from deploy approval (main currently auto-deploys, so approvals must account for that trigger).
2. Owner provides the two secrets through Render only when deployment/configuration is approved.
3. After approved deployment, confirm Discord remains HELD (`action: "status"` on `/api/discord-release`). Review the PR’s embed examples privately; do not bypass the hold or send test fixtures to public follower channels.
4. Release Discord once with `action: "release"` on `/api/discord-release`. This is durable across later deploys. Web push still needs the existing owner-only #387 device-display verification for each deployed commit; that process is unchanged.
5. Verify the first window summary in #directional-reads and first genuinely booked fill plus recorded settlement follow-up in #paper-calls; inspect private outbox rows/log codes. Do not manufacture a paper position to test publication.

The September 14 recovery, owner-alert incident repair, and historical measurement issue #385 remain separate.

Settlement embeds also show the all-time public Books paper scoreboard: W-L and cumulative recorded net after fees, including the just-settled fill. One SQL snapshot reads the same valid ledger population, entry count, positive-net wins and stored net sum as Books; no 30-second cache lag, hypothetical/shadow totals, or Discord-delivery-only record. Historical wins retain Books’ positive-net definition. Retries reuse the captured totals. No pre-call scoreboard is added.


## Review hardening

Release time is read atomically with the durable send-intent transition for each row, protected by the current lease. It is never cached across a drain. A hold/release between posts therefore marks requeued paper rows late using the new release time. Migration 0072 remains unchanged and touches no existing hot table.

Repeated release retains the original release timestamp but marks each held paper row late durably, including holds caused by a destination change. An in-flight provider request cannot be recalled by a subsequent hold.
