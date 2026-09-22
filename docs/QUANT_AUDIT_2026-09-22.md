# Quant audit — SATOSHI'S COUNCIL — 2026-09-22

> **Corrections (2026-09-22, second pass; see `docs/EVIDENCE_REPORT_2026-09-22.md`):**
> 1. The whole-cent fee boundary is 82¢ → 2¢ and 83¢ → 1¢ (not 84¢).
> 2. "All-time excluding A0 … +226¢ on 137 fills" is the book **since the 70¢ floor** (A1+B+C), not since the 80¢ floor; the 80¢-and-later book is 92 fills / +222¢.
> 3. "149 wins" counts positive-net positions; **official settlement wins are 140 of 190** (23 of the 53 pre-floor rows; 24 of those rows carry a non-binary exit price and do not satisfy the HOLD identity).
> 4. The 80-vs-70 trial advantage (+215¢) is −415¢ on the 91 shared windows (the shadow bought the same winners 4.7¢ cheaper) plus +630¢ avoided on the 11 shadow-only windows.
> 5. The four "last-7" surfaces were one rolling definition at four as-of instants.
> 6. The 15¢ scalp floor is not impossible at every ask; it requires ≈97% at 80¢ and 100% at 84¢ as a HOLD illustration. The defect is established from the code and live state, not from that illustration.
> 7. Section 2's per-100-window leak figures are estimates on the populations named; they are not verified P&L.

Scope: paper-only 15-minute Bitcoin desk (KXBTC15M). Source of truth: the live `satoshi-council-db` Postgres (read-only), `desk_ledger_research` (1,562 valid windows, 2026-09-05 12:45Z to 2026-09-22 00:00Z, 190 booked fills), `desk_call_quality` (1,028 receipts at T−450/300/180s), `desk_chair_evals`, `desk_policy_observations`, `desk_lag_events`, `desk_v3_samples`, `desk_v4_forced`, `desk_openai_shadow`, `desk_samples`, `desk_taker`, `desk_seat_reads` (Sep 21 only), and the live learner state in `desk_state`. Code at `main` 11fab5b.

Fee: confirmed from `clock.ts` / Books SQL as `ceil(7 · p · (1−p))` cents per contract. In the 80–98¢ band that is 2¢ at 80–83¢ and 1¢ from 84¢ up. Needed win rate = (ask + fee) / 100.

Every number below is after that fee, at the real ask the ledger recorded, graded on the official Kalshi result. No mid, no last trade, no shadow mixed into live.

---

## 0. VERDICT

The current Chair plus selective book is **FAIR at best, and structurally mute today**. All-time the paper book is +92¢ on 190 fills (+0.5¢ per fill, standard error about 2.5¢), with a −315¢ max drawdown against a +300¢ peak. The five-day 80¢ trial that produced the +205¢ headline won 87.9% against an 85.7% needed rate on 91 fills: that is z ≈ 0.7 from zero edge. Every probability arm the lab has run (Chair v2, v3, forced v4, OpenAI shadow, TAKER) scores a Brier equal to or worse than the Kalshi book at the same instant, and the "buy the ≥80¢ favourite" null book at T−7:30 and T−5 nets −0.1 to −0.2¢ per fill: the book is efficient after fee where the desk buys. The seats that fire in the entry window (STREAK, STRIKE, DRIFT) agree with the market direction 93–100% of the time, so the Council is a restatement of the price it is trying to beat.

**The single biggest leak is not a cents leak. It is a broken gate.** Since 2026-09-20 the desk has had zero eligible speaking seats in the 3–10 minute entry window in every one of 1,142 audited checkpoints. Cause: the 500-call seat review (`reviewSeats`, `EDGE_FLOOR = 15¢` rolling scalp average, a bar no ≥80¢ contract can average) benched STRIKE.itm_time and STREAK.continue_young on Sep 19–20, the huddle un-benched them to SHADOW, and `AUTO_SKILL_PROMOTION_ENABLED = false` means nothing ever returns to LIVE. CHAIN and CASCADE went the same way on Sep 15–16. The remaining LIVE directional cards are INDEX (fires at T−17s to T−29s, outside the entry window) and DRIFT.aligned_3h (strength ≈40, gagged by the 52 speak bar in 298 of 334 reads). One fill in 608 windows since Sep 15 is therefore not selectivity. It is a one-way ratchet that will also silence INDEX at its 700th call and DRIFT after it. Until that is fixed the desk cannot generate the 250 prospective fills its own promotion gates require, so no research question on this desk can ever close.

---

## 1. SCOREBOARD RECONCILIATION

Rebuilt from `desk_ledger_research` (fee recomputed, not read).

| Era (UTC) | Windows | Fills | Wins | WR | Needed WR | Net ¢ | ¢/fill | ¢/100 windows | Avg ask | Max DD | CVaR5 | Sit % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A0 pre-floor (Sep 5 – Sep 8 20:47) | 321 | 53 | 32 | 60.4% | 75.1% | −134 | −2.5 | −41.7 | 73.4 | −142 | −65 | 83.5% |
| A1 70¢ floor (– Sep 10 23:00) | 191 | 45 | 36 | 80.0% | 79.9% | +4 | +0.1 | +2.1 | 78.2 | −315 | −77 | 76.4% |
| B 80¢ trial (– Sep 15 14:05) | 442 | 91 | 80 | 87.9% | 85.7% | +205 | +2.3 | +46.4 | 84.1 | −258 | −83 | 79.4% |
| C1 selective V1/V2 (– Sep 17 12:20) | 177 | 0 | 0 | — | — | 0 | — | 0 | — | 0 | — | 100% |
| C2 selective V3 (– Sep 22 00:00) | 431 | 1 | 1 | 100% | 83.0% | +17 | +17 | +3.9 | 81.0 | 0 | — | 99.8% |
| **All-time** | **1,562** | **190** | **149** | **78.4%** | ≈80% | **+92** | **+0.5** | **+5.9** | 79.6 | **−315** | −77 | **87.8%** |

Price shelf since the 80¢ floor (Sep 10 23:00 onward, 92 fills):

| Shelf | Fills | Wins | WR | Wilson LB | Needed | Net ¢ | ¢/fill |
|---|---:|---:|---:|---:|---:|---:|---:|
| 80–84¢ | 61 | 50 | 82.0% | 70.5% | 83.0% | **−65** | −1.1 |
| 85–89¢ | 16 | 16 | 100% | 80.6% | 87.4% | +201 | +12.6 |
| 90–94¢ | 10 | 10 | 100% | 72.2% | 93.2% | +68 | +6.8 |
| 95–98¢ | 5 | 5 | 100% | 56.6% | 96.4% | +18 | +3.6 |
| 85+ pooled | 31 | 31 | 100% | 89.0% | ≈90.7% | +287 | +9.3 |

The 85+ shelf's Wilson lower bound (89.0%) does not clear its needed rate (90.7%). It is a "needs N" shelf, not a proven one. The 80–84¢ shelf is negative in the floor era and only marginally positive pooled across all eras (65/77, +73¢, LB 74.7% vs 83% needed).

Inconsistencies found:

1. **Supporters rule.** The brief says 3 supporters from 2 groups. Live code is `ENTRY_SELECTIVE_V3` with `min_speaking: 2` (frozen 2026-09-17 12:09Z, "owner-selected correction after the V2 three-speaker quorum blocked every observed directional read"). The audit receipts label the check "At least 2 healthy supporters". The 3-of-2 rule is the tightened mode (4-of-3) after −100¢ only in part; ordinary mode is 2-of-2.
2. **"Last-7 fills ~38–42"** is stale. Rolling last 7 days at audit time: 664 windows, 15 fills, 11 wins, **−165¢**, sit 97.7% (the window includes Sep 15's −182¢ day and then 1 fill).
3. **All-time pools the pre-floor era.** `LAB_AUDIT_2026-09-18` says the pre-2026-09-06 multi-leg era is split before every cut; the public "all" total (+92) pools Sep 5–8's 53 fills at 73¢ average (−134¢). Excluding A0, the floored book is +226¢ on 137 fills.
4. **Chair WAIT ≈ 99% is a close-frame statistic.** `chair_lean` in the ledger is the grade-frame lean (T−0). It was 98.9–99.7% WAIT in every era including era B when the book filled 20% of windows. It cannot be used to diagnose entry selectivity. The entry-time evidence is `desk_chair_evals` / `desk_call_quality`, which show `avg_speakers = 0.00` and `sit_mass = 1.00` in 1,073 of 1,077 MID-phase evaluations since Sep 17.
5. **80-vs-70 trial** rebuilt: live 91 fills +205¢ (84.1¢ avg) vs shadow 102 fills −10¢ (78.8¢ avg); the 11 fills the 80 floor declined lost −630¢ (2 wins). The whole trial delta is those 11 declined fills. Confirms the floor, on 11 observations.
6. **Missing windows:** 12 of 1,582 expected slots in 90 days (0.8%); 8 windows excluded for `2026-09-10-ticker-reuse`, none with a fill. Kalshi official value present on 1,569 of 1,570 rows.
7. **Drawdown stretches:** underwater 103 h (Sep 5–9, 71 fills, trough −178 from a +8 peak) and 93 h (Sep 10–14, 71 fills, trough −225 from +90). The +300 peak on Sep 15 06:15 has not been regained (Sep 15 lost −182).
8. **Shadow never mixed into live:** verified; shadow columns are separate and excluded from every headline query.
9. **Settlement definition:** `rule_avg_ok` and `rule_last_ok` disagree on 57 of 1,570 windows (3.6%). Official minus 60-print average: p50 $0.24, p95 $1.11. The settlement risk is real but small; the desk grades on the official result, so no past "wrong" call was actually right on BRTI (0 fills with `ev>0` and `entry_lean ≠ winner`).

---

## 2. LEAK RANKING

| # | Leak | Evidence | Est. ¢ / 100 windows | Fix | Risk of fix |
|---|---|---|---|---|---|
| 1 | **Seat-review ratchet mutes every mid-window seat** (`EDGE_FLOOR` 15¢ scalp avg + frozen promotion) | `seat_review_at` STRIKE 3700 / STREAK 2200 (reviews fired at 3200 / 1700 calls ≈ Sep 19–20); `seat_calib_debt` STREAK 587 = full seat_n (re-zeroed to UNCALIBRATED); STRIKE.itm_time (1219/1284, LB 93.6%) and STREAK.continue_young (683/683) now SHADOW; 0 eligible in 1,142/1,142 audit checkpoints since Sep 17; STREAK/STRIKE heard at grade frame daily through Sep 19, zero from Sep 20 | Not a cents number: **evidence starvation**. At era-B fill rate the desk forgoes ~20 fills / 100 windows of prospective sample; forgone EV ≈ 0 ± 5 | Replace `EDGE_FLOOR` with a price-relative bar (avg net ≥ 0 after fee on MID-pocket reads) and add an owner-run, deterministic re-promotion path for cards that already clear the Sep 15 authority bar (≥50 economic reads, Wilson ≥0.60, EV >+1¢) **restricted to MID-pocket evidence** | Restores fills that are ≈0 EV; must run as a SHADOW book first (Experiment 1) so nothing live changes until it beats the null |
| 2 | **80–84¢ shelf is net negative** | 61 fills, 82.0% vs 83.0% needed, −65¢ since the floor; 2¢ fee at 80–83¢ vs 1¢ at 84+ | ≈ −15 | Shadow books at 85¢ and 88¢ on identical windows (Experiment 1) | Chosen after seeing the data (multiple-hypothesis). Do not move the live floor on this; SHADOW only |
| 3 | **Near-strike fills: fair overstates edge inside the settlement band** | `SETTLE_BASIS` = 2 bps; measured basis p50 2.8 bps, p95 8.8 bps (21,746 minutes); 14 of 26 losses with ATR data settled within 1 ATR of strike vs 7 of 140 wins; 9 of 38 losses within $15 of strike | ≈ −10 to −20 (14 losses × ~80¢ over ~1,200 windows, partially offset by lost wins) | Set `SETTLE_BASIS` from measured `desk_basis_minutes` (5–9 bps) in SHADOW; count historical fills that would have failed the edge gate (Experiment 2) | Fewer fills; if basis is over-set the desk sits on true edge |
| 4 | **Duplicate evidence families satisfy the 2-of-2 quorum** | Grade-frame agreement: CARRY+CHAIN 54/54 (100%), CARRY+STREAK 26/26, INDEX+STREAK 17/17, PULSE+WHALE 20/20, CASCADE+VOLT 15/15, CHAIN+STREAK 97/104 (93%), STREAK+STRIKE 72/86 (84%); STREAK is `history` family, CHAIN `derivs`, STRIKE `book` | Unquantified; inflates apparent confluence | Count evidence groups after collapsing pairs with ≥90% agreement on n≥50; STREAK.yes_agrees reads the YES price and belongs to `book` | May reduce fills further; needed before Leak 1 fix so the restored roster cannot self-confirm |
| 5 | **Fee grind at 95–98¢** | 5 fills, +18¢; needed 96.4%; lag study final-minute 90+ shelf: 150 ms hit 40%, 500 ms hit 21% | ≈ 0 now; negative if scaled | Keep the existing chalk rule; do not add a "lock" rule to the live book (see Experiment 3 for the only version worth testing) | None |
| 6 | **US-morning session losses** | Chicago hours 05–07 since the 70¢ floor: 20 fills, 13 wins, −367¢ (07h: 7 fills, −207¢) | ≈ −8 (concentrated) | Watch only; n too small for a rule. Report by session in the weekly card | Rule would be in-sample |
| 7 | **Latency "edge" is a mirage after settlement** | 96,052 shocks; earlier-phase 80–89¢ shelf: claimed edge −1.7¢, markout +1.2¢, realized first-per-window −4.2¢ (n=5); final-minute 90+: markout −4.2, realized +1.3 on unhittable 21–40% fills | 0 | Close the question: stale-ask survival is a feed-health metric, not a signal | None |
| 8 | **Chair conf is not a probability** | `conf_bins` 70–80: 8/9, 80–92: 2/2; scoring audit confirms skill "Brier" is a strength score | Blocks calibration work | Chair emits `p = market_p` plus bounded correction (v3 form) so a Brier is defined; keep as measurement | None |
| 9 | **Grade-frame seat stats inflate every seat** | Ledger `seats` JSON is T−0; CHAIN heard 97.5% at grade vs 61% raw; call-quality T−7:30: STREAK 73%, STRIKE 75%, DRIFT 93% = market same-population 73/73/91% | Misleads promotion | Grade cards on MID-pocket receipts with the ask at fire time (extend `SKILL_SCORE_AUDIT_V1` beyond DRIFT/PULSE) | None |
| 10 | **Data integrity residue** | 12 missing slots / 90 d; 8 ticker-reuse exclusions; 3 fills with null `entry_secs_left`; `desk_seat_reads` only since Sep 21 17:06Z | ≈ 0 | Keep; the checkpoint fix from `LEDGER_WINDOW_2026-09-14` is in | None |

---

## 3. SEAT REPORT CARD

Heard-n / Heard-acc: grade-frame (T−0) pooled Sep 5–22, from `desk_ledger_research.seats`. T−7:30 acc: raw directional accuracy at the 450 s call-quality checkpoint, with the market's direction accuracy on the same reads in brackets. Fill-n / Fill-EV: fills where the seat was heard on the booked side at grade frame, and mean fill net. Brier: no seat emits a probability, so UNKNOWN for all; the "Brier" on skill cards is a strength score (see `SCORING_AUDIT_2026-09-15`). Card status from live learner state.

| Seat (family) | Status now | Heard-n | Heard-acc | T−7:30 acc (mkt) | Fill-n | Fill-EV ¢ | Brier | Duplicate-with | Action |
|---|---|---:|---:|---|---:|---:|---|---|---|
| STREAK (history) | seat UNCALIBRATED (debt 587); continue_young 683/683 SHADOW; yes_agrees 738/738 SHADOW | 568 | 98.8% | 73.2% (73.2%) agrees w/ mkt 100% | 114 | +9.6 | UNK | CHAIN 93%, CARRY 100%, INDEX 100%, STRIKE 84% | **RE-CLASSIFY to `book` family; PROMOTE SHADOW (Exp 1) on MID-pocket receipts only.** It is the YES price restated |
| STRIKE (book) | seat calib debt 210; itm_time 1219/1284 (LB 93.6%) SHADOW; two rethink cards SHADOW | 211 | 83.9% | 75.0% (72.7%) agrees 93% | 16 | −13.6 | UNK | STREAK 84%, CHAIN 85% | PROMOTE SHADOW (Exp 1). Fill-EV negative when heard: it was right at 97¢ and wrong at 81¢ |
| INDEX (book) | LIVE: settle_fair 134/135, locked_avg 115/116 (LB 95.3%) | 62 | 93.5% | T−3m: 71% (67%) | 10 | −25 (era A fills were other seats) | UNK | STREAK 100% | KEEP LIVE; it fires at T−17–29 s so it never reaches the 3–10 min gate. Only card whose LB clears its needed rate. Exp 3 |
| DRIFT (candle) | LIVE aligned_3h 122/122; 5 SHADOW cards | 24 | 100% | 93.3% (91.1%) agrees 98% | 3 | −9 | UNK | market | KEEP LIVE. Gagged 298/334 reads (strength ≈40 < 52). It is the market's own momentum |
| CHAIN (derivs) | oi_with_price 657/682 SHADOW; calib debt 340 | 259 | 95.0% | none at T−7:30 | 59 | +7.2 | UNK | CARRY 100%, STREAK 93% | FADE to 0.5 weight until CARRY/CHAIN are merged; PROMOTE SHADOW under Exp 1 as one seat with CARRY |
| CARRY (derivs) | trend_carry 148/153 SHADOW | 65 | 96.9% | none | 17 | +6.5 | UNK | CHAIN 100%, STREAK 100% | MERGE into CHAIN (same feature twice) |
| CASCADE (derivs) | proxy_flush 717/1026 (LB 67.0%) SHADOW; calib debt 498 | 514 | 69.5% | none | 100 | +2.9 | UNK | STREAK 68%, VOLT 100% | BENCH the directional card: 70% at 84¢ asks is a liability; keep the sit cards |
| TAPE (book) | persist_imbalance 231/490 SHADOW; size_wipe SHADOW | 168 | 40.0% | none | 34 | −1.1 | UNK | STRIKE 22% (anti) | KEEP SHADOW. Heard-wrong 60% of the time; a candidate contrarian feature only with N≥250 prospective |
| WHALE (candle) | proxy 59/99, cluster 97/175 SHADOW | 32 | 50.0% | none | 9 | −11.2 | UNK | PULSE 100% | MUTE from quorum counts; keep grading |
| PULSE (candle) | vol_agree 74/125 SHADOW; vol_lag_5m 30/30 SHADOW | 39 | 56.4% | none | 10 | −9 | UNK | WHALE 100% | MUTE; vol_lag_5m 30/30 gets a **needs N (≥100 MID)** tag, not promotion |
| WICK (candle) | 8 SHADOW cards; amd 90/102; pin/engulf/star cards 2–15% hit | 18 | 77.8% | none | 6 | +4.3 | UNK | market | KEEP SHADOW; KILL pin_at_high, engulf_at_extreme, evening/morning_star, tweezer (all Wilson <0.10) |
| VOLT (candle) | atr_spike 211/264 SHADOW; dead_sit LIVE-equivalent sit | 27 | 88.9% | none | 9 | −11.8 | UNK | CASCADE 100% | KEEP as regime sit only; no directional authority |
| EXHAUST (candle) | 1h_run_5m_flip 5/6 SHADOW; others 0–1/11 | 6 | 0% | none | 0 | — | UNK | fade family | BENCH all directional cards |
| VEL (book) | spot_lead 39/576 BENCH (closed) | 8 | 0% | none | 0 | — | UNK | — | KILL (already closed). DEAD flag 8 days |
| ODDS (book) | cheap_yes 0/81 BENCH, retired | 9 | 0% | none | 1 | −66 | UNK | CHEAP | KILL. Do not revive |
| CHEAP (book) | value 0/492 BENCH, retired | 8 | 0% | none | 2 | −10 | UNK | ODDS | KILL. Do not revive |
| FADE (book) | 60s_rip 42/389 BENCH, retired | 9 | 0% | none | 1 | +22 | UNK | — | KILL. Do not revive |
| CLOCK (context) | session_prior SHADOW, n=1 | 1 | 0% | 73.7% (78.9%) | 0 | — | UNK | — | KEEP as prior only; never a supporter (already excluded as `context`) |
| WARDEN / ORBIT / WIRE | non-voting guards | — | — | — | — | — | — | — | KEEP non-voting. ORBIT quiet-bar and WARDEN veto stay |

---

## 4. CHAIR CHANGES

**Current rule.** Votes pass the retired-seat filter, the COACH bench, and a 52-confidence speak bar; the council authority guard then forces any read whose card is not LIVE with ≥50 economic reads, Wilson ≥0.60 and EV >+1¢ to a sit. Surviving votes are weighted by learned base × rank-listen × health × regime licence × fade scale, same-side candle/book/derivs families are folded to their loudest member, the score is normalised by directional weight only, scaled by category diversity (×1.06/1.12) and conflict (1 − 0.7·frac), then multiplied by a time factor (0.55 early, 1.15 at 4–10 min, 0.72 at 2.2–4 min, 0.55 late) and compared with a bar of 0.30 + quiet 0.08 + weekend 0.04 + phase ±0.04 + law 0.06 + calibration tax 0.04 + 0.2·sit-mass + kNN, clamped 0.24–0.72. Hard gates (feeds, chalk, leftover, early/late, top-3 conflict, edge after fee) force WAIT. A sticky lean holds a side at 35% of the bar. The selective book then requires 2 healthy supporters from 2 families, no opposition, 3–10 min left, fresh feeds, ask 80–98 with spread ≤2 and resting size, ≥3¢ main-model edge, a positive settlement-index margin, and 3 confirming frames over ≥8 s.

**Proposed vNext (measurement first, no new aggregator).** Every aggregator tested walk-forward is the market: v3 Brier 0.1675 vs market 0.1672 (n=387), v4 0.1696 vs 0.1696 (n=306), OpenAI 0.1663 vs 0.1664 (n=222), v2 0.1646 vs 0.1630 (n=1,504). A new pooling rule cannot fix that, so vNext changes four things that are bugs rather than models. (1) Replace the 15¢ scalp `EDGE_FLOOR` seat review with a price-relative bar: a seat is demoted only when its MID-pocket average net after fee on real asks is below zero on ≥50 reads. (2) Add a deterministic, owner-run re-promotion that returns a SHADOW card to LIVE when its **MID-pocket** record clears the Sep 15 bar with the ask at fire time recorded; the FINAL-pocket record (where STRIKE.itm_time built 1,195 of its 1,284 grades) counts for nothing. (3) Collapse duplicate families before counting supporters: CARRY into CHAIN, STREAK into `book`, PULSE with WHALE, CASCADE with VOLT. (4) Emit a Chair probability `p = market_p + bounded correction` (the v3 form, ±10 pp) alongside the lean, so every future Chair read has a Brier against the book. Keep the 80¢ floor, HOLD, and every selective gate as is.

**What it would have done on the last walk-forward.** UNKNOWN for net: the roster has been silent since Sep 20, so no prospective window exists where vNext could have filled. Known: on Sep 11–15 (era B) the same roster at the same gates filled 91 times for +205¢, z ≈ 0.7 from zero. vNext restores that sample-generating capacity; it does not claim to restore the +205.

**Kill criteria** (shadow book, paired by window against the null favourite book and HOLD): net per fill − null ≤ 0 at 150 fills; max DD worse than −258¢ (era B) at any point; CVaR5 worse than −85¢; Brier of the emitted p worse than market on 300 paired windows; fill count above 25 per 100 windows (that is a gate failure, not a signal).

---

## 5. EXPERIMENTS (MAX 3 ACTIVE)

**E1. UNMUTE_SHADOW_BOOK_V1**
- Hypothesis: the era-B speaking roster, under today's V3 gates and a duplicate-collapsed quorum, produces fills whose net after fee beats a null "buy the favourite" book at 85¢ and 88¢ floors, but not at 80¢.
- Control: NULL_FAV — at T−7:30 and T−5 buy the ≥floor favourite whenever spread ≤2, size ≥1, not chalk; hold to settlement. Measured on 387 windows it nets −0.13¢/fill at 450 s and −0.22¢ at 300 s: the fee-drag baseline. Second control: the live selective book (currently ≈0 fills).
- Pairing: same window, same ask captured at the same tick; three floors (80/85/88) as three shadow ledgers; day-bootstrap CI (2,000 iters, seed 20260911) as in `promotion-gates.ts`.
- N required: 250 fills per floor, 30 days, 25 paired control-loss windows (existing gates).
- Promote: paired delta ≥ +1.0¢/fill with 95% CI above 0 vs NULL_FAV; DD ratio ≤ 0.75 of NULL_FAV; CVaR10 improvement ≥ 20%; positive in every session pocket with ≥30 paired.
- Kill: delta ≤ 0 at 150 fills; DD < −258¢; fills > 25 per 100 windows.
- Implementation: a `desk_policy_fills`-style writer keyed `UNMUTE_V1:{floor}` that runs `runChair` with a roster override (STRIKE.itm_time, STREAK.continue_young, CHAIN.oi_with_price, CARRY.trend_carry, DRIFT.aligned_3h, DRIFT.pullback_in_trend LIVE-eligible) and the collapsed family map; records ask, bid, sizes, spread, quote seq, feed ages, seat rows, and 150/500 ms ask survival from the existing lag-event path. Zero authority.
- Expected effect: shadow sit rate 78–85%, live sit rate unchanged (100%). Net UNKNOWN; prior says ≈0 ± 3¢/fill.
- Status: **SHADOW** (all components already exist; nothing new is fitted).

**E2. SETTLE_BASIS_MEASURED_V1**
- Hypothesis: the 2 bps settlement-basis constant understates the spot-to-BRTI noise (measured p50 2.8 bps, p95 8.8 bps), so `fair_yes` overstates edge within ~1 ATR of the strike; using the measured basis removes more losses than wins from the edge gate.
- Control: current `fairYesCents` (2 bps).
- Pairing: identical fills; retrospective diagnostic on the 190 historical fills (report-only, in-sample by construction), then prospective on E1's shadow fills.
- N required: prospective 250 fills through E1 (retrospective pass is a diagnostic, not evidence).
- Promote: on prospective fills, the fraction of losses blocked exceeds the fraction of wins blocked by ≥20 points and net per fill improves ≥ +1¢ with CI above 0.
- Kill: blocks ≥ 30% of wins or improves net < +0.5¢/fill at 150.
- Implementation: parameterise `SETTLE_BASIS` (5, 7, 9 bps) inside the E1 writer only; recompute `edge_up/down` per variant from the same `atr`, `mins_left`, `dist`; write the variant edge next to the live edge. Also report how many of the 14 near-strike losses had `edge ≥ 3¢` under each variant.
- Expected effect: shadow fill count −10 to −25%; sit rate up; net per fill up if the hypothesis holds.
- Status: **SHADOW** (pure parameter, no fit).

**E3. INDEX_LOCK_V1**
- Hypothesis: when INDEX.locked_avg fires (≥10 of the 60 settlement prints locked and fair − ask − fee ≥ 3¢), a hittable ask at 85–98¢ on the locked side is +EV after fee, because the card's record (115/116, Wilson LB 95.3%) is the only one on the desk whose lower bound clears its needed rate (~93%).
- Control: NULL_FAV in the final minute (the same ask without the INDEX condition), which the lag study shows is −EV (final-minute 90+ shelf realized ≈ +1.3¢ on 21–40% hit rates).
- Pairing: same window; record ask, size, and 150/500 ms survival at the fire tick; grade only fills that survived 150 ms.
- N required: 100 hittable fills (small payoffs, low variance) and 30 days; promotion to anything live still needs the 250-fill gate.
- Promote: net per hittable fill ≥ +2¢ with CI above 0; 150 ms survival ≥ 60%; at most 1 loss per 60 fills.
- Kill: survival < 50%; any 2 losses in 40 fills; net ≤ 0 at 60.
- Implementation: a shadow writer that listens for the card firing, snapshots quotes at fire and at +150/+500 ms (the `desk_lag_events` capture path), and writes a `desk_policy_fills` row with `entry_policy = INDEX_LOCK_V1`. Explicitly outside the 3–10 min live window; can never authorise a live fill; the chalk rule (≥99¢) stands.
- Expected effect: none on the live book; ~5–10 shadow fills a day.
- Status: **CANDIDATE** (needs the survival receipt before it can be SHADOW).

TAKE90_V2 continues as the existing exit trial (+44¢ vs HOLD on 21 paired, 2 losses vs 4; HOLD beats PROVE120/180/240 and TAKE90_V1 by −276/−117/−75/−91¢ on 56 paired). It is not one of the three above and it stays at 21 of 250.

---

## 6. STOP-DOING LIST

1. Stop calling the 1-fill-in-608-windows book "selective". It is a muted roster; label it as such on the Floor until E1 has 100 shadow fills.
2. Stop running the 500-call seat review with `EDGE_FLOOR = 15¢`. No ≥80¢ contract can average 15¢ per leg (a win pays 14–18¢). It has demoted every seat that reached 700 calls and will take INDEX at 700 and DRIFT next.
3. Stop counting FINAL-pocket grades as card evidence. STRIKE.itm_time's 1,284 grades are 93% FINAL (right at 95–99¢). Promotion evidence is MID-pocket, real-ask only.
4. Stop treating CARRY and CHAIN as two supporters (54/54 agreement). Same for CARRY/STREAK, INDEX/STREAK, PULSE/WHALE, CASCADE/VOLT.
5. Do not lower the floor. The 11 fills the 80 floor declined lost −630¢. The 80–84¢ shelf is itself −65¢.
6. Do not add early exits. HOLD beats every PROVE and TAKE90_V1 on 56 paired windows.
7. Do not revive ODDS, CHEAP, FADE, VEL (0/81, 0/492, 42/389, 39/576).
8. Do not promote Chair v2, v3, v4 or the OpenAI shadow. None beats the market Brier; v2's shadow fills average 32¢ asks with 26% wins (−0.45¢/call), which is the cheap-side trap it was warned about.
9. Do not treat GOLD flags as predictive. STRIKE was flagged GOLD on Sep 15 ("right 80% of 171 mid-window reads, 0.1¢ a contract at the ask"): 0.1¢ is the fee grind, and DRIFT has been GOLD six days running while gagged 89% of the time. GOLD measures in-sample hit rate at grading quotes, not next-week EV.
10. Do not chase stale-ask latency. Realized settlement on first-per-window shocks is ≈0 to negative across every shelf.
11. Do not size up. One contract until E1 shows a CI above zero.
12. Stop reading grade-frame seat accuracy (ledger `seats`) as seat skill. It is the book at 97¢.

---

## 7. DATA REQUEST

Needed for the next pass; all are additions to existing tables or one new receipt.

1. **Card-fire receipts with the ask** for every directional card, not only DRIFT/PULSE: extend `SKILL_SCORE_AUDIT_V1` (`desk_ledger.skill_score_audit`) to all cards, columns: `card_id, fire_ts, secs_left, side, ask, bid, yes_size, no_size, spread, fee, fair_yes, lab_fair_yes, regime, health, hittable_150ms, hittable_500ms, winner, net`. Time range: from deploy forward; 30 days.
2. **Seat reads before Sep 21**: `desk_seat_reads` starts 2026-09-21 17:06Z (56 windows). If any earlier per-tick seat log exists (the `desk_samples` features are one number per seat at T−7 only), export it; otherwise the timing curve rests on `desk_call_quality`'s 387 windows at three horizons.
3. **Ask at decision time on the 98 pre-Sep-11 fills** (`entry_secs_left`, `entry_spread_cents`, `entry_touch_size` are null before the 80¢ floor). If the replay `cols` hold the quote path, backfill the entry ask from the replay tick nearest `t`; label it `reconstructed`.
4. **Seat review log**: `reviewSeats` writes to `huddle_log`, which is capped at 20 lines and has rolled off. Persist review lines to `desk_system_events` (event_type `SEAT_REVIEW`) with `seat, calls, scalp_avg, action, cards_benched`.
5. **Shadow ledgers for E1/E2/E3** as `desk_policy_fills` + `desk_policy_observations` rows with distinct `entry_policy` ids, plus the 150/500 ms survival flags from the lag path.
6. **Per-window BRTI basis at settlement**: `desk_basis_minutes` gives per-minute basis; add the final-minute basis and `settle_gap` to each `desk_policy_observations` row so E2 can be scored without a join to replay.
7. **The NULL_HORIZON_V1 output** (`npm run lab:null-horizon`) run once with `DATABASE_URL`; the report cannot be produced through the read-only connector. Needed to confirm HEARD vs RAW vs HORIZON vs NULL at 450/180 s on the 700 replays.

---

## 8. 7-DAY OPERATING CARD

Watch daily (all from `/books` and `/lab` unless noted):

| Item | Where | Green | Amber | Red |
|---|---|---|---|---|
| Live sit rate (rolling 7 d) | Books keeper | 78–92% | 92–98% | >98% for 2 days: the roster is mute, not selective; check `seat_review_at` |
| Eligible speakers at MID | `desk_chair_evals.speaker_count` avg over MID rows | ≥1.5 | 0.5–1.5 | <0.5: gate is dead, no entry is possible |
| Fills / day | Books days | 8–20 | 3–8 | 0 or >25 |
| Net vs needed WR | Books totals: WR minus (avg entry + fee) | ≥ +2 pts | −2 to +2 | < −2 pts on ≥30 fills |
| DD from week-open | Books curve | > −100¢ | −100 to −200 | < −200¢: stop adding shadow variants, review E2 |
| Stale-feed minutes | `/status` reliability, `desk_basis_minutes.n=0` | 0 | 1–5 | >5 or any window graded on a stale index |
| Missing windows | Books `missing_windows` | 0 | 1 | ≥2 in a day: restart across close (see 09-14 note) |
| Any seat voting every window | `desk_seat_reads` spoke count per seat per day | <30% of windows | 30–60% | >60%: a seat is the market restated; check duplicate map |
| Card status changes | `desk_state.learner.skills` diff vs prior day | none | any BENCH | any LIVE→SHADOW without a logged reason |
| E1 shadow book | `desk_policy_fills` where `entry_policy like 'UNMUTE%'` | accruing, net ≥ null | net < null by < 1¢ | net < null by ≥ 1¢ at 150 fills: kill floor variant |
| Seat calls approaching a 500-call review | `seat_calls` vs `seat_review_at` | >100 away | 20–100 | <20: expect a demotion unless `EDGE_FLOOR` is replaced |

Paper only. No live orders. Not financial advice. Bitcoin only.
