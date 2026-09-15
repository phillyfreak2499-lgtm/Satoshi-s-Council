# Selective paper calls — September 15, 2026

The owner requested fewer calls and fewer losses. ENTRY_SELECTIVE_V1 is an explicitly chosen conservative operating rule, not a statistically proven promotion. Zero losses cannot be promised. A day with zero qualifying calls is valid.

## Admission rules

- At most three new paper calls per America/Chicago calendar day; pause after the first settled net loss. Existing calls and losses on activation day count.
- Block while an earlier closed position lacks an official result. Keep risk history separate from the clearable display log and restore it after restart. Save a new position before notifying.
- Revalidate the current team at the actual booking boundary. The previously added paperBookTeamOk helper was not called by production noteCall; it is now wired in and exercised by an integration test.
- Require three distinct healthy, unfolded supporters, at least two evidence groups, no opposing vote, a score above its current side's bar and all hard gates passing.
- Enter with 3–10 minutes remaining. Require three distinct qualifying observations spanning at least eight seconds.
- Require a real ask of at least 80 cents and below 99, spread at most two cents, resting size, consistent fresh feeds and no crossed quote.
- Main model edge must be at least three cents after fees. The separate settlement-index estimate must also cover the actual ask and fee, with a fresh index observation.

The replay's fair value is the settlement-index research model; it is not the main model used by the old entry guard. Differences between these estimates do not by themselves prove that the old fee guard failed.

## Records and evaluation

FLOOR_SELECTIVE_V1 has a new entry-policy identifier. The idempotent migration retires the prior champion without rewriting prior observations. Activation begins at a clean 15-minute market boundary. Old fills settling later retain their old policy label.

The earlier 80-versus-70 price-floor comparison is archived before this change. The frame now exposes selected and unfiltered research summaries. The latter captures the same current signal before selective admission; it is not a fully independent replay of the old engine. These summaries cover retained recent records (up to 160 each), not all-time totals. They create no orders or notifications.

Keep HOLD as the operational exit. The existing prospective TAKE90_V2 experiment continues as research. Do not choose an exit rule from four losing paths alone.

Judge the next prospective sample by call count, losses, net after fees, average win/loss and missed opportunities. A lower call count or a short winning streak does not establish a better prediction model. Do not loosen thresholds automatically to meet a call quota.

## Verification

Focused tests exercise daily limits, Central daylight saving time, history restoration, exact settlement identity, both models, deteriorating quotes, sustained confirmation and the actual production booking function. The repository CI additionally checks types, lint, all tests, migration replay, production build and server startup before merge.
