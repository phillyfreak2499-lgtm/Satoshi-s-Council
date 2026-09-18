# CHAIR_SHADOW_LAB_V1 — Chair v2 / Chair v3 scoreboards on the Lab

Frozen 2026-09-18. Paper research. Authority: **paper-only · none**.

Two probability chairs already run in shadow beside the live Chair and keep their own ledgers. This protocol puts those ledgers on the public `/lab` page as read-only cards so each chair can earn, or fail, the gates already written in its own source file. Nothing on the cards can change the Chair, enter the Council, alter the paper book, or promote itself.

## What this is not

The Lab already labels two things "V2" and "V3": `FLOOR_SELECTIVE_V2` (a floor policy version) and `ENTRY_SELECTIVE_V3` (the active entry policy, scored by the entry-time call-quality study). Those are **entry policies** and keep their meaning. This protocol is about `src/lib/desk/chair-v2.ts` and `src/lib/desk/chair-v3.ts`, the shadow probability chairs. The page says so in one line so the digits are never confused.

Neither chair is an exit candidate. `CHAIR_V2` / `CHAIR_V3` are not added to `EXIT_CANDIDATES` or to any floor policy. The exit ids remain `HOLD_V1`, `PROVE120_V1`, `PROVE180_V1`, `PROVE240_V1`, `TAKE90_V1`, `TAKE90_V2`.

## Chair v2 card

Source of truth: `src/lib/desk/chair-v2.ts`. Numbers: the engine's own `V2Stats`, produced by `refreshV2Stats` in `server-engine.ts` and read off the server frame — the same object the desk page's shadow panel shows. The card reuses those numbers; it does not keep a second book.

Shown: `n_graded`, `n_samples`, `calls_v2`, `ev_v2`, `ev_v1`, `brier_v2`, `brier_market`, and `v2Gates()` — `{ samplesOk, callsOk, brierOk, met }` — called verbatim from chair-v2.ts.

Frozen gates, cited from chair-v2.ts and not restated anywhere else:

| Gate | Rule in source |
| --- | --- |
| samplesOk | `n_graded >= V2_GATE_SAMPLES`, where `V2_GATE_SAMPLES = 300` |
| callsOk | `calls_v2 >= V2_GATE_CALLS && ev_v2 > 0`, where `V2_GATE_CALLS = 40` |
| brierOk | `brier_v2 < brier_market`, both non-null |

Live rule, printed in one line: fill only where P beats the ask by fee + `V2_MARGIN_CENTS` (6¢); no entry under `V2_MIN_ENTRY_CENTS` (35¢); one sample per window at `V2_SAMPLE_MINS` (7.5 min left); population `V2_POPULATION` ("research-quality-valid").

Caption on the card: shadow only. Raw seat evidence plus market and fair logits. Nothing here touches the live Chair.

## Chair v3 card

Source of truth: `src/lib/desk/chair-v3.ts`. Numbers: the existing strict walk-forward report (`chairV3Snapshot` in `chair-v3.server.ts`), which runs `walkForwardV3` read-only over rows already stored and caches for ten minutes. `fitV3`, `predictV3` and `V3_FEATURES` are unchanged.

Shown: `n_rows`, `n_scored`, `market_brier`, `v3_brier`, `brier_delta`, `market_log_loss`, `v3_log_loss`, `avg_abs_adjustment_pp`, `max_abs_adjustment_pp`, `model_n`, `V3_MIN_TRAIN = 240`, `V3_MAX_ADJUSTMENT = 0.10`.

Gate: `v3_brier < market_brier` on the walk-forward points. `n_scored` counts points scored after the `min_train` warm-up, each predicted only from earlier closes; it is printed as a count, not as a threshold, because chair-v3.ts writes none.

Caption on the card: market prior plus a bounded ±10pp correction. No authority over the live Chair or paper book.

## Standing

Each card carries one of three standings:

- **unavailable** — the source produced nothing this request (engine frame or report unreachable). Rendered as unavailable, never as zeros.
- **collecting** — evidence exists but at least one frozen gate is unmet, or nothing has been graded yet. An ungraded ledger prints its raw sample count and nothing else; a 0-call, +0.0¢ "record" is not a record.
- **gates-met** — every frozen gate holds on the current sample. Still not promotion.

**Meeting a count is not promotion.** A filled sample bar is not a winner. Any change to the live Chair requires a separate documented review under the existing promotion gates; this page has no route to trigger one.

## What the code may not do

- No refit. No write to `desk_samples`, `desk_state`, or any table.
- No call to `predictV2`, `decideV2`, `fitLogistic`, `fitV3`, `predictV3`.
- No import of `chair.ts`, `learner.ts`, `bots.ts`, `clock.ts`, `seats.ts`, `crew.ts`, `skill-gate.ts`, `promotion-gates.ts`, the paper book, or any actuator.
- The brain never imports the scoreboard; the scoreboard reaches the engine frame only through a dynamic import with a bounded wait, exactly as the homepage does.
- One source failing does not hide the other, and neither failing takes the Lab down.

Rails: `scripts/chair-shadow-lab-rails.test.mjs`. Projection tests: `src/lib/desk/chair-shadow-lab.test.ts`.

## Rollback

Remove `<ChairShadowLab />` from `LabRoom.tsx` and the two fields from `lab-public.ts`. No table, no migration, no policy, no paper position changes. Both shadow chairs keep running exactly as before.
