# MID_RECOVERY_LOCKS_V1_INACTIVE — which lock holds the recovered read back

Research only. Simulated only. Production authority: NONE. Inactive by
default. Nothing here books, promotes, tunes a threshold, or changes what the
public Floor, Chair, followers or Training show.

## Question

The `MID_RECOVERY_V1_INACTIVE` direction audit
(`docs/MID_RECOVERY_DIRECTION_AUDIT_2026-09-26.md`, PR #335) found two locks in
front of the recovered E1 read: the Chair bar's `0.2 × sit_mass` term keeps
the read just under the bar, and behind it the support stage refuses
`UNCALIBRATED` rows (STREAK and STRIKE carry a full calibration debt). On the
same windows, prospectively: what does removing each lock alone, and both
together, do in simulation?

## Arms (one identity: ticker + close_time)

| arm | change from the V1 recovered path | promotion eligible |
|---|---|---|
| CONTROL | none — exactly V1's `RECOVERED_MID` (same evaluator, same inputs) | no (reference) |
| BAR_NO_SITMASS | the simulated Chair's bar without its sit-mass term | yes (owner review only) |
| SUPPORT_UNCAL_E1 | an unfolded recovered E1 row marked `UNCALIBRATED` may count as support | yes (owner review only) |
| COMBINED_DIAG | both | **never** (two changes cannot be attributed) |
| NULL_FAV_80 | the existing favourite benchmark | no (benchmark) |

"Promotion eligible" only means the result may be put to the owner for a
separate, pre-registered test. There is no auto-promotion.

### How each change is made

- **BAR_NO_SITMASS** runs the actual `runChair` twice on its own clones: once
  as production, then with `adaptive_bar: false` and `bar_override = base −
  sit term`, which replaces only the bar's base step. Every other bar step,
  the 0.24–0.72 clamp, the score, family folding and every gate are the
  Chair's own. The receipt records `control_bar`, `sit_term`, `arm_bar` and an
  `exact` flag (`arm_pre_clamp = control_pre_clamp − sit_term`, sit mass
  unchanged). `chair.ts` is not modified.
- **SUPPORT_UNCAL_E1** relabels, on a copy of the simulated Chair, a recovered
  E1 candidate row from `UNCALIBRATED` to `LIVE` so `eligibleSupportRows` may
  count it. Weight, lean, health and forced-sit are untouched; a folded row
  stays folded; a production seat is never waived. The learner's calibration
  debt is not touched.

## Unchanged in every arm

80¢ floor, ceiling < 99, taker fee, spread ≤ 2¢, resting size ≥ 1, feeds,
settlement index and margin, model edge, opposition, family de-duplication
(STREAK is a book read), minimum speakers/families, confirmation frames and
seconds, each arm's own day risk and profit reserve, and the SIMULATED
booking at the production `bookable` floor.

## Isolation

Every arm gets its own `structuredClone` of the snapshot, learner, production
Chair, settings, call log and producer frame (the producer runs once per tick),
its own confirmation latch (`EntryWatch`), its own prior lean and its own risk
history (its own fill receipts). No arm can see or mutate another's objects.

## Persistence

`desk_shadow_receipts` under experiment `MID_RECOVERY_LOCKS_V1_INACTIVE`,
through the shadow lab's append-only writer (primary key
experiment|arm|ticker|close_time|kind: five arms on one window are five keys)
and the shared settle sweep. Never a `MID_RECOVERY_V1_INACTIVE` row; V1 data is
never read. No migration, no manifest slot.

Fresh boundary: each process start is a new observer session; the market
already open at boot is skipped, and the next window to open is the first one
recorded. The T-3 sit is written only for a window this session evaluated in
band.

## Switch

`MID_RECOVERY_LOCKS_SHADOW_ENABLED=true` (the literal string), independent of
`MID_RECOVERY_SHADOW_ENABLED`. Off by default. Report:
`GET /research/mid-recovery-locks?key=<DESK_ADMIN_KEY>` (404 otherwise).
