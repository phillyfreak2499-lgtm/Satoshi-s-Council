# EXECUTION_LAB_V1 — owner-requested seven-arm paper study

Authorized scope: Zach's October 2 request and clarification. LATE120 must skip early entries and independently watch for a fresh qualifying entry in the final two minutes. No production rule changes are authorized.

## Frozen rules

| Arm | Definition |
|---|---|
| GAIN10 | First observed held-side bid at least entry ask +10¢; sell once. This is a price gain, not +10¢ net. |
| BELOW50 | First observed held-side book midpoint strictly below 50¢; sell once at the contemporaneous bid. Midpoint is a market-price proxy, not calibrated win probability. |
| CLOSE120 | An entry strictly earlier than T−120 sells at the first observed usable bid at or after T−120. Later entries HOLD. |
| CLOSE60 | Same, with T−60. |
| LATE120 | Separate shadow book. No entry earlier than T−120. First fresh qualifying entry in (0,120] seconds remaining; HOLD. Recompute Chair on a private learner copy with production entry_lean cleared, reuse actual producer votes, time softening, Chair hysteresis and selective admission, and use only this arm's own durable risk calls. No unmuting or gate bypass. |
| TRAIL5 | Arm only after the held-side bid reaches entry +10¢. Track highest observed bid; sell on the first 5¢ retreat from that high. Otherwise HOLD. |
| NET10 | First bid at which bid − entry ask − entry fee − exit fee is at least +10¢. Otherwise HOLD. |

One contract. One entry and at most one exit per arm/window. No re-entry. Exit arms share the actual primary paper entry. Canonical main book, follower, learner, admission, floors, thresholds and alerts are unchanged.

## Prior-study check, October 2

Source main: 80a35b16460c2b817221a07e2881294e449e0220. Checked registry, Exit Arena, archived scalp, loss-review document, all fetched git history, registered durable shadow manifests and distinct durable policy observation IDs.

Existing exact exit IDs: HOLD_V1, PROVE120_V1, PROVE180_V1, PROVE240_V1, TAKE90_V1, TAKE90_V2. The latter is a fixed 90¢ target with positive net, not relative +10¢ net. PROVE requires a relative +10¢ gain by an elapsed-after-entry deadline and then HOLDS; it does not sell on that gain or at a fixed pre-close clock time. Archived September 14 exploratory stop was a 20¢ loss and combined 90¢ target, not a market-midpoint-below-50 trigger.

Selling on a Chair flip existed in the retired scalp era and was rejected as a new idea. TRAIL5 and NET10 replace it. No exact duplicate of the seven rules was found in those sources. This does not establish that no undocumented off-repository experiment ever existed.

## Cohort and measurement

Default OFF: EXECUTION_LAB_V1_ENABLED=true is required. First activation stores a durable start at the NEXT complete UTC market open and an end exactly 21 days later. Restarts preserve both timestamps and skip the already-open window; no backfill and no reset. No extension or mid-run tuning. New definition requires a new study ID and zero new prospective observations.

Capture nominally every four seconds, at most 226 samples per window, only beside the engine. Existing resource governor must allow execution before any SQL or frame read. Guard/busy skips, DB failures, missing opening, missing pre-close coverage or >10s capture gaps exclude a window. Unusable books are not interpolated. Early simulations use only the observed prefix up to the first sale; the collector additionally requires a complete shared window for paired research. No intratick crossing is inferred. Bid-price simulations do not prove order fillability or latency survival; displayed prices are not quoted as actual trades.

Book odds use the held-side midpoint; a sell uses YES bid for UP and 100−YES ask for DOWN. Both fees reuse the incumbent one-contract conservative fee function. HOLD pays only entry fee. Official result comes only from an exact ticker/close join to desk_ledger_research with source kalshi-result. Quarantined outcomes never grade this study.

Six exit arms compare with primary HOLD on identical entries and valid paired windows. LATE120 compares with primary HOLD on every complete observed window, counting an honestly observed sit as 0, and reports its entry count separately. Its own hold outcome supplies daily risk; primary book performance must not substitute for that risk history. Invalid capture is not a sit and not 0¢. Pending official outcomes remain pending.

Primary decision metric: total after-fee difference from the paired control across the frozen window population. Also report fills, valid windows, exclusions, skipped windows, average net, paired drawdown and daily stability before any production recommendation. The initial UI shows sample/net/control/delta/missingness; a positive point estimate alone is not sufficient evidence. Seven comparisons create selection bias; any winner needs a separately frozen confirmation period and explicit owner acceptance. No automatic promotion. Neither this research nor a favorable result changes thresholds, floors or booking rules.

## Release acceptance

Require model boundary tests, real late-entry admission tests, persistence/restart/duplicate/invalid-capture tests, typecheck, meaningful source rails, migration apply and exact-head CI. Before activation, verify the existing resource witness is fresh, running commit includes the study, and the first complete window has a durable capture. Before claiming running, verify actual last capture and prospective start. Activation must not change any subscriber alert hold. No paid service or extra worker is required; per-window storage and recorder CPU/DB work still need deployment verification.

This implementation is a draft until those gates pass. It does not authorize merging other PRs or releasing other studies.
