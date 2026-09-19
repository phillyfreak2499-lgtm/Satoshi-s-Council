# Long Desk data receipt v0

**Status:** frozen research receipt for the four-Brief experiment  
**Decision authority:** none outside the Long Desk research branch

## Source

Research reference series:

- Symbol: **BTC-USD**
- Provider: Yahoo Finance chart endpoint
- Interval: **1d**
- Timezone: **UTC**
- Field used: **daily close**
- Historical request used for the v0 sanity check:
  `https://query1.finance.yahoo.com/v8/finance/chart/BTC-USD?period1=1725148800&period2=1789862400&interval=1d&events=history`

This is a reproducible research reference, not an exchange settlement feed and not a Floor input.

Before public launch, source/licensing and production suitability must be reviewed separately. Do not silently substitute another feed because values look cleaner.

## Weekly snapshot

The Long Desk review clock is **Monday 00:00 UTC**.

The snapshot uses the **completed Sunday UTC daily close** immediately preceding that Monday.

Example:

- review: Monday 2026-09-14 00:00 UTC
- price row: Sunday 2026-09-13 daily close

No partial current-day bar may be used.

## Decisive calculations

Let `C(t)` be the completed daily close at the snapshot day.

### 30-day structure

`ret30 = C(t) / C(t - 30 calendar days) - 1`

Positive iff `ret30 > 0`.

### 90-day structure

`ret90 = C(t) / C(t - 90 calendar days) - 1`

Positive iff `ret90 > 0`.

### Trailing-365-day closing high

`H365(t) = max daily close from t-364 through t, inclusive`

This is explicitly a **closing high**, not an intraday high.

### Current drawdown

`DD(t) = C(t) / H365(t) - 1`

### Four-week-ago drawdown

`DD4W = C(t - 28d) / H365(t - 28d) - 1`

### Drawdown healing

Positive iff:

`DD(t) > DD4W`

Example: -34% is healing versus -43%.

## Missing-data rule

If any required close is absent, non-finite, duplicated ambiguously, or the 365-day window cannot be reconstructed:

**the decisive check is unavailable and the weekly stance cannot improve.**

For v0:
- STAND remains STAND.
- HOLD moves to STAND if a decisive input cannot be reproduced.

Do not interpolate a missing decisive close.

## Precision

- Compute from full provider values.
- Display percentages to one decimal place in a Brief.
- State transitions use the unrounded values.
- Exact zero is not positive.

## What this receipt does not include

These may appear as descriptive context but are not v0 decisive inputs:

- 7-day return
- intraday high/low
- volume
- funding
- open interest
- Fear & Greed
- macro events

The current Chair verdict, live seats, Kalshi strike/book, countdown and Floor P&L are prohibited entirely.

## Change control

Any change to:
- provider,
- review clock,
- close field,
- lookback length,
- high definition,
- missing-data handling,
- positivity rule

creates a **new receipt version**.

Do not rewrite v0 historical results under a new receipt.
