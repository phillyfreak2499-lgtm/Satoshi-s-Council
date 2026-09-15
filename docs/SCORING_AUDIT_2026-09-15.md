# Skill scoring audit — September 15, 2026

## Conclusion

The two reported legacy scores are real. Their aggregate arithmetic is correct. The underlying inputs are heuristic signal strengths, not calibrated probabilities of the chosen side winning. This is a measurement-semantics problem; the evidence does not establish a sign inversion or an extra division by 100.

No corrected historical probability Brier can be supplied. The per-fire probability/outcome pairs were not retained, and a calibrated probability was not defined by these rules. Existing skill counters, grades, weights, eligibility and confidence scaling remain unchanged in this audit. No promotion is earned by the diagnostic change.

## Observed evidence

Source: public `/frame`, snapshot `2026-09-15T15:36:27.082Z`. These are skill grading counters, not booked positions. The PDF morning stamps are separate historical observations.

| Skill | Right / graded | Legacy squared-error sum | Inputs | Sum / inputs | Hypothetical net at grading quotes, after fees |
| --- | ---: | ---: | ---: | ---: | ---: |
| DRIFT.pullback_in_trend | 123 / 124 | 96.18190000000006 | 124 | 0.7756604838709682 | +165¢ |
| PULSE.vol_lag_5m | 20 / 20 | 15.6884 | 20 | 0.78442 | +65¢ |

The same snapshot's pocket counters place 119 of DRIFT's 124 grades and 17 of PULSE's 20 grades in FINAL pockets. These counts do not establish that the skill knew the answer when an earlier paper entry paid its ask. They also do not establish why every historical confidence was low; those individual inputs are MISSING.

## Verified calculation path

1. Both DSL rules use `ret15_edge`, defined as the absolute 15-minute return divided by 0.008, bounded to 0–1. This measures move strength, not a fitted chance of winning.
2. `directionalConf` scales strength by phase and health, with caps. Selected reads may then be adjusted by the existing Brier/EV scaling before the whisper filter. Other paper reads keep their own confidence. A suppressed directional read is graded using its preserved raw confidence.
3. `creditDirectional` uses `clamp(confidence / 100, 0, 1)` and adds `(input - hit)^2`. The outcome is whether the chosen side won, so DOWN uses the same chosen-side orientation as UP.
4. `refreshDerived` divides the saved sum by its input count. The observed numbers agree with that arithmetic.

Illustrative test, not a historical reconstruction: strength 0.1 in FINAL with a healthy feed produces confidence 11. If that read is right, `(0.11 - 1)^2 = 0.7921`. A high error can coexist with a high hit rate without an arithmetic bug. Calling that value a validated probability Brier is unsupported.

The binary Brier definition requires a probability forecast and a binary outcome: [scikit-learn reference](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.brier_score_loss.html). No replacement mapping such as `(1 + strength) / 2` was invented.

## Prospective fix

`SKILL_SCORE_AUDIT_V1` captures the existing grading inputs for these two skills before the learner changes them, then checks the actual counter increments immediately after grading. Each new receipt stores:

- Exact ticker, close, input and grading timestamps; source and build identifier.
- Selected, suppressed or other-paper role; chosen side; original confidence; existing normalized input; outcome and squared error.
- Recorded ask, paper fee, hypothetical net and any legacy quote fallback. Missing real quotes remain MISSING.
- Market midpoint at the same input time, with its side orientation explicit. Inputs at or after close are marked as such and cannot claim an advance market comparison.
- Skill status and counters before/after the grade, plus MATCH, MISMATCH or MISSING for the increment check.

Receipts travel inside the existing durable ledger outbox and insert atomically with a new ledger row. Retries cannot replace a receipt. Older queued rows receive NULL for the new column. Historical ledger rows are not updated. The public JSON endpoint and the DRIFT/PULSE seat panels are read-only.

The audit is deliberately labeled `last_grading_input_not_booked_entry`. It does not manufacture an entry-time skill roster or convert grade-quote cents into booked profit. The existing legacy score still influences the learner; changing that influence requires a separately reviewed operating change.

## Still MISSING / next measurement

Historical per-fire timestamps, chosen skill/confidence pairs, exact per-fire market probabilities and quotes, rule-version fingerprints, and a validated mapping from strength to probability are MISSING. Replays retain seat direction and Chair confidence, not the complete historical skill inputs needed here. No historical Brier or grade is backfilled.

The next scientific comparison needs prospectively frozen entry-time observations and a probability model calibrated on earlier data only. Compare model and market on the same eligible windows, alongside actual after-fee cents and drawdown. The new late-window receipts explain the existing grader; they do not by themselves prove profitable calls.

## Validation

Tests execute the production grading functions and the production ledger insert, with unrelated threshold/fade side effects substituted. Coverage includes correct low-strength reads, UP/DOWN orientation, suppressed versus paper inputs, duplicate mirrors, skips, missing quotes, invalid inputs, counter mismatches, serialization, old outbox compatibility, migration idempotence, insert immutability and the real public reader query.

Paper only. No live trades. Not financial advice. Bitcoin only.
