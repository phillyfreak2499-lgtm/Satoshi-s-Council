# Settlement semantics — 2026-09-22

Bound: windows with `close_time ≤ 2026-09-22T00:00:00Z`. Sources: `desk_replay`
(strike per window), `desk_ledger` (`official_value`, `settle_last`, `winner`,
source `kalshi-result`). Nothing here changes how the desk settles.

## 1. What the strike is

Kalshi's `floor_strike` for a KXBTC15M window is the **prior window's official
settlement value** (the external audit's reading). Checked on the desk's own
data by joining each window's recorded strike to the ledger row that closed 15
minutes earlier:

| bucket | windows |
|---|---|
| windows with a replay strike | 1,362 |
| with a prior-window ledger row | 1,357 |
| strike = prior official value (to the cent) | **1,337** |
| strike ≠ prior official, strike on the $25 proxy grid | **9** |
| strike ≠ prior official, not on the grid (all 2026-09-07 → 2026-09-10) | **11** |
| no prior ledger row | 5 |

Status of the external claim: **CONFIRMED** (1,337 / 1,357). The earlier
internal figure "1,327 of 1,346" used a narrower bound and is superseded by
this table.

The 9 grid strikes are the desk's own fallback: `live.ts` builds a proxy
strike `Math.round(spot / 25) * 25` when the Kalshi market row carries no
`floor_strike` (`strike_source = "PROXY round(spot)"`). They are
SEP101615, SEP101815, SEP111115, SEP121615, SEP122230, SEP142330, SEP160845,
SEP170715 and SEP200115, off the official prior settlement by $7.82 to $72.31.
Whether the official market strike differed from the proxy on those nine
windows is UNKNOWN from this database; the ledger's `winner` on them came from
`kalshi-result`, so the *result* is official even where the *strike shown to
the desk* was a proxy.

The 11 early-era mismatches (−$314 to +$104, 2026-09-07 → 2026-09-10) predate
the 70¢ floor. Cause UNKNOWN (a stale `floor_strike` on the first market
fetch of a window is the leading candidate; the 0057/0058 tables do not cover
that era). They touch no policy-era fill.

## 2. Ties

`winner ∉ {UP, DOWN}` on 0 ledger rows. A settlement exactly at the strike has
never been observed; the desk's tie handling is therefore untested on real
data and is not claimed here.

## 3. Official value vs the desk's own settle estimate

`official_value = settle_last` (to the cent) on **0** rows. The desk's last
BRTI print is never the official settlement to the cent; only `official_value`
is the record, and every economic identity in `docs/METRIC_CONTRACT.md` uses
`winner`, never a desk-side price comparison.

## 4. Dependency map — who reads the strike

| module | reads | role |
|---|---|---|
| `src/lib/desk/server-feeds.ts:323` | `floor_strike ?? strike ?? yes_sub_title ?? cap_strike` from the Kalshi market row | feed parse (whole market) |
| `src/lib/desk/live.ts:37,152,180` | proxy `round(spot/25)*25` when the market strike is missing; tags `strike_source` | snapshot builder (the only writer of a proxy) |
| `src/lib/desk/server-engine.ts:1843` | `row.floor_strike` | replay / window bookkeeping |
| `src/lib/desk/brti.ts` | prior-window settlement, 2 dp | settlement index comment |
| `src/lib/desk/hour.ts`, `hour-closer.ts`, `hour-research.ts` | `floor_strike ?? parsed.strike` | hourly book (separate market) |
| `server/routes/tape.get.ts:61` | `floor_strike` | public tape display |
| `src/lib/desk/shadow-lab.server.ts` | none (settles from `desk_ledger.winner` only) | research |

Settlement of every book (paper, shadow, research) keys on `winner` from the
`kalshi-result` ledger row. No module derives a win from `spot` vs `strike`
at close except as a display or a research feature.
