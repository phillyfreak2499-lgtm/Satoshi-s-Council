# Long Desk v0 historical sanity check

**Run date:** 2026-09-19  
**Purpose:** test state-machine behavior only; **not** optimize thresholds or claim predictive value  
**Receipt:** `DATA_RECEIPT_V0.md`

## Population

- Daily BTC-USD reference rows: 749
- Source span: 2024-09-01 through 2026-09-19
- Weekly reviews tested: **55**
- Review Mondays: 2025-09-01 through 2026-09-14
- Each review used the completed Sunday close.
- Starting state: STAND.
- State rule frozen before this check:
  - STAND → HOLD after two consecutive 3/3 reviews
  - HOLD retained at 2/3 or 3/3
  - HOLD → STAND at 0/3 or 1/3

## Result

**V0 fails the product sanity check. Do not promote it.**

State occupancy:

- **STAND: 50 / 55 weeks (90.9%)**
- **HOLD: 5 / 55 weeks (9.1%)**

Check-count distribution:

- 0/3: 23 weeks
- 1/3: 8 weeks
- 2/3: 16 weeks
- 3/3: 8 weeks

## State runs

| State | Start review | End review | Length |
|---|---|---|---:|
| STAND | 2025-09-01 | 2025-09-29 | 5 weeks |
| HOLD | 2025-10-06 | 2025-10-06 | 1 week |
| STAND | 2025-10-13 | 2026-05-11 | 31 weeks |
| HOLD | 2026-05-18 | 2026-05-18 | 1 week |
| STAND | 2026-05-25 | 2026-08-24 | 14 weeks |
| HOLD | 2026-08-31 | 2026-09-14 | 3 weeks |

## Transitions

### 2025-10-06 — STAND → HOLD
- checks: 3/3
- 30d: +11.6%
- 90d: +14.0%
- drawdown: 0.0%
- four-weeks-ago drawdown: -9.9%

### 2025-10-13 — HOLD → STAND
- checks: 0/3
- 30d: -0.8%
- 90d: -3.9%
- drawdown: -7.7%
- four-weeks-ago drawdown: -6.4%

**Problem:** HOLD existed for one week.

### 2026-05-18 — STAND → HOLD
- checks: 3/3
- 30d: +0.4%
- 90d: +12.5%
- drawdown: -37.9%
- four-weeks-ago drawdown: -40.8%

### 2026-05-25 — HOLD → STAND
- checks: 1/3
- 30d: -0.6%
- 90d: +19.1%
- drawdown: -38.3%
- four-weeks-ago drawdown: -36.9%

**Problem:** HOLD again existed for one week.

### 2026-08-31 — STAND → HOLD
- checks: 3/3
- 30d: +23.6%
- 90d: +8.9%
- drawdown: -37.7%
- four-weeks-ago drawdown: -49.1%

HOLD then remained through the last tested review, 2026-09-14.

## Why this is a failure

The rule was intended to create a slow ownership-research state.

Instead:

1. **STAND dominates.** A 31-week STAND run means the product risks becoming a static "do nothing" page.
2. **Confirmation does not create persistence.** Twice, the rule required two constructive weeks to earn HOLD and then lost HOLD one week later.
3. **The checks are correlated.** 30d return, 90d return and drawdown healing are all derived from the same price series. Calling them "three checks" overstates evidence diversity.
4. **HOLD is too easy to revoke relative to how hard it is to earn.** The intended hysteresis did not produce a stable state.
5. **A 3/3 can be shallow.** The 2026-05-18 promotion included only +0.4% on the 30-day check. V0 treats barely-positive and strongly-positive identically.

These are product-behavior problems. They do not prove the signals are bad predictors.

## What this check does NOT justify

Do **not** now search historical data for a prettier threshold.

Specifically, this check does not authorize:
- changing 30d from >0 to +X%
- changing 90d thresholds
- changing two confirmations to three or one
- changing the HOLD exit count
- optimizing drawdown-healing magnitude
- adding historical returns until a desired HOLD ratio appears

Doing that on this same sample would convert a sanity check into curve fitting.

## What it does justify

V0 remains an archived failed candidate.

The next Long Desk rule must be designed from product logic with a different evidence structure, then tested prospectively / on a held-out period.

At minimum, the next candidate should address:

- **evidence diversity:** not three transformations of price alone
- **persistence:** HOLD should mean something that can survive ordinary weekly noise
- **clear distinction:** HOLD and STAND must not both feel like "do nothing"
- **no Floor leakage:** slow derivatives/context must be independently aggregated
- **no historical beautification:** choose the rule before inspecting a fresh evaluation population

## Current live experiment implication

Brief #001 remains **STAND** because the public-product experiment began on 2026-09-19 and has no prior recorded Long Desk review.

The historical test is a diagnostic. It does not retroactively manufacture a public stance history.

## Verdict

**FAIL / LEARN**

The wall between products survives.

The v0 state machine does not.
