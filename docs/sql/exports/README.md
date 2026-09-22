# Research exports — schemas and read-only SQL

Every file here is a `SELECT` against the production database, bounded by
`:from` / `:to` (ISO instants; the requested range is 2026-06-01 to
2026-09-21, subject to retention: the ledger begins 2026-09-05 12:45Z and
per-tick seat reads begin 2026-09-21 17:06Z). Run with `psql -v from=... -v to=...`
or paste into a read-only console. Nothing here writes.

Rows are produced only where authorised data exists. Where a requested column
has no source yet, the schema lists it with `-- UNKNOWN: <missing artifact>` and
the SQL emits NULL, never a synthetic value.

| # | file | source tables | rows exist? |
|---|---|---|---|
| 1 | booked_fills.sql | desk_ledger (+ desk_policy_fills for policy ids) | yes (190 fills to 2026-09-22) |
| 2 | chair_decisions.sql | desk_chair_evals, desk_call_quality | evals since 2026-09-21 17:06Z; call-quality since 2026-09-15 |
| 3 | seat_votes.sql | desk_seat_reads, desk_call_quality seats | seat reads since 2026-09-21 17:06Z (no ask); call-quality seats at 450/300/180 s (with quotes) |
| 4 | correlation_matrix.sql | desk_ledger.seats (grade frame), desk_call_quality seats (MID) | yes; cohorts kept apart |
| 5 | ask_path.sql (parquet by the caller) | desk_replay.cols, desk_decision_snapshots, desk_ask_lead_swaps | replay path per window; parquet conversion is the caller's step |
| 6 | jump_settlement.sql | desk_lag_events | yes (97,754 shocks; jump_ms null on 154) |
| 7 | brier_pairs.sql | desk_v3_samples, desk_v4_forced, desk_openai_shadow, desk_samples | yes; no heuristic-strength substitutions |
| 8 | skill_status_history.sql | desk_state (current only) | **UNKNOWN**: transitions are not logged; only the current status and `seat_review_at` survive. See the persisted-review request. |
| 9 | card_fire_receipts.sql | desk_ledger.skill_score_audit, desk_ledger.entry_skill_quality | DRIFT/PULSE only since 2026-09-15 16:15Z; 1 booked-entry receipt |
| 10 | reconciliation | docs/sql/reconcile_book.sql, `npm run reconcile:book` | yes |
| 11 | audit_manifest.json | docs/audit/audit_manifest.json | yes |
| 12 | grade_gaps.sql | desk_ledger (interior slots), research_quality | yes |
| 13 | cited audit | docs/QUANT_AUDIT_2026-09-22.md @ 7972372 | reference only, not ledger data |

## Added 2026-09-22 (external reconciliation pass)

| # | file | surface | UNKNOWN columns |
|---|---|---|---|
| 14 | shadow_receipts.sql | desk_shadow_receipts × manifest status | hittable_150ms/500ms (2 s poll) |
| 15 | skill_status_transitions.sql | prospective SKILL_STATUS system events | nothing before this branch's deploy |
| 16 | seat_review_snapshot.sql | current review counters and would-be verdict | state at query time only (no history) |
| 17 | co_speak_identical_ticks.sql | seat pairs directional on the same tick | before 2026-09-21T17:06Z |
| 18 | chalk_adjusted_wait.sql | Chair WAIT raw vs ex-chalk per checkpoint | — |
| 19 | gate_and_cap_counterfactuals.sql | 92¢ cap, gate variants on the index-edge proxy, oracle ceiling | model edge at entry |
