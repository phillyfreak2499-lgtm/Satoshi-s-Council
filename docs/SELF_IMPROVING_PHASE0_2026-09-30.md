# Self-improving paper desk — Phase 0

Base: `3d4a26353118a2f6144ab1ea24e2a8f4a86edc96`.
Evidence: `docs/audit/self_improving_phase0_2026-09-30.json`, read from
`https://satoshiscouncil.com/frame` at frame time 2026-09-30 22:45:43.993 CT
(2026-10-01 03:45:43.993 UTC). This is a current-frame inventory, not a historical snapshot or a roster recommendation.

## Review freeze

`SEAT_REVIEW_DEMOTION_FROZEN = true` is already active in current main source.
Both `server-engine.ts` and `engine.ts` invoke `reviewSeats` without an override.
The frozen failing-review branch exits before calibration reset and `rethinkSeat`;
there is no review-driven LIVE-to-BENCH transition while frozen. Explicit
`frozen:false` exists only in the historical reproduction test. Repeated due
reviews across every non-WARDEN seat preserve all card statuses and debt in the
new regression. Existing review counters/logs still advance. A passing review
can still pay down debt; this is existing behavior and is not a demotion.

The public frame does not expose a deployed code hash or this constant, so the
source/call-site verification is not proof of the deployed binary's exact SHA.

**Separate path:** `runHuddle` still benches LIVE cards for its rolling accuracy,
wrong-streak, or negative-EV conditions. `applyAuthorityReview` is a separate
one-time status migration. The review freeze does not cover either. Phase 0
changes neither path; a future symmetric controller must account for these
writers explicitly before claiming all demotions share the new evidence gate.

## Current selectable set

The learner has 84 cards: 13 LIVE, including eight LIVE pit-crew cards owned by
ORBIT, WIRE and WARDEN, which do not vote. There are five LIVE cards outside pit
crew. Current-regime selectable and authority-ready counts below are checked
against the frame's published Chair rows and the current
`seatCardAvailability` predicate. Selectable means a rule may be evaluated;
authority-ready is distinct from a rule firing or clearing booking gates.

| Seat | LIVE cards | Selectable | Authority-ready |
| --- | --- | --- | --- |
| DRIFT | DRIFT.aligned_3h | 1 | 1 |
| CHAIN | CHAIN.oi_with_price | 1 | 1 |
| STRIKE | STRIKE.itm_time | 1 | 1 |
| INDEX | INDEX.settle_fair; INDEX.locked_avg | 0 | 0 |
| WICK, PULSE, TAPE, CARRY, CASCADE, VOLT, STREAK, EXHAUST, WHALE, VEL, CLOCK | None | 0 | 0 |
| ODDS, CHEAP, FADE (retired) | None | 0 | 0 |

Regime: `ASIA_ENTRY`; learner phase: `EXPLOIT`. Both INDEX cards require
`min_regime_n = 24` and have zero recorded reads in this regime. No settings
mutes were applied to this count; the saved receipt preserves settings mutes
for interpretation. Inventory is regime-specific and may change with the
next regime or learner update. No retirement decision is made from it.

## Delivery boundaries

Only freeze documentation, regression coverage and audit receipts change.
Paper-only behavior, the 80-cent floor, fees, gates, seat statuses, weights,
thresholds and QUORUM_ABLATION_V1 are unchanged. No Phase 1 implementation.
No merge or deployment is authorized by this PR. Owner review is required
before progressing to the next phase.
