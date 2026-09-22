# Seat-review freeze decision — 2026-09-22

Owner decision. This branch **does not** set `SEAT_REVIEW_DEMOTION_FROZEN = true`.
A separate optional commit that flips only that constant is prepared on
branch `claude/seat-review-freeze-optional-20260922` (one line in
`src/lib/desk/learner.ts`, its own commit, not in the primary PR).

## 1. What the review does today (`reviewSeats`, `src/lib/desk/learner.ts`)

Every seat except WARDEN: skip until `seat_calls ≥ max(700, seat_review_at)`;
then advance `seat_review_at` in steps of 500 past the current count; hold if
fewer than 8 scalp legs; hold (and pay debt down by 100) if the 20-leg scalp
average is ≥ 15¢; otherwise **demote**: `seat_calib_debt := seat_n`, bench the
seat's lowest-EV LIVE card, spawn a rethink shadow. With
`AUTO_SKILL_PROMOTION_ENABLED = false` nothing returns a card to LIVE, so each
demotion is one-way (rail: `scripts/review-ratchet-rails.test.mjs`).

## 2. Snapshot (`docs/audit/seat_review_snapshot_2026-09-22.json`, known_at 2026-09-22T02:48Z)

`desk_state` keeps only the current learner: this is the state at read time,
2 h 48 m after the requested as-of. No transition between the two instants is
recoverable; the transition log below starts at this branch's deploy.

Every seat with 8+ legs sits **under** the 15¢ floor. Best averages: CLOCK
+10.5¢ (2 seat_n, has an open leg), INDEX +5.45, STRIKE +1.95, CARRY +1.85.
Worst: VEL −7.0, PULSE −6.4, WHALE −6.2. So under today's rule every seat that
reaches its next review is demoted; the review is a clock, not a test.

Prospective demotions, ordered by calls until the review fires:

| seat | calls | fires at | calls away | scalp avg | LIVE card that would be benched | debt now → after |
|---|---|---|---|---|---|---|
| PULSE | 629 | 700 | 71 | −6.4 | none (nothing LIVE; debt reset to 70, rethink spawned) | 0 → 70 |
| TAPE | 2073 | 2200 | 127 | −2.4 | none | 232 → 278 |
| CHAIN | 1977 | 2200 | 223 | −0.6 | none | 340 → 398 |
| INDEX | 427 | 700 | 273 | +5.45 | **INDEX.settle_fair** (lower EV of its two LIVE cards) | 0 → 62 |
| DRIFT | 297 | 700 | 403 | −0.35 | **DRIFT.aligned_3h** (its only LIVE card) | 0 → 238 |
| CASCADE | 1794 | 2200 | 406 | −0.45 | none | 498 → 525 |
| STREAK | 1703 | 2200 | 497 | −3.0 | none | 587 → 587 |
| WHALE | 703 | 1200 | 497 | −6.2 | none | 132 → 132 |
| STRIKE | 3201 | 3700 | 499 | +1.95 | none | 210 → 210 |
| CARRY / SATOSHI / VOLT / ODDS / WICK / CHEAP / CLOCK / EXHAUST / FADE / VEL | < 700 | 700 | 296–681 | all < 15¢ | none LIVE | reset to seat_n |

INDEX and DRIFT are the only seats that still hold a directional LIVE card.
The seat-read population (2026-09-21, 7 h) shows them as the only seats ever
raw-directional, never on the same tick. If both reviews fire as scheduled
(INDEX in ~273 calls, DRIFT in ~403), the desk has no LIVE directional card
left outside ORBIT/WARDEN/WIRE context cards.

## 3. What the freeze changes, and does not

| | today (`false`) | frozen (`true`) |
|---|---|---|
| review runs and prints its verdict | yes | yes (line says "would demote · FROZEN (no change)") |
| `seat_calib_debt` reset | yes | **no** |
| lowest-EV LIVE card benched | yes | **no** |
| rethink shadow spawned | yes | **no** |
| anything already benched restored | no | **no** |
| huddle promotions | unchanged (`AUTO_SKILL_PROMOTION_ENABLED = false`) | unchanged |
| production Chair, floor, gate, quorum | unchanged | unchanged |

Rollback: set the constant back to `false` and deploy. Because the review
keeps advancing `seat_review_at` while frozen, unfreezing does **not** replay
the skipped demotions; the next review fires at the next 500-call step.

## 4. Instrumentation activated in this branch (no owner decision needed)

- `skillStatusSnapshot` before and after every `reviewSeats` and `runHuddle`
  call site in `server-engine.ts`; the diff is queued
  (`queueStatusTransitions`, pure module, bounded buffer, never throws).
- `status-transitions.server.ts`, kicked from `healthz`, drains the buffer
  every 5 s into insert-once `desk_system_events` rows
  (`SKILL_STATUS:<card>:<from>_to_<to>:<ms>`, type DESK_UPDATE, character
  COACH, public false, payload authority none). Kill switch
  `SKILL_STATUS_LOG_DISABLED=true`. Export: `docs/sql/exports/skill_status_transitions.sql`.
- Rails: the engine never imports the writer; a failing writer is counted, not
  thrown (`scripts/audit-reconcile-rails.test.mjs` rail 5;
  `scripts/system-events-rails.test.mjs` allow-list names the drainer).

## 5. Recommendation

Freeze is **REQUIRES OWNER APPROVAL**, and the evidence for it is one-sided:
the rule cannot pass any seat today, and the next two firings remove the last
two directional LIVE cards. Freezing loses nothing measurable (the verdict is
still printed and now logged) and restores nothing. Not freezing means INDEX
and DRIFT are benched on schedule, after which the 2-of-2 quorum is
unreachable by construction rather than by observation.
