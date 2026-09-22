# Activation and rollback checklist — 2026-09-22

Nothing in this branch changes production behaviour when merged and deployed.
Each item below is a separate owner decision with its own rollback.

| # | Activation | How | Rollback | Blast radius |
|---|---|---|---|---|
| 1 | Freeze the seat-review demotion | set `SEAT_REVIEW_DEMOTION_FROZEN = true` in `src/lib/desk/learner.ts`; deploy | set it back to `false`; deploy | production status writer stops demoting; prints its verdict; restores nothing |
| 2 | Create the shadow tables | `npm run db:migrate` runs `migrations/0057_desk_shadow_lab.sql` on deploy (additive, idempotent) | `drop table desk_shadow_receipts; drop table desk_shadow_manifests;` | none on the Floor |
| 3 | Start shadow collection | add `void import("../../src/lib/desk/shadow-lab.server").then((m) => m.ensureShadowLabObserver()).catch(() => {});` to `server/routes/healthz.get.ts`; set env `SHADOW_LAB_ENABLED=true`; deploy; then `update desk_shadow_manifests set status='SHADOW', prospective_start_at=now() where experiment in (...)` at the actual instant | remove the env var (observer refuses to start) or remove the import; set status `PAUSED` | ~1 extra frame read every 2 s; writes to two research tables only |
| 4 | Widen card-fire receipts | extend `SCORE_AUDIT_SKILLS` in `src/lib/desk/skill-score-audit.ts` | revert the list | larger `skill_score_audit` JSON per ledger row |
| 5 | Persist status transitions | new `desk_system_events` writer in `reviewSeats`/`runHuddle` (not written here) | remove the writer | none |
| 6 | Reconcile on demand | `DATABASE_URL=... npm run reconcile:book -- --as-of <ISO>` | n/a (read-only) | none |

Never in this branch: lowering the 80¢ floor, changing `min_speaking`,
re-promoting a card, early exits, size-up, a live-trading arm.

Order: 1 may be decided alone. 2 → 3 in that order. 4 and 5 are independent.
