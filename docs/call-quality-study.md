# Entry-time call-quality study

`entry-time-v1` is an observational experiment. It has no route to change the Chair, entry rules, exits, learner weights or promotion status. Existing HOLD/exit trials continue under their frozen rules.

## Frozen protocol

- Capture the first observed decision frame in [450,462), [300,312) and [180,192) seconds before each close. Frames must be no older than ten seconds, and saves must complete within ten seconds of the frame. Missed checkpoints are never reconstructed.
- Store the finalized frame's raw seat directions and strengths, Chair direction and strength, every admission check, both sides' quotes and sizes, regime, session, entry-policy identity, model coefficients, training cutoff, and build SHA. Strength is not treated as a calibrated probability.
- A separate model is fit for each checkpoint and entry-policy identity. Fit only this study's earlier, quality-valid, officially graded observations whose grade existed before the target frame. At least 240 training windows are needed; keep the latest 1,800. Warm-up predictions are the market prior and do not count as challenger evidence.
- Reuse Chair v3's fixed market-prior logistic correction: feature roster STRIKE/DRIFT/STREAK/CASCADE/CHAIN/TAPE/WICK/FADE/fair_gap, ridge 0.12, 450 gradient steps, learning rate 0.035, maximum correction 10 percentage points. Changed model math or sampling rules require a new study ID and fresh evidence.
- Compare paired probability error (Brier score), log loss, and calibration against the same-time market probability. A seat's raw accuracy is compared with market direction over that seat's identical healthy, directional population. No time horizons or policy versions are pooled.
- A quoted-cost hypothetical requires an 80¢ to below 99¢ ask, spread no greater than 2¢, at least one resting contract, healthy fresh feeds and at least 3¢ predicted edge after the desk's rounded one-contract taker fee. Hold to the official result. Also report an extra 1¢ cost per hypothetical call. This is a price-based scenario, not verified execution or a replacement for the live admission rules.
- Both market identity witnesses must agree. Invalid captures, later quarantines, proxy outcomes and missing outcomes cannot contribute to training or scored results. Pending and excluded counts remain visible. Coverage measures due checkpoints since the first retained receipt, with ten seconds allowed for an in-flight save.
- Review minimums per policy and checkpoint are 300 graded paired forecasts, 30 calendar days since the first paired forecast, and 250 priced hypothetical calls. These are collection thresholds, not promotion tests. Review must additionally consider net results and uncertainty, correlated windows, calibration, costs and regime coverage. Testing three checkpoints does not produce three independent confirmations.

## Existing records

Booked-call reports use `desk_policy_fills` provenance, exact ticker/close joins and official outcomes in the research view. They report hold-to-settlement results after the recorded entry fee, grouped by the full signal/entry/risk composition. Historical entries without a stored identity are unassigned; policies are never inferred from dates. All reports show a rolling 90-day scope.

The older Chair v3 training/report queries now use the quality-filtered official ledger and verified market identities. Corrected prospective rows carry `valid-official-v2`; legacy unfiltered rows retain their own label and are excluded from the corrected report. The new timing experiment does not seed itself with those legacy samples.

The admission audit reads the actual `selectiveBookOk` verdict and records additional checks independently. It cannot authorize an entry. Its failure is caught, producing no receipt instead of interrupting a decision. The existing live rule parameters are unchanged; one stale explanation was corrected to say two supporters, matching the current rule.

## Operations and rollback

The health heartbeat starts the observer beside the engine. The observer only inserts immutable rows into `desk_call_quality`; outcomes are joined later. The public Lab exposes aggregates, recorder health, coverage and warm-up status. Detailed market and model receipts stay in the database.

To stop collection, remove the `ensureCallQualityObserver` heartbeat import. Retain the table for evidence. No history needs deleting, no paper positions need changing, and no policy rollback is required. Optional report failure appears as unavailable, not a zero result.
