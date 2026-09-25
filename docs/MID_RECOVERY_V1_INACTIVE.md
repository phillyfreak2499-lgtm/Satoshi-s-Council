# MID_RECOVERY_V1_INACTIVE — inactive mid-roster recovery experiment

Research only. Paper only. Inactive by default. Nothing here books, promotes,
tunes a threshold, or changes what the public Floor, Chair, followers, the
Directional Lean, or Training show.

## Question

In the MID band (180–600 s before the close), how often would the frozen E1
roster, heard through the already-merged inactive recovery path, have turned a
production WAIT into a directional read that survives every production entry
rule — and what would that simulated opportunity have been worth against the
blind favourite?

## The one path

`bots.runBotsWithEvaluatedCandidates` → `call-recovery-candidate.projectInactiveE1Recovery`
→ the actual `chair.runChair` → `gate-vector.gateVector` under the deployed
policy (`ENTRY_SELECTIVE_V3`) → the arm's own confirmation latch → a SIMULATED
booking at the production `bookable` floor. No second recovery path exists:
`shadow-lab-mid-recovery.server.ts` binds those three functions once
(`MID_RECOVERY_DEPS`) and hands them to the pure evaluator.

Roster (frozen, `shadow-arms.ts E1_ROSTER_CARDS`): STRIKE.itm_time,
STREAK.continue_young, CHAIN.oi_with_price, CARRY.trend_carry,
DRIFT.aligned_3h, DRIFT.pullback_in_trend. STREAK is counted as a book read
(`E1_FAMILY_OVERRIDE`).

Rules kept, none lowered: 80¢ floor, ceiling < 99, taker fee, spread ≤ 2¢,
resting size ≥ 1, feed freshness, settlement-index estimate and margin, model
edge, confirmation frames/seconds, no opposition, family de-duplication,
minimum speakers/families, the arm's own day risk and profit reserve.
Source-health treatment and Brier/EV calibration are already on the captured
card (the producer applies them before the capture hook); explicit clock-owned
and in-window revision holds are excluded by the projection.

## Arms (one identity: ticker + close_time)

| arm | what it records |
|---|---|
| BASELINE | the production Chair and selective result, read from the frame, never recomputed; a `fill` only when the production paper book itself holds the window (mirrored from the call log) |
| RECOVERED_MID | `intention` at the first eligible tick, `fill` (simulated, stamped `simulated: true`, `authority: research-only-simulated`) once confirmed and bookable, `no_fill` at T-3 otherwise |
| NULL_FAV_80 | the existing `nullFavIntention(snap, 80)` benchmark at T-7:30 (T-5 fallback), `no_fill` at T-5 when no favourite qualifies |

Every receipt payload carries the full evaluation record (≥ 36 measured
fields: baseline lean/state/selective result/blocker; each candidate's
seat/card/raw and calibrated read/health/family/fold survival/support;
recovered lean/state/quorum/supporters/families/blocker; confirmation;
ask/bid/spread/fee/model edge/index margin/break-even; simulated
side/price/fee; NULL_FAV side/ask/fee; agreement flags; WAIT→directional;
funnel stage).

## Persistence

`desk_shadow_receipts`, through the shadow lab's append-only writer
(`recordShadowReceipt`, ON CONFLICT DO NOTHING on
experiment|arm|ticker|close_time|kind) and the same settle sweep
(`settleShadowReceipts`: official_winner/net_cents from the official ledger
row, using the fee the receipt already carries). No migration. No manifest
slot: the recorder holds no place on the 3-active shelf and never registers,
activates or edits a manifest. Settlement is never invented: an unsettled fill
stays null and contributes nothing.

Prospective only: every process restart skips the market already open at boot,
and the T-3 sit is written only for a window this session evaluated in band.
The first receipt's `decided_at` is the boundary — derived, never edited.

## Switch

`MID_RECOVERY_SHADOW_ENABLED=true` (the literal string). Off by default; a
deploy alone cannot start collection. Health, counts and the report:
`GET /research/mid-recovery?key=<DESK_ADMIN_KEY>` (404 otherwise; not linked
from any public page).

## Outputs (`summarizeMidRecovery`)

- window flow: baseline WAIT vs directional, baseline fills, recovered
  directional, WAIT→directional, agreement with baseline;
- bottleneck funnel with counts and conversion %: observed → candidate →
  directional → team → support → quote → economics → eligible → confirmed →
  simulated_booked;
- quality per arm: N, wins, losses, WR, avg ask, avg fee, needed WR, net, avg
  per fill, max drawdown, Brier of the market-implied probability (Chair
  confidence is not a probability: no Brier is reported for it);
- NULL_FAV_80 comparison: overlap, side agreement, incremental net on the
  settled overlap, recovered-only and null-only windows;
- seat / card / family breakdown.

No auto-promotion. Measure first; nothing is tuned on the evaluation sample.

## Historical diagnostic

Not run. The recovery path needs the producer's full snapshots (candles, OI
and funding series, feature state); the stored replay rows do not hold them,
so any replay would have to invent inputs. The experiment is prospective.
