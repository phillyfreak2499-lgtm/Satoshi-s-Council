# Selector vs floor — 2026-09-22

Question: how much of the paper book's result is the price floor, and how much
is the Chair's selection on top of it? Everything here is computed on the
desk's own `desk_replay` quote paths (4 s ticks, whole-cent asks) and
labelled **MARKET_BASELINE**. It is not a Chair backtest: the blind rules never
saw a vote, a seat, a gate or a Chair state. Source cells:
`docs/audit/market_baseline_2026-09-22.json`; code: `src/lib/desk/market-baseline.ts`,
`src/lib/desk/trial-decomposition.ts`.

## 1. The 442-window trial (2026-09-10T23:00Z → 2026-09-15T14:05:13Z)

442 ledger windows; 440 have a replay path. On those 440:

| book | fills | avg ask | fee | WR | needed | net | per fill | max DD |
|---|---|---|---|---|---|---|---|---|
| **live Chair @80¢** (actual) | 91 | 84.13 | 1.53 | 87.9% | 85.66% | **+205** | **+2.25** | −258 |
| shadow Chair @70¢ (actual, same 91 + 11 more) | 102 | — | — | — | — | **−10** | −0.10 | — |
| blind 80¢ first touch, MID 180–600 s | 374 | 82.17 | 1.73 | 84.5% | 83.90% | +221 | +0.59 | −567 |
| blind 70¢ first touch, MID | 418 | 75.54 | 1.83 | 77.5% | 77.38% | +57 | +0.14 | −795 |
| matched controls for the 91 live fills | 8,801 (pooled) | 82.57 | 1.63 | 85.3% | 84.20% | — | **+1.05** | — |

Matched-control method: for each live fill, every unselected trial window whose
favourite ask at the same seconds-left (±45 s) was within ±2¢; the control buys
that favourite. Controls repeat across fills, so the 8,801 is a pooled count,
not independent windows.

The Chair's selected fills beat the blind first-touch buyer at the same floor
by +1.66¢/fill and the price-and-time matched controls by +1.20¢/fill. With 91
fills (WR 87.9% vs 85.3%, Wilson lower bound 79.6%) that gap is **not
separable from zero**. Direction favours the selector. Status: UNKNOWN.

## 2. The +215 decomposed exactly

`live_net − shadow_net = 205 − (−10) = +215`

| component | cents | rows | note |
|---|---|---|---|
| A. price on shared fills | −426 | 91 | live paid 84.13¢ avg, shadow 79.45¢ |
| A. fee on shared fills | +11 | 91 | higher asks pay less fee |
| **A total** | **−415** | | identity check passes row by row |
| B. lower-floor-only fills avoided | **+630** | 11 | the 70¢ shadow filled 11 windows the 80¢ book did not; 2 won, 9 lost (`docs/audit/trial_shadow70_only_rows_2026-09-22.csv`) |
| C. settlement / accounting | 0 | | same official winner, same identity |
| D. fee engine | 0 | | one engine on both books |
| **sum** | **+215** | | `sums_exactly: true` |

So the 80¢ floor did not "earn" 215¢. It paid 415¢ more for the same 91
positions and avoided 630¢ of losses on 11 positions it never took. Whether
those 11 windows are representative of what a 70¢ floor would keep taking is
exactly the question the blind rows answer for the wider population.

## 3. Blind floors on the wider population (MARKET_BASELINE, split 2026-09-14T12:00Z)

| rule | TRAIN (656 w) | TEST (706 w) |
|---|---|---|
| 70¢ MID first touch | −0.20¢/fill (n=640) | −2.61 (681) |
| 80¢ MID first touch | −1.23 (582) | −1.76 (630) |
| 85¢ MID first touch | +0.42 (512) | −1.52 (575) |
| 70¢ FULL 15–900 s | −0.83 (651) | −2.24 (696) |
| 80¢ FULL | −2.77 (650) | −1.55 (695) |
| 85¢ FULL | −2.17 (649) | −1.28 (695) |

Every blind floor is negative out of sample. The only positive blind cells are
inside the trial windows themselves (80¢ MID on trial-TRAIN +1.38/fill, 85¢
MID +2.04), i.e. the four days the floor was chosen on. That is the
1,440-window trap in miniature: a floor tuned to its own window.

## 4. What this means for the selector question

- The live Chair's +2.25¢/fill sits above every blind rule and above the
  matched controls, on 91 fills. It is consistent with a real selection effect
  and consistent with luck. The shadow experiments (E1 package, NULL_FAV
  benchmarks) are the instrument that can separate them prospectively.
- Nothing here supports lowering the floor (blind 70¢ is worse everywhere) or
  raising it (blind 85¢ flips sign).
- The blind-floor summaries carry `kind: "MARKET_BASELINE"`; `assertBaseline`
  throws on anything else and a rail keeps the artifact free of the string
  `CHAIR_BACKTEST`.
