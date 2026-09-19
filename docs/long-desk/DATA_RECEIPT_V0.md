# Long Desk data receipt v0

**Status:** FROZEN for Briefs #001–#004  
**Decision authority:** Long Desk research only

## Canonical source

- Instrument: **BTC-USD**
- Provider: **Yahoo Finance chart endpoint**
- Interval: **1d**
- Timezone: **UTC**
- Field: **daily close**
- Endpoint family: `https://query1.finance.yahoo.com/v8/finance/chart/BTC-USD?...&interval=1d&events=history`

Do not silently substitute another provider for a v0 Brief.

## Weekly review snapshot

Review time: **Monday 00:00 UTC**.

Let Monday be review time `R`. The snapshot day `t` is the immediately preceding Sunday UTC calendar date.

`C(t)` is the canonical source's completed daily close for that Sunday.

A Brief must not score from an intraday / partial Monday bar.

## Freshness

The weekly score may be produced only after the canonical response contains the expected Sunday row.

A source is **fresh for review R** when:

1. the response contains exactly one finite close for the expected Sunday UTC date;
2. the newest required decisive row is that Sunday or later; and
3. the fetch is performed after the Monday review boundary, not from a cache captured before Sunday completed.

If the expected Sunday row is not available when the Brief is prepared, the required decisive input is **missing**. Do not substitute Saturday, Monday intraday, an exchange tick, or another provider.

## Exact calculations

All lookbacks are calendar-day close-to-close calculations on the canonical daily series.

### 30-day return

`ret30(t) = C(t) / C(t - 30 days) - 1`

30-day check is positive iff:

`ret30(t) > 0`

### 90-day return

`ret90(t) = C(t) / C(t - 90 days) - 1`

90-day check is positive iff:

`ret90(t) > 0`

### Trailing-365-day closing high

`H365(t) = max(C(d))` for every calendar day `d` from `t - 364 days` through `t`, inclusive.

This is a **closing high**, not an intraday high.

### Drawdown from trailing-365-day high

`DD(t) = C(t) / H365(t) - 1`

### Four-week-ago drawdown

`DD4W(t) = C(t - 28 days) / H365(t - 28 days) - 1`

### Drawdown-healing check

Positive iff:

`DD(t) > DD4W(t)`

Example: -34% is healing versus -43%.

## Missing-data behavior

A decisive input is missing if any required close is:

- absent,
- non-finite,
- duplicated ambiguously,
- not fresh under the rule above,
- or the full trailing-365-day closing-high window cannot be reconstructed.

Do **not** interpolate or backfill from a different provider.

Frozen v0 behavior:

- If current stance is **STAND**, missing decisive data leaves it **STAND**.
- If current stance is **HOLD**, missing decisive data moves it to **STAND**.
- A missing-data week cannot count as one of the two consecutive 3/3 reviews needed for STAND → HOLD.

## Precision

- Compute using the provider's full returned values.
- Transition logic uses unrounded values.
- Display percentages to one decimal place.
- Exact zero is not positive.

## Context that cannot decide v0

These may be described, but cannot change a v0 stance:

- 7-day return
- intraday high / low
- volume
- funding
- open interest
- Fear & Greed
- macro events

Chair calls, live seats, Kalshi strike / book, countdown, and Floor P&L are prohibited entirely.

## Change control

Changing provider, review clock, close field, lookback, high definition, freshness, missing-data behavior, positivity rule, or transition logic creates a **new version**.

Briefs #001–#004 stay on v0. Historical results may not be rewritten under a later version.
