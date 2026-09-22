# External audit reconciliation — 2026-09-22

As-of `2026-09-22T00:00:00Z`. Branch `claude/audit-reconcile-external-20260922`
(child of `claude/satoshis-council-audit-9zffy6`). Paper only. Nothing in this
pass changes production Chair behaviour; only measurement infrastructure is
activated (§9). Machine-readable twin: `docs/audit/external_reconciliation.json`.

**Audit A** = the internal repo/database audit (`docs/QUANT_AUDIT_2026-09-22.md`,
`docs/EVIDENCE_REPORT_2026-09-22.md`). **Audit B** = the independent external
Kalshi market-data audit. Its `kx/*` data is not in this repository; its claims
are reproduced here on the desk's own replay paths and labelled
**MARKET_BASELINE**, never `CHAIR_BACKTEST`. Conflicting numbers stay side by
side. Nothing is averaged.

## 1. Verdict table

| id | claim | Audit A | Audit B | status | why |
|---|---|---|---|---|---|
| C01 | avg entry ask | 79.72¢ (190 fills); 82.16¢ (137 policy-era HOLD fills) | 76.5¢ "implied" | **AUDIT_B_ERROR** | B back-solved from a headline that pools 24 exit-priced legacy rows, uses a flat 1¢ fee and counts positive-net rows as wins |
| C02 | wins | 140 official / 190 (117 / 137 policy era) | 149 | **AUDIT_B_ERROR** | 9 legacy early exits closed positive without settling in the money; a positive net is not a win |
| C03 | live/shadow commingled | no: separate columns, never summed | yes | **DIFFERENT_POPULATION** | B saw the all-time headline (+92) that pools A0 legacy exits with HOLD rows; that is era pooling, not live/shadow pooling |
| C04 | fee 1¢ everywhere | ceil(7·p·(1−p)): 2¢ 18–82¢, 1¢ 83–99¢ at C=1 | 1¢ flat | **AUDIT_B_ERROR** (C=1) | official Kalshi schedule effective 2026-07-07 verifies the 0.07 formula/default M=1 and the published one-contract table matches the charged engine; KXBTC15M is not listed as non-standard |
| C05 | 0.1¢ ticks exist | yes, <10¢ and ≥90¢; desk coerces to whole cents | yes | **CONFIRMED** | 28 fills ≥90¢ have an exact ask UNKNOWN to ±0.5¢ |
| C06 | strike = prior official settlement | yes on 1,337/1,357; 9 windows on the desk's $25 proxy grid; 11 early-era (Sep 7–10) mismatches of UNKNOWN cause; no ties ever | yes | **CONFIRMED** | the 9 proxy and 11 early windows are listed in `docs/SETTLEMENT_SEMANTICS_2026-09-22.md` |
| C07 | 80¢ trial +215 vs 70¢ shadow | +215 = −415 (shared price −426, fee +11) + 630 (11 avoided losers) + 0 + 0 | +215 "the floor" | **CONFIRMED** | arithmetic confirmed; the higher floor *cost* 415¢ on shared fills and *saved* 630¢ by skipping 11 losers |
| C08 | selector adds nothing beyond floor | live +2.25¢/fill (n=91) vs blind-80 +0.59 vs matched controls +1.05 | ≈ floor | **UNKNOWN** | WR 87.9 vs 85.3 on 91 fills is not separable |
| C09 | blind 80¢ buyer loses both halves | MID: −1.23 train, −1.76 test; FULL: −2.77, −1.55 | negative | **CONFIRMED** | on 1,362 internal windows, split 2026-09-14T12:00Z |
| C10 | MIRROR-35 +1.89¢/fill | +1.89 train (n=293) → −0.60 test (n=299) | +1.89 | **CONFIRMED** (train) | sign flips out of sample; ~60 cells searched; registered CANDIDATE_NOT_COLLECTING |
| C11 | jump-chase profitable | +0.13 train → −1.91 test | +0.13 | **CONFIRMED** (train) | sign flips |
| C12 | late 95–99¢ loses | −1.72 train, −1.55 test | negative | **CONFIRMED** | |
| C13 | WAIT rate inflated by chalk | raw/ex-chalk: 97.4/97.4 (T−450), 96.6/96.6 (T−300), 97.2/96.6 (T−180) | inflated | **AUDIT_B_ERROR** | chalk moves WAIT by <1 point at every checkpoint |
| C14 | 1,440-window sample | 1,362 windows with paths (1,176 complete) | 1,440 | **DIFFERENT_POPULATION** | external sample not reproducible here; nothing tuned to either |
| C15 | seat review is a one-way ratchet | yes: every seat with 8+ legs is under the 15¢ floor | not measured | **CONFIRMED** | `docs/SEAT_REVIEW_FREEZE_DECISION_2026-09-22.md` |
| C16 | 2-seat quorum reachable | never on 2,069 seat-read ticks (only DRIFT and INDEX ever directional, never together) | not measured | **CONFIRMED** (7 h population) | UNKNOWN before 2026-09-21T17:06Z |
| C17 | a 92¢ cap helps | 15 fills ≥92¢, all won, +75¢: the cap would have cost 75¢ | recommended | **UNKNOWN** | no support for the cap; no proof of edge above 92¢ (Wilson LB 79.6 vs need 95.0) |
| C18 | price-aware gate beats flat 3¢ | model edge at entry not stored; on the index-edge proxy every variant removed more winners than losers (no gate +276 vs best variant +122, n=89; oracle +1105) | yes | **UNKNOWN** | evaluation only |
| C19 | 17/17 and 19/19 prove edge | Wilson LB 81.6% vs need 90.5%; 83.2% vs 84.0% | proof | **UNKNOWN** | PROMISING_INSUFFICIENT; card-level booked asks UNKNOWN |
| C20 | market Brier by horizon | 0.165 (450 s), 0.133 (300 s), 0.104 (180 s), 0.048 (60 s) | calibrated | **CONFIRMED** | reference only |
| C21 | Audit A draft: fee boundary "1¢ from 82¢" | corrected (a72e158) | — | **AUDIT_A_ERROR** | 82¢ pays 2¢; 83¢ pays 1¢ |
| C22 | Audit A draft: ev-positive rows counted as wins in one table | corrected to 140 official | — | **AUDIT_A_ERROR** | same trap as C02 |

Counts: CONFIRMED 10 · DIFFERENT_POPULATION 2 · AUDIT_A_ERROR 2 · AUDIT_B_ERROR 4 · UNKNOWN 4.

## 2. The 190-row breakdown

`docs/audit/ledger_190_rows_2026-09-22.csv` (one row per ledger fill, generated
from `desk_ledger` at as-of; columns include era, ledger tag, entry ask, exit
price, settlement value, official winner, booked side, contracts, fee
methodology, stored and recomputed HOLD net, identity flag, official win).

| era | rows | HOLD identity rows | legacy exit / scratch | official wins | stored net |
|---|---|---|---|---|---|
| A0 pre-floor (< 2026-09-08 20:47Z) | 53 | 29 (net −16) | 24 (net −118) | 23 | −134 |
| A1 70¢ floor | 45 | 45 | 0 | 36 | +4 |
| B 80¢ trial | 91 | 91 | 0 | 80 | +205 |
| C2 selective v3 | 1 | 1 | 0 | 1 | +17 |
| **all** | **190** | **166** | **24** | **140** | **+92** |

Policy-era (A1+B+C2) one-contract HOLD fills: 137, 117 official wins (85.4%),
average ask 82.16¢, needed 83.75%, net +226. Wilson 95% lower bound on the win
rate: 78.5%. The external "149 wins at 76.5¢" cannot be reconstructed from any
sub-population of this file (`src/lib/desk/ledger-identity.test.ts` checks the
formula against the rows).

## 3. Fees and price precision

See `docs/FEE_AND_PRICE_PRECISION_2026-09-22.md`. C=1 vs C=100 at every asked
price, charged-engine provenance VENUE_TABLE_VERIFIED_2026_07_07 (official schedule fetched 2026-09-22); sub-cent centicent research treatment remains ASSUMED, 0.1¢ ticks observed
only below 10¢ and at/above 90¢, and where the desk rounds them away.

## 4. Settlement semantics

See `docs/SETTLEMENT_SEMANTICS_2026-09-22.md`: strike source, the 9 proxy
windows, tie handling (never observed), and the module dependency map.

## 5. Floor vs selector and the +215

See `docs/SELECTOR_VS_FLOOR_2026-09-22.md`. Exact decomposition:

| component | value | rows |
|---|---|---|
| A. price on shared fills (live 84.13¢ vs shadow 79.45¢) | −426 | 91 |
| A. fee on shared fills | +11 | 91 |
| **A total** | **−415** | |
| B. lower-floor-only fills avoided (their shadow net was −630) | **+630** | 11 |
| C. settlement / accounting differences | 0 | |
| D. fee-engine differences | 0 | |
| **live − shadow = 205 − (−10)** | **+215** | sums exactly |

## 6. External tests reproduced (MARKET_BASELINE, split 2026-09-14T12:00Z)

| test | TRAIN (656 w) | TEST (706 w) | verdict |
|---|---|---|---|
| blind 80¢ first touch, MID 180–600 s | −1.23¢/fill (n=582) | −1.76 (n=630) | negative both |
| blind 80¢ first touch, FULL 15–900 s | −2.77 (650) | −1.55 (695) | negative both |
| blind 85¢ first touch, MID | +0.42 (512) | −1.52 (575) | flips |
| MIRROR-35 (30–45¢, T−5..T−2) | +1.89 (293) | −0.60 (299) | flips |
| jump chase ≥2¢/60 s | +0.13 (647) | −1.91 (691) | flips |
| late 95–99¢ | −1.72 (432) | −1.55 (414) | negative both |

None of these is a Chair backtest. None of them changes anything.

## 7. Small-n evidence, correlation, WAIT

- `docs/audit/wilson_small_n_2026-09-22.csv` (70 rows): point WR, Wilson lower
  bound, and the win rate the actual (or reference) booked ask needs after fee.
  The Chair's policy-era record is PROMISING_INSUFFICIENT (85.4% point, 78.5%
  lower bound, 83.75% needed). No small-n card record clears its need on its
  lower bound at the quoted asks.
- `docs/audit/vote_correlation_2026-09-22.csv`: identical-timestamp pairs on the
  T−450/300/180 checkpoints (2026-09-17→21). Only DRIFT–STREAK, STREAK–STRIKE,
  CLOCK–STREAK and CLOCK–STRIKE ever co-spoke (n 5–14); disagreement was
  observed once (STREAK–STRIKE at T−450, phi undefined elsewhere because a
  2×2 cell is empty). On 2 s seat reads (7 h) no two seats co-spoke at all.
- Chalk-adjusted WAIT: both denominators kept; the difference is under one
  point at every checkpoint (`docs/sql/exports/chalk_adjusted_wait.sql`).

## 8. Seat review

See `docs/SEAT_REVIEW_FREEZE_DECISION_2026-09-22.md` and
`docs/audit/seat_review_snapshot_2026-09-22.json`. The prospective
status-transition log is live from this branch's deploy (buffer in the engine,
drainer kicked from healthz, insert-once system events). The freeze itself is a
**separate optional commit**, not in this branch.

## 9. What this branch activates (measurement only)

| item | default | switch | production behaviour change |
|---|---|---|---|
| shadow-lab observer wired in `healthz` | OFF | `SHADOW_LAB_ENABLED=true` (not set) | none; rail: a failing observer cannot touch the frame |
| skill-status transition log | ON | `SKILL_STATUS_LOG_DISABLED=true` | none; engine queues, healthz drains, insert-once |
| migration 0058 (CANDIDATE_NOT_COLLECTING status) | applied on deploy | additive, idempotent | none |
| MIRROR_35_V1 manifest | CANDIDATE_NOT_COLLECTING | owner activation only | none; holds no slot under the 3-active cap |

## 10. What was deliberately not done

Lower/raise the live floor · a live 92¢ cap · change `min_speaking` · restore or
demote a seat · promote MIRROR-35 or Shadow Chair v2 · replace the flat 3¢ gate ·
early exits · more calls · tune to the 1,440-window sample · rewrite historical
fills · hide conflicting evidence · set `SEAT_REVIEW_DEMOTION_FROZEN = true` in
this branch.
