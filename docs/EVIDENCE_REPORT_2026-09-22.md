# Evidence report — economic reconciliation and shadow recovery — 2026-09-22

Classification key: **DB_VERIFIED** = a bounded read-only query against the
production Postgres at the stated as-of; **SOURCE_VERIFIED** = read in the
repository at the stated SHA; **DERIVED** = arithmetic on verified inputs;
**SOURCE_REPORTED** = stated by a packet or document, not independently
checked; **ASSUMED** = a placeholder the desk uses knowingly; **UNKNOWN** =
not establishable, with the missing artifact named.

## 0. Boundaries of this pass

| Item | Value | Class |
|---|---|---|
| As-of for every comparison | 2026-09-22T00:00:00Z (ledger row 1,570 = close 2026-09-22 00:00Z) | fixed |
| Read bound | close_time ≥ 2026-09-05 12:45Z (first ledger row) | DB_VERIFIED |
| Source SHA audited | `main` 11fab5b5bc73020941fd05fee04eed2174314d28 | SOURCE_VERIFIED |
| Deployed build SHA | 11fab5b5bc73… (latest `desk_seat_reads.build_sha`, 2026-09-22 01:40Z) | DB_VERIFIED |
| Reported reconstruction | branch `claude/satoshis-council-audit-9zffy6`, doc `docs/QUANT_AUDIT_2026-09-22.md` @ 7972372dfa5ccee9d2242b159affadb8c88c75fc | cited, not a second live book |
| Champion policy | FLOOR_SELECTIVE_V3 = CHAIR_V1 + ENTRY_SELECTIVE_V3 + HOLD_V1 + RISK_NONE_V1, champion since 2026-09-17 12:20:28Z | DB_VERIFIED (`desk_floor_policy`) |
| Policy fingerprint | `ENTRY_SELECTIVE_V3\|entry\|…min_speaking=2…` (`fingerprint(ENTRY_SELECTIVE_V3)`) | SOURCE_VERIFIED |
| Fee engine | `KALSHI_TAKER_7PCT_CEIL_CENT_V1\|rate=0.07\|ceil_whole_cent\|ASSUMED` | ASSUMED (venue metadata unreachable from this environment: proxy 403 on api.elections.kalshi.com) |
| Migrations applied in production | …0054, 0055, 0056, 20260914_board_controls; 0057 (this work) NOT applied | DB_VERIFIED |
| Query provenance | every query text is in `docs/sql/` or the module that runs it; hashes in `docs/audit/audit_manifest.json` | — |

Production behaviour before and after this work: **identical**. No policy,
status, weight, threshold, floor, quorum or exit changed. One default-off
switch was added to the seat review (`SEAT_REVIEW_DEMOTION_FROZEN = false`).

## 1. Packet claims, reproduced

| Claim | Result | Class |
|---|---|---|
| 442-window trial: 80¢ main 91 fills/+205¢; 70¢ shadow 102 fills/−10¢ | 442 windows; live 91 fills, 80 official wins, +205¢, avg ask 84.1; shadow 102 fills, 82 wins, −10¢, avg ask 78.8 | DB_VERIFIED |
| All-time 190 fills / +92¢ / −315¢ max DD | 190 fills, +92.0¢, max DD −315¢ (peak +300 on 2026-09-15 06:15Z, never regained; censored) | DB_VERIFIED |
| Selective era: 1 fill in ≈608 windows | 608 valid windows since 2026-09-15 14:05:13Z; 1 fill (2026-09-18 22:30Z, 81¢, +17¢) | DB_VERIFIED |
| ≈1,142 MID checkpoints with no eligible speakers | 1,162 valid call-quality receipts since V3 (through 2026-09-22 00:00Z); `audit.eligible = true` on **0**; heard-seat count zero on 907; first failing check "direction" on 1,128, "team" on 31, "supporters" on 2, "quote" on 1 | DB_VERIFIED |
| 500-call review with a 15¢ scalp requirement benched the mid-window speakers | `reviewSeats`: `calls ≥ FULL_N (700)`, every `REVIEW_EVERY (500)`; `scalpAvg(legs) < EDGE_FLOOR (15)` → `seat_calib_debt = seat_n`, `rethinkSeat` benches the lowest-EV LIVE card. Live state: `seat_review_at` STRIKE 3700 / STREAK 2200 / CHAIN 2200 / CASCADE 2200 / TAPE 2200 / WHALE 1200; `seat_calib_debt` STREAK 587 (= seat_n), STRIKE 210, CHAIN 340, CASCADE 498; STRIKE.itm_time and STREAK.continue_young now SHADOW; STRIKE's live legs average +1.95¢. Grade-frame speech: STREAK/STRIKE heard daily through 2026-09-19, zero from 2026-09-20. **Reproduced with the real functions** (`scripts/review-ratchet-rails.test.mjs`). | SOURCE_VERIFIED + DB_VERIFIED |
| Four last-7 surfaces disagree: 42/+76, 38/+8, 49/+159, 15/−165 | One definition (`close_time > as_of − 7d`) read at four instants: 49/+159 at 2026-09-20 03:00–13:00Z, 42/+76 at 2026-09-21 01:00–02:00Z, 38/+8 at 2026-09-21 04:00Z, 15/−165 at 2026-09-22 00:00Z | DERIVED from DB_VERIFIED |
| Owner admission 3-of-2 vs deployed `min_speaking: 2` | `ENTRY_SELECTIVE_V3` frozen 2026-09-17 12:09:31Z with `min_speaking: 2`; V1/V2 had 3; the audit receipts label the check "At least 2 healthy supporters" | SOURCE_VERIFIED + DB_VERIFIED |
| ≈12 missing grades, 8 ticker-reuse exclusions | 1,570 rows vs 1,582 expected slots in 90 d (12 missing); 8 rows `2026-09-10-ticker-reuse` (07:15–09:00Z), none with a fill; official value present on 1,569 of 1,570 | DB_VERIFIED |
| Multiple fee implementations; strength-as-probability scoring | fee: `takerFeeCents` (whole cent), `takerFeeCentsExact` (centicent), inline SQL in `books.server.ts`, and per-row `fee` in `desk_lag_events` (centicent) and `entry_fee_cents`; all whole-cent paths agree. Scoring: `SCORING_AUDIT_2026-09-15` confirms skill "Brier" is a strength score | SOURCE_VERIFIED |
| CARRY/CHAIN co-speaking and other high-agreement pairs | grade frame: CARRY+CHAIN 54/54, CARRY+STREAK 26/26, INDEX+STREAK 17/17, PULSE+WHALE 20/20, CASCADE+VOLT 15/15, CHAIN+STREAK 97/104, STREAK+STRIKE 72/86. The Chair fold collapses same-family same-side seats to one weight (`foldSameSide`), and the quorum counts distinct families, so CARRY+CHAIN (both `derivs`) already count as one group. **The fold also removes folded seats from the supporter count entirely** (`selectiveBlock` excludes `r.folded`): two agreeing same-family seats contribute zero supporters. Cross-family pairs (STREAK `history` + CHAIN `derivs`, 93%) are not collapsed | SOURCE_VERIFIED + DB_VERIFIED |

## 2. Arithmetic and interpretation conflicts

1. **Era sums.** A0 53/−134, A1 45/+4, B 91/+205, C 1/+17 = 190/+92 ✔. The
   137/+226 subtotal is A1+B+C = "since the 70¢ floor" (2026-09-08 20:47Z),
   not "since the 80¢ floor". The strictly-80¢-and-later book is B+C =
   92 fills / +222¢ ✔ (matches the price-shelf totals). **Resolved; the
   earlier document's label is corrected.**
2. **The identity.** On A1+B+C (137 one-contract HOLD fills) the identity
   holds on every row: 117 official wins, Σ(ask+fee) = 11,474¢, net =
   11,700 − 11,474 = +226¢; implied all-in cost equals the measured average
   (A1 79.91, B 85.66, C 83.00). On A0 the identity fails on 24 of 53 rows:
   `settle_cents` is an exit price on those rows (legacy scalp/multi-leg),
   3 rows are scratches, and **only 23 of the 53 are official wins** (43.4%),
   not 32 (32 is the count of positive-net positions). The packet's "149 wins"
   mixed 32 positive-net legacy exits with 117 official wins; the true
   all-time official win count is **140 of 190**. No P&L was wrong; the
   population and the definition of "win" were. **Resolved.** (DB_VERIFIED)
3. **Trial decomposition.** Shared windows 91: live +205¢ at 84.1 avg,
   shadow +620¢ at 79.5 avg (same 80 wins; the shadow bought the same side
   4.7¢ cheaper on average, so the 80¢ floor cost −415¢ on shared windows).
   Shadow-only 11: 2 wins, −630¢ at 73.5 avg. Live-only 0. Net trial
   advantage +215¢ = −415 + 630. The 11 shadow-only windows are 11 unique
   windows (not repeat counts), but the whole advantage rests on them; on
   windows both books entered, the cheaper entry won. **Resolved.**
   (DB_VERIFIED)
4. **The 15¢ floor.** `scalp_avg` is the mean of a seat's last 20 virtual
   legs: buy own side at the ask on lean, sell at that side's cents on flip
   or WAIT within the window, settle 100/0 if held; P&L = exit − entry − both
   fees (`scalp.ts`). It mixes horizons, prices and early exits; it is not a
   HOLD-only number. As a HOLD illustration a 15¢ average requires 97% wins
   at 80¢, 100% at 84¢, > 100% above (`scalpFloorWinRateNeededPct`). The
   defect is established from the code and the live state, not from the
   illustration: STRIKE's real legs average +1.95¢ and the review at its
   3,200th call benched its only LIVE card. **Resolved.**
5. **September 1 split.** No split exists; nothing is backdated. All three
   manifests carry `prospective_start_at: null` and `training_cutoff: null`;
   the database column is set only by an owner activation.
6. **Gates.** ≥ 250 AND ≥ 30 days AND ≥ 25 paired control-loss windows plus
   the risk and calibration gates, implemented as AND in
   `promotionVerdict`; insufficiency returns BLOCKED.
7. **Daily halts.** No new halt was implemented. The operator card's dials
   are alerts; the −100¢ tightening and no-quota policy stand.

## 3. The mute path (Phase B)

Trace, with the binding point named at each layer (all SOURCE_VERIFIED,
counts DB_VERIFIED):

1. **Skill fire → card status.** LIVE directional cards today: INDEX.settle_fair
   (135/134), INDEX.locked_avg (116/115), DRIFT.aligned_3h (122/122). SHADOW:
   STRIKE.itm_time (1284, LB 0.936), STREAK.continue_young (683/683),
   CHAIN.oi_with_price (682, LB 0.946), CARRY.trend_carry (153), CASCADE.proxy_flush
   (1026, LB 0.670), and 60 more. The review ratchet (§1) moved STRIKE and
   STREAK there on 2026-09-19/20; the 2026-09-15 authority review moved CASCADE,
   CHAIN.oi_stall, CARRY.persist_fade and eight others.
2. **Speak bar.** `SPEAK_CONF = 52` plus COACH offsets (TAPE 50, CARRY 50, CHAIN
   54). DRIFT.aligned_3h reads at strength ≈ 40 and is gagged
   (`below_speak_conf`) on 298 of 334 directional reads since 2026-09-21
   17:06Z; it spoke 34 times, at an average 205 s left.
3. **Authority guard.** `directionalHoldReason`: not LIVE, or < 50 economic
   reads, or Wilson < 0.60, or EV ≤ 1.0 → forced sit. INDEX cards fire at
   17–29 s left (`INDEX.locked_avg` mean 17 s), outside the 180–600 s entry
   window by construction.
4. **Chair.** In 1,073 of 1,077 MID evaluations since 2026-09-21 17:06Z:
   speakers 0.00, sit-mass 1.00, bar 0.62, `hard:bar` on an empty table.
5. **Admission.** 0 of 1,162 audited checkpoints eligible; binding reason
   "direction" on 1,128. The gate vector (`gate-vector.ts`) evaluates every
   check regardless; on a synthetic fully qualified table every check passes
   under both the deployed (2-of-2) and the owner-reference (3-of-2) policy,
   so no gate is permanently false.
6. **Reachable quorum.** With STRIKE and STREAK silent, the best reachable
   normal quorum on a MID table is 0–1 supporters from 0–1 families
   (DRIFT alone, when it clears 52). The owner-reference 3-of-2 additionally
   requires three seats from at least two families where any two same-family
   seats fold to zero supporters.

**Verdict: the structural mute is reproduced.** It is a status ratchet plus a
speak bar, not selectivity, and its next exposures are TAPE/CHAIN/CASCADE/
STREAK at 2,200 calls, WHALE at 1,200, STRIKE at 3,700, and INDEX at its
700th call (now 426; DRIFT at 295). (`reviewExposure()` prints this from the
live learner.)

**Prepared, not activated:** `SEAT_REVIEW_DEMOTION_FROZEN` (default false).
When true, the review still runs and prints "would demote … FROZEN (no
change)" and touches no status or debt. It restores nothing.

**MID review (measurement only).** `mid-review.ts` prices every card
observation at its fire-time ask in MID (180–600 s) apart from FINAL and
ENTRY; ≥ 50 valid MID observations with negative net raise
`REVIEW_NEGATIVE_MID`. Today's capture covers DRIFT.pullback_in_trend and
PULSE.vol_lag_5m (606 receipts, 92% FINAL) and one booked-entry roster.
Widening capture to every card is listed under approval-required activations.

**Duplicate influence (review flags only).** `duplicate-influence.ts`
conditions co-speak agreement on the market side. Same-family pairs are
already one weight and one group; the cross-family STREAK/CHAIN pair (93% at
the grade frame) is the review target. STREAK.continue_young and
STREAK.yes_agrees read the YES book ("streak_n ≤ 3 AND YES book agrees"), so
E1 counts STREAK as a `book` read for the quorum.

## 4. Timing, price and calibration (DB_VERIFIED, as-of 2026-09-22 00:00Z)

| Horizon | n | Brier market | Brier v3 | market dir acc | favourite ≥80 & <99 | fav WR | needed | buy-fav net/fill |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| T−450 s | 387 | 0.1657 | 0.1660 | 74.2% | 46.5% | 88.9% | 89.0% | −0.13¢ |
| T−300 s | 388 | 0.1383 | 0.1386 | 78.6% | 61.6% | 91.6% | 91.9% | −0.22¢ |
| T−180 s | 387 | 0.1074 | 0.1082 | 85.3% | 59.7% | 89.6% | 93.5% | −3.86¢ |

Other arms: v4 forced (n=306) accuracy 73.9% vs market 74.2%, Brier 0.1696 =
0.1696, −4.36¢/call at the quoted ask; OpenAI shadow (n=222) 0.1663 vs 0.1664;
v2 early (n=1,504) 0.1646 vs 0.1630, −0.45¢/call at 32¢ average asks; TAKER
(n=995) 45.1% at 46.8¢, −3.38¢/call. Seats at T−450 s: STREAK 73.2% raw with
the market at 73.2% on the same reads (agrees 100%); STRIKE 75.0% vs 72.7%
(93%); DRIFT 93.3% vs 91.1% (98%).

Lag study: 97,754 shocks, 82,058 settled 150 ms hits; first-per-window
settled hits at 80–98¢ asks: n = 1,314, realized −499¢ total, −0.38¢/shock.

## 5. Experiments (Phase C) — state: IMPLEMENTED, NOT COLLECTING

| Experiment | Fingerprint | Status in code | Collecting? | Prospective start |
|---|---|---|---|---|
| UNMUTE_DEDUP_SHELF_V1 (E1) | `UNMUTE_DEDUP_SHELF_V1\|v1\|1568deb2\|8arms` | CANDIDATE | **No** | null |
| WARDEN_JUMP_VETO_V1 (E2) | `WARDEN_JUMP_VETO_V1\|v1\|4b54b5e5\|5arms` | CANDIDATE | **No** | null |
| SETTLE_BASIS_MEASURED_V1 (E3) | `SETTLE_BASIS_MEASURED_V1\|v1\|8e3cf22a\|4arms` | CANDIDATE | **No** | null |

Prospective counts: **0** for every arm. No backfill. Migration 0057 is not
applied in production; the observer is not wired and refuses to start without
`SHADOW_LAB_ENABLED=true`.

E3 semantics verified: `SETTLE_BASIS = 0.0002` is a 1σ noise term (fraction
of spot) added to σ in quadrature (`readClock`); `fairYesCentsWithBasis(snap,
SETTLE_BASIS)` equals `fairYesCents(snap)` exactly (test). Measured basis
from `desk_basis_minutes` (21,746 minutes): |bps| p50 2.8, p95 8.8 ⇒ σ ≈
4.2–4.5 bps; the registered 7 bps primary is ≈ 1.6σ, a conservative buffer,
with 5 and 9 as labelled sensitivities.

E2 inputs verified: 97,754 shock rows, side and ask always present, `jump_ms`
null on 154; availability flags exist at 50–500 ms. Availability at a 2 s
observer poll is UNKNOWN by design; only the lag capture path can resolve it.

## 6. Tests and checks run

| Command | Result |
|---|---|
| `npm run typecheck` | clean |
| `npx eslint .` | see handoff (recorded in the final message) |
| `npm test` (784 tests) | 779 pass after adding the reconciliation's bare-ledger read to the safety-rail allowlist with its reason; the one failure was that rail; re-run of the rail file: 84 pass |
| `npm run check:migrations` | 29 pass (0057 applies twice) |
| `npm run build` + `check-server-output` | see handoff |
| New tests | fee-engine 6, economics-book 7, gate-vector 9, review-exposure 4, mid-review 7, duplicate-influence 3, shadow-lab 9, shadow-arms 5, review-ratchet rail 5, shadow-lab rail 5 |

Fixture rows in tests are synthetic and labelled; none are historical results
or prospective fills.

## 7. UNKNOWN, with the missing artifact

- Venue fee metadata (rate, rounding unit, effective date): the public
  series/market endpoints were unreachable through this environment's proxy.
  Artifact: a saved response of `GET /trade-api/v2/series/KXBTC15M` and one
  market's `fee_type`/`fee_multiplier`, with its fetch time.
- Skill status transition history: not logged. Artifact: a persisted
  `SEAT_REVIEW`/`HUDDLE_STATUS` event per change (seat, calls, scalp_avg,
  action, card, writer).
- Ask at fire time for every card (not only DRIFT/PULSE): artifact: widen
  `SCORE_AUDIT_SKILLS` (approval-required) or the shadow lab's receipts once
  activated.
- Entry-time WAIT rate before 2026-09-15 16:15Z: no decision receipts exist
  for that period.
- Sub-second hittability of shadow intentions: only the lag capture path
  resolves it; the observer records UNKNOWN.
- NULL_HORIZON_V1 output: needs `DATABASE_URL`; not runnable through the
  read-only connector.

## 8. Remaining risks and the next owner decision

- The review ratchet will fire again at the next 500-call boundary for
  TAPE/CHAIN/CASCADE/STREAK (2,200) and at INDEX's 700th call. The
  default-off freeze is prepared; **activating it is the first decision**.
- Even with speakers restored, every probability arm equals the market and
  the favourite at ≥ 80¢ nets ≈ 0 after fee at T−7:30/T−5 and −3.9¢ at T−3.
  E1's prior is therefore ≈ 0; its value is evidence, not cents.
- The second decision is whether to apply migration 0057 and wire the
  observer with `SHADOW_LAB_ENABLED=true`, which starts the prospective clocks
  at the actual activation instant.
