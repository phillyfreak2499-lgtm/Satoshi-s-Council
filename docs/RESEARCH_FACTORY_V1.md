# RESEARCH_FACTORY_V1 — background research that makes every settled window count

Research only. Production authority: NONE. No paid API, no model call.
Default OFF (`RESEARCH_FACTORY_ENABLED=true`, the literal string, turns it on).
It changes no Chair threshold, floor, booking rule, learner state, follower,
setting, or recorded receipt.

## Architecture

One more observer on the existing web service, not a new worker:

- **Queue**: `desk_research_jobs`, primary key `(job_kind, job_key)`. That
  key is the idempotency guarantee: re-enqueueing a settled window, from any
  tick or any restarted process, inserts nothing.
- **One job at a time**: a process-local busy flag, plus a DB lease claimed
  under `pg_try_advisory_xact_lock` and refused while any live lease exists.
  A job whose process died is reclaimed when its lease lapses (5 min) and
  resumes from its `checkpoint`. Completed jobs are never offered again.
  Failures retry with back-off up to 3 attempts, then stay `failed`.
- **Statuses**: `queued`, `running`, `complete`, `failed`,
  `skipped_resource_guard`.
- **Production wins**: before every job, and between every unit of work, the
  governor samples:
  - RSS against 60% of the container's cgroup memory limit;
  - 1-minute load per CPU;
  - event-loop p99 delay, which is what request latency is made of in this
    single Node process;
  - DB pool waiters and connections in use;
  - DB round-trip time.

  Any one signal over its threshold pauses research. A paused job keeps its
  checkpoint and its retry budget.
- **No event-loop blocking**: work runs in small governed units separated by
  `setImmediate`. Derived rows are read in keyset pages of 500. Reports are
  built one arm per unit. The timer is `unref`'d.

  Measured as main-thread CPU between yields under PGLite. PGLite, unlike
  production, decodes rows on the main thread.

  | facts | yields | p90 segment | longest segment |
  |---|---|---|---|
  | 7,500 | 62 | ~30 ms | 44–104 ms |
  | 15,000 | 92 | ~45 ms | 107–160 ms |

  An unsliced read of the same 15,000 facts blocks for about 919 ms, and the
  test fails it. `worker_threads` were considered and not used: each unit is
  tens of ms, time-slicing plus the governor already keep the loop
  responsive, and a worker entry would complicate the Nitro bundle.
- **Telemetry per job**: wall time, CPU time (process-wide, so an upper
  bound), peak RSS, DB query count and time, rows scanned and written, guard
  reason, error and build SHA.

Thresholds (env, all optional): `RESEARCH_FACTORY_MAX_RSS_MB`,
`RESEARCH_FACTORY_MAX_LOAD_PER_CPU` (0.7), `RESEARCH_FACTORY_MAX_EVENT_LOOP_P99_MS`
(80), `RESEARCH_FACTORY_MAX_DB_WAITING` (0), `RESEARCH_FACTORY_MAX_DB_IN_USE` (6
of the pool's 10), `RESEARCH_FACTORY_MAX_DB_PING_MS` (300).

## Jobs

| kind | key | does |
|---|---|---|
| `window` | `ticker\|close_ms` | Phase 2 facts and Phase 3 integrity for one settled window with research receipts. Deferred until the official settlement exists. |
| `rollup` | UTC hour | Phases 4–8 and 10. Each report is one checkpointed unit, and each arm is one governed unit. |
| `digest` | Chicago day | Phase 9, run once the day is over. |

## What "replay" means here (read this before trusting a number)

The producer's inputs (candles, OI and funding series, learner state) are not
stored. So **candidate generation cannot be replayed for any past window**,
and every fact says `candidate_replay: UNAVAILABLE`.

What *is* stored is each recorder's decision-time evaluation record. The
factory re-derives the recorded decision from that record and labels it:

- `EXACT`: every input the decision reads is in the record, the
  re-derivation matches, and the window has an official settlement.
- `PARTIAL`: something is missing, or the re-derivation disagrees. The
  reasons say which (for example `NO_BOOK_AT_CHECKPOINT` for a NULL_FAV
  sit, or `MISSING_CHAIR_TRACE` for older payloads).
- `UNAVAILABLE`: there is no record, or no official settlement.

Nothing is substituted for a missing input. Only EXACT and CLEAN results are
evidence.

## Integrity (P2 and friends)

Every receipt gets `integrity_status` (CLEAN, SUSPECT, INVALID or
UNVERIFIABLE) plus machine-readable `reason_codes`. The receipts themselves
are never updated or deleted.

- **P2 (PR #330, unresolved, still present on main):**
  - What happens: in `EXPLOIT`, `pickLiveAndPaper` skips a LIVE card with
    `n ≥ 16`, `wilson < 0.42`, but the paper loop still captures it, so
    recovery can hear a card the producer rejected. Cards excluded by
    `CLOSED_DIRECTIONAL_CARDS` or by `voteEligible` reach the paper loop
    the same way.
  - What the auditor can see: the stored records do not carry the learner
    phase or the card's counters. So a recovered LIVE card that the producer
    did not select is `SUSPECT (P2_LIVE_CARD_NOT_SELECTED)`.
  - Partial verification: where `skill_score_audit` stores counters (only
    `DRIFT.pullback_in_trend` among the E1 roster), the auditor either
    confirms `P2_EXPLOIT_REJECT_LIKELY` or clears the card.
- **P1 (PR #333, unresolved):**
  - What happens: the Chair aggregates with `evidenceOf`, not the E1
    override, so STREAK and STRIKE count as two supporters.
  - What the auditor flags: `E1_FAMILY_SUPPORT_DOUBLE_COUNT (SUSPECT)`, only
    when the double count decided the supporter gate.
- **Other checks:**
  - identity, experiment and arm mismatch (cross-window leakage);
  - decisions after the close or after the 180 s cutoff, and future frames;
  - duplicate seats or cards, and non-roster cards;
  - held seats and hold hypotheses;
  - candidates missing from, or different from, their source frame;
  - selected-SIT reuse and unhealthy support;
  - side conflicts;
  - winner and net mismatches against the official ledger;
  - fills below 80¢, fills without a booked (confirmed) record, and fills
    from an invalid candidate;
  - deploy-crossed windows and late writes.

`evidence_safety` answers the question *"Which existing recovery results are
safe enough to use as evidence?"* per arm with `ALL_FILLS`,
`CLEAN_SUBSET_ONLY` or `NONE`.

## Reports (`GET /research/factory?key=<DESK_ADMIN_KEY>&kind=…`)

- `matched_grade`: every arm plus production on **identical window IDs**
  (`MATCHED`, then `MATCHED_CLEAN`). Anything else is labelled `UNMATCHED`.
  It reports Wilson intervals and the market-implied Brier, log loss and ECE.
  ECE only appears when each bin holds at least 10 observations.
- `choke_attribution`: the deepest stage reached, the first blocker and all
  blockers. It rolls over the last 25, 50, 100, 250, 500 and all windows,
  and breaks down by seat, family, direction, ask, time left, regime,
  favourite strength, hour, weekday, hypothesis and build. It is never a
  recommendation to loosen a gate.
- `pockets`: 12 pre-registered single dimensions, clean fills only,
  Benjamini–Hochberg at q = 0.10. A pocket is `PROMISING` only with ≥ 30
  clean settled fills and a Wilson lower bound above break-even.
- `counterfactual_gates`: one gate at a time.
  - Tightening (floor 82¢, index edge +2¢, model edge +2¢) is **EXACT**.
  - Loosening (floor 78¢, index edge −1¢, one fewer supporter or family)
    is **PARTIAL**, because confirmation was not stored.
  - Sit-mass removal is direction-only, and a confirmation-frames change is
    **UNAVAILABLE**.
- `lifecycle`: hypothesis, version, start boundary, authority, controls,
  target metric, promotion and retirement criteria, integrity, sample and
  result for each arm. The status is COLLECTING, INSUFFICIENT_SAMPLE,
  PROMISING, NEEDS_REVIEW, FAILED, RETIRED or INVALID_EVIDENCE.
  COMBINED_DIAG is always `DIAGNOSTIC_ONLY`. PROMISING **flags** a result
  for human review; nothing is promoted.
- `evidence_safety`, `utilization` (`research_compute_utilization`) and
  `daily_digest` (`report_key=YYYY-MM-DD`).

## Cost

Measured under PGLite (upper bounds for Neon):

- a window job: about 22 ms CPU and 14 queries;
- the hourly rollup: about 1 s wall over 7,500 facts and about 2.5 s over
  15,000.

At 96 windows a day that is roughly 30–60 CPU-seconds a day in steady
state, well under 0.1% of two CPUs. The one-time 45-day backfill is about
4,300 window jobs, a few minutes of CPU spread across ticks. Peak additional
RSS is the facts held during a rollup: a few MB today, and tens of MB at
15,000 facts.

**Known scaling limit:** the rollup rebuilds every report from all
current-version facts. Per-arm units grow about 130 ms of main-thread CPU per
15,000 facts, which is about a month of five-arm collection. Before about 3
months of history accumulates, switch the rollup to incremental aggregation
(keep running totals per arm and window bucket), or scope it per experiment.
The governor will pause earlier than that if units start to show in the
event-loop p99.
