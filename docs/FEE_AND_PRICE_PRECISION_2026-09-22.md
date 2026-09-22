# Fee engine and price precision — 2026-09-22

## 1. Fee engine

Engine `KALSHI_TAKER_7PCT_CEIL_CENT_V1`: `fee = ceil_to_cent(0.07 × C × P × (1 − P))`
per order, C contracts, P in dollars. **Provenance: ASSUMED.** The rule comes
from the repository (`clock.ts`, 2026-09-06). Kalshi's fee schedule was not
fetched in this pass (`FEE_PROVENANCE.fetched_at = null`); the KXBTC15M series
multiplier and effective date are UNKNOWN. Both audits assume the same rule;
they differ only on rounding and contract count.

| ask ¢ | raw 7·p·(1−p) ¢ | C=1 fee ¢ | C=100 order fee ¢ | C=100 per contract ¢ | external "1¢ flat" |
|---|---|---|---|---|---|
| 50 | 1.7500 | **2** | 175 | 1.75 | wrong at any C |
| 70 | 1.4700 | **2** | 147 | 1.47 | wrong at any C |
| 75 | 1.3125 | **2** | 132 | 1.32 | wrong at any C |
| 80 | 1.1200 | **2** | 112 | 1.12 | wrong at any C |
| 81 | 1.0773 | **2** | 108 | 1.08 | wrong at any C |
| 82 | 1.0332 | **2** | 104 | 1.04 | wrong at any C |
| 83 | 0.9877 | 1 | 99 | 0.99 | right at C=1 |
| 85 | 0.8925 | 1 | 90 | 0.90 | right at C=1 |
| 90 | 0.6300 | 1 | 63 | 0.63 | right at C=1 |
| 92 | 0.5152 | 1 | 52 | 0.52 | right at C=1 |
| 95 | 0.3325 | 1 | 34 | 0.34 | right at C=1 |
| 99 | 0.0693 | 1 | 7 | 0.07 | right at C=1 |

Boundary: 82¢ pays 2¢, 83¢ pays 1¢ (the first Audit A draft said 82¢; corrected).
The paper book trades C=1 (`contracts = 1` on all 190 rows), so the C=1 column
is the book's cost. `feeForContracts(ask, contracts)` rounds the order total
once (`src/lib/desk/fee-engine.ts`); `fee-engine.test.ts` pins both columns.

Effect on the external reconciliation: with a flat 1¢ fee, 108 of the 137
policy-era fills (those below 83¢) are under-charged by 1¢ each, which alone
moves the "implied" average ask by roughly 0.8¢ in Audit B's back-solve.

## 2. Price precision

Observed on the raw order book (`desk_lag_events.ask_before`, 98,209 rows,
2026-09-06 → 2026-09-22): 0.1¢ ticks **below 10¢** and **at or above 90¢**
(2,446 of 3,561 rows ≥90¢ are fractional: 90.1, 91.3, 92.5, 95.4, 98.6 …). No
fractional ask was ever observed between 10¢ and 90¢.

Where the desk rounds it away (all before any snapshot, fill, fee or edge):

| site | rule |
|---|---|
| `src/lib/desk/server-feeds.ts cents()` | Math.round |
| `src/lib/desk/kalshi-book.ts clampC()` | Math.round, bounded 1–99 |
| `src/lib/desk/replay.server.ts` | rounds the path to 0.1¢ |

Whole-cent surfaces: `desk_ledger.entry_cents` (0 of 190 fractional),
`desk_decision_snapshots.yes_ask/no_ask` (0 of 1,086), `desk_call_quality`
receipts (0 of 1,193), `desk_samples.market`.

Consequence: for the **28 historical fills at ≥90¢** the exact ask is UNKNOWN
to ±0.5¢ in either direction (`storedAskUncertaintyCents`). No fill between
10¢ and 90¢ is affected. At C=1 the fee is 1¢ across the whole 90–99¢ band, so
the ±0.5¢ moves net by at most ±0.5¢ per fill (≤14¢ over all 28 in the worst
case, sign unknown).

`src/lib/desk/price-precision.test.ts` pins the contract at 90.1, 90.4, 90.9,
95.5 and 99.1¢: on-grid, fee 1¢, all-in 91.1 / 91.4 / 91.9 / 96.5 / 100.1¢, and
a 99.1¢ buy cannot net positive even when it wins (100 − 99.1 − 1 = −0.1).

## 3. Status

| claim | status |
|---|---|
| fee is 1¢ at every price | AUDIT_B_ERROR for C=1; DIFFERENT_POPULATION (contract count) for C≥~50 |
| deci-cent ticks exist | CONFIRMED (<10¢, ≥90¢) |
| the desk books deci-cents | AUDIT_A behaviour: no, coerced; 28 fills carry ±0.5¢ uncertainty |
| 7% rule and series multiplier | UNKNOWN (ASSUMED by both audits) |

Nothing here changes production: the default engine, the coercion sites and
the ledger are untouched.
