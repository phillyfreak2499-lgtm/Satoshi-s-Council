# MID_RECOVERY_V1_INACTIVE — direction-stage audit (2026-09-26)

HISTORICAL DIAGNOSTIC ONLY. Nothing here changes production behaviour, the
live Chair, the learner, booking, or the experiment's rules. Paper only.

## Sample

58 windows recorded by the recorder between 2026-09-25 21:45 UTC and
2026-09-26 12:15 UTC (the owner's report of 51 was an earlier read of the same
stream). 41 windows had at least one recovery candidate; 62 candidate rows
(STREAK 25, CHAIN 23, STRIKE 14). 0 qualified windows, 0 simulated fills,
0 WAIT → directional conversions at the recorded terminal tick.

## The path a recovered candidate walks to a direction

`runBotsWithEvaluatedCandidates` → `projectInactiveE1Recovery` (one card per
seat, holds excluded; `unmuteRoster` gives the card a LIVE twin) → the actual
`runChair`:

1. **Row weight** `w = seat_w × listen × health × licence × fade`, where
   `listen` includes `listenCalib(calibN)` and `calibN = seat_n − seat_calib_debt`.
2. **Status**: `calibN < 20` → `UNCALIBRATED`. The live learner carries a full
   calibration debt on STREAK (587 of 587) and STRIKE (210 of 210), so both
   are UNCALIBRATED on every window; CHAIN (398 − 340 = 58) is LIVE.
3. **Family fold** (`foldSameSide`): same-family same-side rows keep one
   representative; a fold changes correlation credit, not the score.
4. **Score** `rawScore = Σ signed·w / Σ w` over directional rows only, times
   `diversity` (1.06 at two agreeing evidence categories, 1.12 at three),
   times `1 − 0.7 × conflictFrac`. Every candidate read at confidence 64, so
   `|rawScore| = 0.64^1.4 = 0.535` when the candidates agree.
5. **Bar** `= 0.30 base + 0.08 quiet + 0.04 EXPLOIT (+ 0.04 weekend) + 0.2 × sitMass`,
   clamped 0.24–0.72. With 13–14 sitting seats against a directional mass of
   0.003–0.03, `sitMass ≈ 0.97–1.0`: the production OPENING bar was 0.62
   (Friday) and 0.66 (Saturday) on every window, and the quiet gate was
   failing on all 58.
6. **Aggressiveness** = time factor (1.15 at ≥ 4 min, 0.72 at 2.2–4 min);
   the quiet flag also removes the ORBIT multiplier.
7. **Direction** iff no hard gate fails, `|rawScore| × agg ≥ bar`, no top-3
   conflict (two loud sides), no KNN abstain, and the side's edge after fee > 0.

Then eligibility: `eligibleSupportRows` counts only LIVE/FADED rows with
weight > 0 — an UNCALIBRATED row never counts — and the deployed policy needs
two supporters from two families with the ask at or above 80¢.

## Direction-stage taxonomy (reconstructed from the stored row weights and the production bar)

| stage | reason | windows | share |
|---|---|---|---|
| terminal T-3 (agg 0.72) | BELOW_BAR, strength (0.535 × 0.72 = 0.385 vs 0.60–0.66) | 31 | 53% |
| | NO_CANDIDATE | 17 | 29% |
| | production seat already directional (recovery adds nothing) | 6 | 10% |
| | CONFLICT_TOP3 (STREAK/STRIKE vs CHAIN, both at 64) | 3 | 5% |
| | BELOW_BAR, time-damped only | 1 | 2% |
| best in-band tick (agg 1.15) | BELOW_BAR: `0.535 × 1.15 = 0.615` vs bar 0.60–0.66 | 31 | 53% |
| | NO_CANDIDATE | 17 | 29% |
| | production-dominated | 6 | 10% |
| | CONFLICT_TOP3 | 3 | 5% |
| | EDGE_GATE (cleared the bar, side edge ≤ 0) | 1 | 2% |

Margin in band over the 32 candidate-only, non-conflicted windows:
min −0.044, median −0.006, max +0.034. The read sits a few hundredths under
the bar; the sit-mass term (+0.20) and the quiet term (+0.08) each alone
exceed that gap, family folding, health weighting and sticky lean never
decided a window (the recovered arm runs with no sticky lean; feeds were
LIVE on every candidate row).

## Counterfactual replay, one rule at a time

Direction taken at the first in-band checkpoint (T-7:00, T-5:00, T-4:00)
that passes; then the deployed support, quote (80¢ floor, < 99, spread ≤ 2),
model-edge and settlement-index gates, priced from the replay tape and
settled on the official winner. Assumptions: the T-3 candidate set held
through the band; sit total mass 1.0 (sensitivity on the bar ≤ 0.017); the
desk fair as the index proxy; no KNN or calibration-tax bar bumps in band.

| variant | directional windows | simulated fills | after direction, blocked by |
|---|---|---|---|
| current | 0 / 58 | 0 | — |
| no family collapse | 0 / 58 | 0 | — (folding never decided a direction) |
| lower speak bar | not replayable | — | sub-52 reads are whisper-filtered before capture; needs the raw production reads |
| two-family diversity 1.12 | 7 / 58 | 0 | support: one seat, or UNCALIBRATED (9) |
| no sit-mass bar term | 21 / 58 | 0 | support seats (32) |
| no quiet penalty | 21 / 58 | 0 | support seats (32) |
| time factor held 1.15 to T-3 | 0 / 58 | 0 | in band the factor is already 1.15 |
| no sit term + uncalibrated may support (diagnostic only) | 21 / 58 | 1 (DOWN @ 83¢, won, +16¢) | support seats 23, 80¢ floor 6, families 1, model edge 1 |

NULL_FAV_80 on the same 58 windows: 30 fills, 24 wins / 6 losses (80.0%),
average ask 87.4¢, needed win rate 88.7%, net −260.9¢, Brier 0.152.

The unanimous candidate reads, before any price filter, agreed with the
official winner 28 of 38 times (74%): STREAK 20/25, STRIKE 10/14, CHAIN 15/23.
An 80¢-plus favourite needs roughly 85–89% to break even after the fee.

## Reading

No single direction-stage rule is suppressing a useful edge. The recovered
reads are uniform 64-confidence votes with row weights of 0.003–0.02, and the
bar they face is dominated by the sit-mass term; removing that term (or the
quiet term) would turn 21 windows directional, but every one of them then
fails the support stage because STREAK and STRIKE carry a full calibration
debt and CHAIN stands alone. Even with that waived, the 80¢ floor and the
reads' own 74% accuracy leave at most one fill in 58 windows. The bottleneck
is the calibration debt on the recovered seats (a learner-state fact), and
behind it the price floor against a 74%-accurate read, not the aggregation.

## Instrumentation added (shadow-only)

`directionDiagnosis` in `shadow-lab-mid-recovery.ts` reads the simulated
Chair's own measurement fields and stamps every record with the deciding
reason (`NO_CANDIDATE`, `HARD_GATE`, `CONFLICT_TOP3`, `BELOW_BAR`,
`KNN_ABSTAIN`, `EDGE_GATE`, `DIRECTIONAL`), the contributing tags
(`BAR_SIT_MASS`, `BAR_QUIET`, `BAR_WEEKEND`, `BAR_PHASE`, `BAR_LAW`,
`BAR_CALIB_TAX`, `BAR_KNN`, `TIME_DAMPED`, `LOW_DIR_MASS`, `HARD:<gate>`),
the margin to the bar and the analytical "would pass without" flags. The
recorder keeps the best in-band tick per window and writes it on the T-3
sit (`direction_best`), and the report tallies terminal and best-tick
reasons. Prospective from the next deploy; the 58 windows above were
reconstructed and are labelled as such.
