# PR #387: owner verification and subscriber rollout hold

Preparation only. No merge, deployment, production migration, owner push, release or environment change is performed by preparing this revision. September 14 recovery and the owner outage-alert incident repair remain outside this PR.

## Migration 0069

`migrations/0069_directional_regret.sql` contains only CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS statements. It performs no ALTER, UPDATE, DELETE, INSERT or DROP. The existing subscription columns, receipts, constraint, keys, owner flags and preferences are preserved. The deploy migrator applies the file and its migration marker in one transaction; a forced-failure integration test verifies rollback.

Seven new tables:

- `desk_directional_regret`: observed unbooked directional frames, ask/fees/blockers/evidence.
- `desk_directional_read_events`: per-window/side notification dedupe.
- `desk_push_read_prefs`: separate per-subscription opt-in; no row means false. References the existing subscription id with cascade cleanup on normal unsubscription.
- `desk_directional_read_receipts`: READ ONLY provider outcomes; never widens the old receipt event_kind constraint.
- `desk_alert_verification_attempts`: build, owner subscription, hashed delivery-key identity, 15-minute confirmation expiry.
- `desk_alert_verification_receipts`: exactly one provider outcome per fixture tier/attempt.
- `desk_alert_rollout`: explicit owner display confirmation and release for one deployed commit. No seed row.

No separate ALTER migration is needed or proposed. Normal subscription edits retain the original owner/rekey rules and atomically write the read preference to the new table. Verification sends never modify old subscription bookkeeping or write legacy call/test receipts, so fixture acceptance cannot manufacture recovery-pilot readiness.

## Default hold and release

Both production subscriber channels (paper-fill and directional-read) are held until the current full deployed build SHA has a valid release. Missing identity, missing proof, query failure, changed owner delivery keys, loss of owner eligibility or a new deployed commit means held. A restart of the same released build retains the release. No release is inferred from CI, a generic test, provider acceptance alone or a previous deployment.

This holds notifications only. Paper-book rules, the 80¢ floor, Chair/admission, settlement, learner and external follower behavior are unchanged. Held notifications are not queued for a later stale broadcast. Directional research capture continues during the hold; read-event notification dedupe is claimed only after the hold passes. Settlement and owner watchdog notifications keep their existing paths.

## Owner steps after a separately approved deployment

1. Unlock existing owner controls and register the current browser as an owner alert device. In Settings → Alerts, use **Two-tier rollout · owner only**.
2. Read and acknowledge that the two notifications use test fixtures, not real paper positions or Chair decisions. **Test both tiers on this owner device** holds subscriber channels first and sends only to the selected, already registered owner subscription.
3. Confirm both actual device notifications. The existing approved copy is unchanged: PAPER POSITION BOOKED · UP (83¢ fixture), filled BOOKED square; DIRECTIONAL READ ONLY · DOWN (75¢ below-floor fixture), hollow READ ONLY diamond. Tags are unique verification tags. No ledger, Chair state or follower signal is created by testing.
4. Provider acceptance for both tiers is required, but does not prove device display. Only check the display-confirmation box after seeing both exact titles/messages and badge shapes. Use **Confirm display and release subscriber tiers** within 15 minutes. The server requires the same deployed build, owner device and unchanged keys, both accepted receipts and explicit display confirmation.
5. **Hold subscriber tiers** closes the gate. Retesting also closes it before sending. **Check rollout status** reports HELD/RELEASED for the current build. Every later deployed commit requires a fresh two-tier verification and explicit release.

The authenticated POST `/api/alert-verification` supports status, verify, release and hold. It checks DESK_ADMIN_KEY before loading push code, independently requires an eligible owner subscription, and never starts the engine or changes outage state. Owner controls are not rendered for public visitors. Approval to merge/deploy does not itself confirm device display or release subscriber alerts.

## Evidence and boundaries

Integration coverage exercises strict migration structure, idempotency and failure rollback; actual subscriber dispatch before/after the hold; owner-only fixtures; partial/expired/unrecorded verification; human confirmation; new-build/rekey/lost-owner holds; default false read preferences; separate read receipts; auth rejection; and owner-only rendering.

A pinned AST baseline from pre-PR commit `54794babe91778233c731219c75f61965156ab24` protects the outage trigger, health decisions, reconciliation, watchdog dispatch, shared transport/fanout, subscription failure bookkeeping, VAPID key handling and owner readiness queries. The known owner-alert incident is neither fixed nor hidden here.
