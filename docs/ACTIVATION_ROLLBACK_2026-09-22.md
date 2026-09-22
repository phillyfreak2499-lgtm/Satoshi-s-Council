# Activation and rollback checklist — 2026-09-22

Nothing in this branch changes production behaviour when merged and deployed.
Each item below is a separate owner decision with its own rollback.

| # | Activation | How | Rollback | Blast radius |
|---|---|---|---|---|
| 1 | Freeze the seat-review demotion | set `SEAT_REVIEW_DEMOTION_FROZEN = true` in `src/lib/desk/learner.ts`; deploy | set it back to `false`; deploy | production status writer stops demoting; prints its verdict; restores nothing |
| 2 | Create the shadow tables | `npm run db:migrate` runs `migrations/0057_desk_shadow_lab.sql` and `0058_desk_shadow_manifest_candidate_not_collecting.sql` on deploy (additive, idempotent) | `drop table desk_shadow_receipts; drop table desk_shadow_manifests;` | none on the Floor |
| 3 | Start shadow collection | the `healthz` import is now in place (2026-09-22 reconciliation pass); set env `SHADOW_LAB_ENABLED=true`; deploy; then `update desk_shadow_manifests set status='SHADOW', prospective_start_at=now() where experiment in (...)` at the actual instant (never MIRROR_35_V1 while three are active) | unset the env var (observer refuses to start); set status `PAUSED` | ~1 extra frame read every 2 s; writes to two research tables only; a failing observer cannot touch the frame (rail) |
| 4 | Widen card-fire receipts | extend `SCORE_AUDIT_SKILLS` in `src/lib/desk/skill-score-audit.ts` | revert the list | larger `skill_score_audit` JSON per ledger row |
| 5 | Persist status transitions | **active from this branch's deploy**: engine queues, `healthz`-kicked drainer writes insert-once `SKILL_STATUS:*` events | set env `SKILL_STATUS_LOG_DISABLED=true` (drainer refuses to start) | one small insert per status change |
| 6 | Reconcile on demand | `DATABASE_URL=... npm run reconcile:book -- --as-of <ISO>` | n/a (read-only) | none |
| 7 | SELECTOR ATTRIBUTION v1 | `migrations/0059_desk_selector_attribution.sql` applies on deploy; the recorder rides the shadow-lab tick and starts with step 3 (same switch, same `prospective_start_at`, logs from the first window that starts after it); `docs/SELECTOR_ATTRIBUTION_V1_2026-09-22.md` | unset `SHADOW_LAB_ENABLED` (nothing records); `drop table desk_selector_attribution` | one table, ≤ 3 inserts per window; no path into the Chair, gate, book or learner (`scripts/selector-attribution-rails.test.mjs`) |

Never in this branch: lowering the 80¢ floor, changing `min_speaking`,
re-promoting a card, early exits, size-up, a live-trading arm.

Order: 1 was merged alone (main 45b0cd0, 2026-09-22 03:40Z). 2 → 3 in that order; 7 follows 3 automatically. 4 is independent. 5 is already on.
