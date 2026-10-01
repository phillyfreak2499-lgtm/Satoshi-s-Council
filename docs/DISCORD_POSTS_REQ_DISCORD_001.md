# REQ-DISCORD-001 — outbound Discord publication

Draft only. Owner approves merge and deployment separately. No webhook has been configured and no live Discord message has been sent during preparation.

## Rollout decision

Discord respects #387's subscriber rollout hold for **all** posts: booked fills, research leans, and settlements. Public website visibility is necessary, but does not bypass owner verification. A missing/invalid build identity, missing release proof, owner-device rekey/ineligibility, SQL failure, or a newly deployed commit keeps outbound Discord held. The existing owner-only two-tier verification releases the current build; this change does not release it or change that process.

Events observed before that build's release are held permanently, not replayed when verification completes. Pending events from another build or destination are also held rather than rerouted or replayed. Once the new build is released, a settlement follow-up for an earlier successfully delivered paper fill may be resumed against its recorded ledger outcome, on the same configured destination. Expired events are not delivered.

The owner should review the Discord payload examples privately before releasing the current build; no Discord test send bypasses the hold. Browser notification verification is the required existing release proof; it does not independently prove Discord's rendering. No new public or unauthenticated release endpoint is added.

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

#directional-reads receives changes in each public seat's retained bullish/bearish Directional Lean, including quarantined/below-bar research seats. It reuses `seatFacts` and `seatDirectionalLeans`, exactly as Guided/Pro do. No read is inferred when retained fields are missing. Neutral/no-read updates reset the publication cursor but send nothing. Returning from neutral to a directional lean is a new publication; identical repeated ticks or process restarts are deduplicated by a durable per-window/seat/target cursor. Changes in direction or numeric lean publish; status-only changes do not create another identical lean message.

Example research embed (purple):

- **◇ RESEARCH LEAN · DRIFT · DOWN**
- “Research only. Not a SATOSHI call or a paper position. Lean is direction and intensity, not a probability.”
- Seat DRIFT; Directional Lean 35 · Bearish; Observed (UTC) exact frame timestamp; Status “Research only — SATOSHI did not hear this vote.”; Window ticker.

These are separate Discord payloads. #387's approved browser alert titles, messages, and badge assets are unchanged.

## Reliability and isolation

Event hooks only observe existing publication points. Booking/Chair/learner behavior is unchanged. A lazy adapter observes existing paper notification publication and the exact public-frame publication point, after snapshot/vote/Chair cache assignment. A failed provisional tick cannot announce its unpublished leans. Telemetry sampling/configuration is untouched. No provider or SQL work is awaited by the decision loop. Errors are caught and emit sanitized codes without URLs, exception text, or provider response bodies. Outage/watchdog alert path is unchanged.

A write-ahead journal on the existing data disk survives database outages. Migration 0070 adds **three new tables and one index only**: outbox, per-destination cooldown/disable state, and retained research publication cursor. It makes no ALTER, seed, update, delete, or change to any existing table. Cursor advancement and research event enqueue are atomic. Queue claims have leases and skip locked rows. SQL retries and provider attempts run every five seconds outside the desk loop.

Provider POST uses an eight-second timeout, no redirects, mentions disabled, and `wait=true` to require an accepted-message receipt. Network/5xx/429 retry with exponential backoff, at most eight delivery attempts; Discord retry/reset headers and `retry_after` determine longer waits. Cooldowns are durable and conservatively shared across both destinations, including global 429s. Permanent 4xx disables that target; rotate its webhook rather than repeatedly hammering a rejected endpoint. Research messages expire at window close; fills and settlement follow-ups expire 24 hours after their close/grade respectively.

Delivery is **at least once**, not exactly once: if Discord accepts a POST but the response or subsequent receipt write is lost, a retry can duplicate it. Discord Execute Webhook provides no idempotency key. The event footer/window fields and durable receipts support correlation. Journal/disk failures are logged and fail open; they cannot alter a call, and cannot promise lossless capture when storage itself is unavailable.

## Approval/verification sequence

1. Owner reviews draft PR and exact-head CI; merge approval remains separate from deploy approval (main currently auto-deploys, so approvals must account for that trigger).
2. Owner provides the two secrets through Render only when deployment/configuration is approved.
3. After approved deployment, confirm current build remains HELD. Review the PR’s embed examples privately; do not bypass the hold or send test fixtures to public follower channels.
4. Complete existing owner-only #387 device-display verification and release the current build explicitly.
5. Verify the first new seat lean in #directional-reads and first genuinely booked fill plus recorded settlement follow-up in #paper-calls; inspect private outbox rows/log codes. Do not manufacture a paper position to test publication.

The September 14 recovery, owner-alert incident repair, and historical measurement issue #385 remain separate.
