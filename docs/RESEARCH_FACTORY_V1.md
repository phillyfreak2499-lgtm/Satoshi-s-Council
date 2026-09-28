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

---

# Addendum: decision tape, transitions, value-add

None of this adds production authority, changes a gate, adds a seat, or calls
a paid API.

## Delivery categories

| category | item | status in this PR |
|---|---|---|
| **BUILD NOW** | structured WAIT receipts (A) | built: `desk_research_decision_tape`, `research-factory-tape.ts` |
| **BUILD NOW** | frame-brief receipts and grading (B) | built: checkpoint briefs, graded after settlement |
| built with them | choke-transition engine (1) | built for production, plus per-arm stage unlocks versus CONTROL |
| built with them | marginal-information scorer (2) | engine built; seat and family report from tape checkpoints (EXPLORATORY) |
| built with them | counterfactual survival (3) and honesty rail (4) | built; research summary (5) built |
| **INSTRUMENT NEXT** | Kalshi book depth (C) | feasibility below; collector proposed for the next PR |
| **ANALYZE AFTER INTEGRITY** | per-seat debrief (D) | design below; the signal-value report is its first cut |
| **RESEARCH QUEUE** | spot/perp delta (E), formalized WICK (F) | feasibility and design below; not built |
| **BLOCKED** | parameter or genetic search (G) | prerequisites below |

## A + B. The production decision tape

An env-gated observer (`RESEARCH_DECISION_TAPE_ENABLED=true`, literal; off by
default). It reads the frame the engine already publishes on each tick: the
Chair, the admission audit, the daily admission state and the call log, all
from the same tick. Nothing is recomputed.

It writes one insert-once row at each designated checkpoint (T-600, 450, 300,
240, 180, 120 and 60 s) and at every change of decision label or funnel stage,
capped at 80 rows per window. Each row holds:

- the **primary blocker**, **all blockers** and the **deepest stage**;
- production's raw reason, preserved verbatim: telemetry's
  `chairWaitReason`, the same string `desk_chair_evals` stores, plus every
  failing check and hard gate;
- the machine-readable **conditions** for the next stage, with exact current
  values and required values;
- the directional evidence (score, `vs_bar`, bar, sit term, supporters,
  families) and the market state.

Rules the tape follows:

- **Taxonomy:** the 16 required classes, plus `DIRECTION_CONFLICT` and
  `UNKNOWN`. An unmapped gate keeps its raw id under `OTHER_EXPLICIT`. A WAIT
  that production's own fields do not explain is recorded as `UNKNOWN`, never
  guessed.
- **Required values** come only from `admissionRequirements(daily)`, the
  function production itself enforces. Without the daily state the
  requirement is `null` and the brief is not gradable.
- **Confirmation:** the production confirmation latch is not published in the
  frame. Its requirement is stated, but its current count is recorded as
  unknown.
- **Levers are not conditions:** "the sit-mass term alone would clear the
  bar" is a lever (`bar_without_sit`) used only by the survival analysis. It
  is never graded as a condition that "occurred".
- **Partial windows:** a window already open when the observer started is
  marked `partial_window` and excluded from first-blocker and dwell
  statistics.

After settlement, the factory's window job grades each brief:

- did the condition occur, and when;
- did the blocker clear, and what blocked next;
- did the window become directional, qualify or book;
- the official result.

The grades feed these metrics:

- `brief_condition_hit_rate`
- `brief_correct_transition_rate` (the condition occurred, and the blocker
  then cleared)
- `brief_false_hope_rate` (the condition occurred, but the window never
  advanced)
- `unexplained_clear_rate` (the blocker cleared without the stated
  condition, meaning the brief was incomplete)

**Relation to existing telemetry:** `desk_chair_evals` and `desk_seat_reads`
(`SEAT_TELEMETRY_ENABLED`) already sample the Chair tape every 10 s. The
decision tape adds what those tables lack (the admission audit, taxonomy,
conditions and grading) without touching the engine's telemetry call site.

## 1. Choke-transition engine

- `transitions`: for production, the from/to matrix with rates, median dwell
  per label, advance and regression rates, first, terminal and deepest stage.
  It rolls over the last 25, 50, 100, 250, 500 windows and the horizon, and
  breaks down by direction, regime, favourite strength, build and day.
- `stage_unlocks`: per isolated arm, on windows matched with CONTROL,
  `incremental_stage_unlocks` per stage and the next blocker after an
  unlock. For example, BAR_NO_SITMASS might read +7 directional, +2 support,
  +0 qualified.
- **Limit:** the recorders keep each arm's deepest evaluation per window, not
  a per-tick tape, so arm-level dwell times need a future per-tick arm tape
  (for example a LOCKS V2). Production has them now.

## 2. Marginal-information scorer

`marginalValue` takes the favourite's point of view and runs two tests:

- **Price-band control:** inside fixed narrow price bands (50–60 … 85–90,
  90–95, 95–100¢), it compares the favourite's win rate when the signal
  agrees versus opposes.
- **Walk-forward incremental Brier and log loss:** each window is scored by a
  band × stance offset fitted only on earlier windows and shrunk toward the
  market price.

A signal that merely restates the price scores about 0. That is tested.
`redundancy` reports pairwise agreement, and who is right when two signals
disagree. `signal_value` applies both to every seat and family read at the
T-5:00 brief, with raw value and incremental value reported separately.
It is labelled EXPLORATORY with its variant count, and it never mutes or
promotes a seat.

## 3. Counterfactual survival

For each settled window that never qualified, the analysis takes the
window's deepest recorded frame and finds the smallest **single** change
that clears its primary blocker, using production's own gap:

- bar points,
- one fewer supporter or family,
- a floor that many cents lower,
- a lower edge requirement.

Every other blocker production measured on that same frame still stands.
Changes are ranked by `qualified_fills_created_per_rule_change`, not by
windows unblocked, and priced at the frame's ask with the taker fee.
Changes that only move a window to its next blocker are listed as
`false_unlocks`. Confirmation is PARTIAL (assumed) or UNAVAILABLE, and
everything here is EXPLORATORY.

## 4. Honesty rail and 5. summary

- Every lifecycle spec carries `hypothesis_kind` (PRESPECIFIED for the frozen
  prospective arms), `variants_tested` and `sample_windows` (training,
  validation, holdout).
- Pockets, survival and signal value are EXPLORATORY, each with its variant
  count.
- `research_summary` answers, deterministically:
  - the current bottleneck;
  - the highest-leverage isolated change;
  - the best incremental signal;
  - the most redundant signal;
  - false unlocks;
  - the next prospective experiment.

  Each answer carries its population and the rule: EXPLORATORY findings can
  earn a frozen prospective test, never production authority, and nothing is
  promoted from COMBINED_DIAG or P2-contaminated evidence.

## C. Kalshi book depth: feasible, instrument next

The Lab already keeps a full per-level Kalshi book in memory
(`lab.server.ts` `L.books`, built by `lab-book.ts`) from the `orderbook_delta`
WebSocket channel:

- YES-bid and NO-bid level maps (price → size); asks are implied by the
  opposite side's bids;
- trust flags: `ok` (a snapshot has loaded), `stale` (a sequence gap is
  outstanding), a `gaps` count and `upd_t`;
- a phantom-level guard (`QTY_EPS`) that removes floating-point residue;
- a REST fallback, `GET /markets/{ticker}/orderbook?depth=N` (`fast-pulse`
  uses `depth=1`).

**Proposal (next PR):**

1. Add a read-only accessor, `labBookLevels(ticker, n)`.
2. Add an env-gated collector writing `desk_research_book_depth` at
   T-600, 300, 180 and 60, with:
   - YES and NO bid depth for the top 10 levels, best bid and ask, spread;
   - total, near-touch-weighted and imbalance measures, and the depth slope;
   - adds and removes since the previous snapshot;
   - quality flags: untrusted, stale, gap count, snapshot age, missing book.
3. Deliver collection quality first: coverage and trust rates per clock.
4. Only then test H0 ("resting depth imbalance adds no information beyond the
   same-time market price"). Use `marginalValue` with stance = sign of the
   imbalance, walk-forward, inside price bands. Retire the study if depth
   restates price.

## D. Per-seat debrief: analyze after integrity

The raw material exists:

- `desk_seat_reads` (per-seat raw and final lean, speak threshold,
  suppression reason, weight, status, contribution);
- `desk_chair_evals`;
- the tape's checkpoint seat reads.

The debrief is `signal_value` extended with conditioning on session, ATR
regime, favourite or underdog, ask, time remaining, agreement with the
Chair, and a signal-survival matrix: generated → authority → folding →
contribution → Chair direction → support → confirmation → qualified → booked.
It asks "when is this seat useful?", and it never alters authority.

## E. Spot/perp delta: not reconstructable from stored data

- **Stored data:** only per-minute *basis* (`desk_basis_minutes`), Kalshi
  taker share (`desk_taker`) and legacy model features (`desk_samples`). No
  spot or perp **signed** trade flow is stored.
- **Live feeds:** the only WebSocket feed in the app is Kalshi's. No spot or
  perp trade stream exists live either.

**Bounded proposal:**

1. Add a research-only trade collector per venue (spot and perp, kept
   separate) that aggregates to fixed 1-minute and final-5-minute buckets:
   signed volume from the aggressor flag and cumulative delta.
2. Freeze the signed-flow definition before collecting.
3. Only after enough clean windows, run the price-only versus price+flow
   walk-forward test with the scorer above, including real Kalshi fees.

It never becomes a production seat.

## F. Formalized WICK "no demand / no supply": research queue

The design only, not built:

- **Predicate:** freeze a predicate over ATR-normalised effort (volume)
  versus result (absolute and directional progress), plus range expansion,
  wick and body shape, and follow-through.
- **Evaluation:** once frozen, run it in parallel to the unchanged WICK and
  score it against settlement, WICK's output and market probability with
  `marginalValue`.
- **Retire** it if it adds no incremental information.

## G. Parameter or genetic search: blocked

Prerequisites that are not met yet:

1. P2 resolved or bounded.
2. The EXACT replay path validated.
3. A train / validation / untouched-holdout workflow.
4. Multiple-comparison protection beyond per-report BH.
5. A registry recording every tested hypothesis.
6. A search that cannot mutate production.
7. A full audit trail.

When allowed: authority NONE, exploratory results, multi-metric objectives
with a complexity penalty, the number of hypotheses reported, and a truly
untouched final holdout. One winner out of 10,000 combinations is never
equivalent to one prespecified success.
