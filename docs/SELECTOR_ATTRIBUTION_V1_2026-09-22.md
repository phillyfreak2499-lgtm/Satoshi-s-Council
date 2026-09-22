# SELECTOR ATTRIBUTION v1 — 2026-09-22

Owner decision after the external audit: do not retune the Chair; instrument
it. The 80¢ trial's +215¢ was not "80¢ contracts are better". It decomposed
exactly into −415¢ paid on the 91 shared fills and +630¢ saved by refusing 11
cheap windows the 70¢ shadow took (`docs/SELECTOR_VS_FLOOR_2026-09-22.md`).
The research target is therefore the **selector**, not the floor:

> What information did Satoshi have when it rejected those windows, and is it
> repeatable decision-time information or an accident of 11 observations?

Historical windows cannot answer that: they were measured on whole-cent
prices, under mixed eras, and the sample was the one the floor was chosen on.
So v1 logs, prospectively and from the first complete window after the shadow
lab's `prospective_start_at`, every divergence between a blind eligible
opportunity and the Chair-selected opportunity, with everything the Chair had.

## Definitions

| term | definition | code |
|---|---|---|
| blind eligible opportunity | the price favourite (higher ask) at or above the **deployed 80¢ floor**, under 99¢, spread ≤ 2¢, ≥ 1 resting contract, fresh feeds, inside T−10:00..T−3:00; the first tick it exists. Decided on the whole-cent lane exactly as the NULL_FAV control decides. No Council, no model. | `blindOpportunity` → `nullFavIntention(snap, 80)` |
| Chair-selected opportunity | the production paper book's actual position in the window (a call-log row with a side) | `chairFillRow` from `frame.call_log` |
| divergence | `BLIND_ONLY` (blind eligible, Chair did not fill), `CHAIR_ONLY`, `BOTH_SAME_SIDE`, `BOTH_OPPOSITE`, `NEITHER` | `classify` |
| accepted / rejected | accepted = `BOTH_SAME_SIDE`; rejected = `BLIND_ONLY` | WINDOW row payload |
| prospective | window **start** (`close_time − 15 min`) ≥ `prospective_start_at`; the table's check refuses anything earlier | migration 0059 |

## What each row records

Table `desk_selector_attribution`, primary key `(ticker, close_time, kind)`,
append-only (ON CONFLICT DO NOTHING). Three kinds per window:

- **BLIND_ELIGIBLE** — at the first blind-eligible tick: side; **exact ask**
  (deci-cents, the venue's price) beside the whole-cent decision ask; exact
  fee (`KALSHI_TAKER_7PCT_CEIL_CENT_V1` on the exact ask) beside the whole-cent
  fee; spread and depth on the exact lane; Chair lean / confidence / score /
  bar / vs_bar / dir_mass / sit_mass; **model fair YES** (`snap.fair_yes`) and
  **market YES mid** (`snap.yes_mid`) as the probability-shaped fields (Chair
  confidence is a gate number and is never relabelled a probability); lab fair
  and **settlement-index margin**; **model edge** after fee (`snap.edge_*`);
  feed health (spot/kalshi status, divergence, basis, ages, gap); quorum
  counts; every seat with lean, status, health, conf, effective weight, card;
  **eligible seats** per side (`supporterRows`); **directional votes**;
  **evidence groups** per side; **reachable quorum** per side under the
  deployed policy; the deployed **gate vector** re-evaluated on the cloned
  frame with the production **binding (rejection) reason** (re-evaluated
  without the engine's confirmation watch, so when it names confirmation the
  engine's own admission audit, recorded beside it, is the verdict);
  counterfactual flags (below).
- **CHAIR_FILL** — when the observer first sees the production position: the
  booked whole-cent ask (the ledger's price) as `ask_whole_cents`, the exact ask
  on that side at first sight as `ask_cents` (labelled: ≤ one 2 s poll after
  the booking tick, not the booking tick), the same Chair state, whether the
  blind opportunity was the same side and when it appeared.
- **WINDOW** — when the band closes: the divergence class, the blind and Chair
  legs, Chair leans in order, and the **chalk-adjusted WAIT** facts at the
  frozen T−7:30 / T−5:00 checkpoints (was the Chair WAIT; was a side already
  ≥ 99¢).

## Counterfactuals collected on every opportunity

Recorded at decision time, priced at settlement (`settleAttribution`):

| counterfactual | at decision time | after the official result |
|---|---|---|
| **92¢ cap** (the external auditor's proposed block) | `cap_blocked = exact ask > 92` | `net_under_cap` (0 when blocked), `cap_change` |
| **flat 3¢ vs price-aware gate** | `FLAT_3C` (production), `QUARTER_OF_WIN`, `FEE_PLUS_2` thresholds at the whole-cent ask and pass/fail on the recorded model edge (`counterfactuals.ts`) | net per variant (0 when it would have refused) |
| **exact quote precision / slippage** | `exact_minus_whole`, `fee_exact − fee_whole`, whether the exact lane was present | `net_exact`, `net_whole_lane`, `lane_delta` |
| **chalk-adjusted WAIT** | chalk flag at each checkpoint and on the opportunity | published beside the raw WAIT rate, never instead |
| **divergence P&L** (WINDOW) | — | `blind_net`, `chair_net`, `chair_minus_blind`, each also under the cap |

Status transitions are collected separately (`SKILL_STATUS:*` system events,
on by default since the reconciliation merge) and joined by time.

## What v1 is not

- Not a decision path. The recorder runs inside the shadow-lab observer's tick
  on a **cloned** frame, gated by `SHADOW_LAB_ENABLED=true` and by the
  manifests' durable boundary; it reads the production Chair result, never
  changes it. No seat, gate, Chair input, learner or book imports it
  (`scripts/selector-attribution-rails.test.mjs`; `scripts/shadow-lab-rails.test.mjs`).
- Not a backtest. Nothing before `prospective_start_at` is written, and the
  historical +226¢ is not re-derived here.
- Not a verdict. The divergence rows are the evidence; the question "does
  Satoshi select better windows than the market, or was +226¢ a fortunate
  sample?" is answered when enough prospective windows exist, with the same
  paired, day-blocked machinery the shadow lab uses.

## Activation and rollback

| step | how | rollback |
|---|---|---|
| table | `migrations/0059_desk_selector_attribution.sql` applies on deploy (additive, idempotent) | `drop table desk_selector_attribution` |
| collection | starts automatically with the shadow lab: `SHADOW_LAB_ENABLED=true` → atomic activation stamps `prospective_start_at` → the recorder reads it and logs from the first window that starts after it | unset `SHADOW_LAB_ENABLED` (the observer, and with it the recorder, refuses to start) |
| health | `shadowLabHealth().attribution`: boundary, windows tracked, rows written / failed / settled, last error | — |

## Reading the evidence (after enough windows)

- Rejected windows (`BLIND_ONLY`): group by `rejection_reason`, then by the
  gate check that bound (`payload.chair.gate.failed`), and compare
  `counterfactual.settled.blind_net` across groups. A reason that predicts
  losses on the blind leg is repeatable decision-time information; one that
  does not is noise.
- Accepted windows (`BOTH_SAME_SIDE`): `chair_minus_blind` is the price the
  Chair paid for waiting past the blind first touch.
- Cap and gate variants: sum `net_under_cap` and each `gate_variants.*` net
  against `net_exact` over the same rows; the auditor's 92¢ block is adopted
  only if it wins prospectively, not because it would have on 15 historical fills.
