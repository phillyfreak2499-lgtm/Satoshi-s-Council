# MID_RECOVERY_LOCKS_V2_INACTIVE: LOCKS with both integrity defects corrected

Research only, simulated, default off. It never books, promotes, tunes a
threshold or changes anything the public Floor, Chair, followers or Training
show. Production authority is NONE for every arm.

## Why a V2

`MID_RECOVERY_LOCKS_V1_INACTIVE` asks which lock holds the recovered read back.
The research auditor found that two defects can affect its results:

- **P1:** the Chair counts support per seat, so STREAK and STRIKE count as two
  supporters. Under E1, STREAK is a book read, so the pair is one book read.
- **P2:** an exploit-rejected LIVE card could reach recovery through research
  capture.

V1 keeps running unchanged, and its receipts are annotated, never rewritten.
V2 asks the same question with the same five arms, on a path where neither
defect can produce a result. Its receipts can therefore be clean evidence from
the first window.

## The two corrections

| | what V2 does | where |
|---|---|---|
| **P1** | In every recovered arm, STREAK is relabelled `E1_BOOK_DUPLICATE` when it and at least one other E1 book-family seat (STRIKE, ODDS, TAPE and others) both count as supporters of the same side. This applies to support accounting only. The deployed support predicate (`eligibleSupportRows`, used by `gateVector` and the evaluator alike) then counts the pair once. | `dedupeE1BookSupport`, applied last, after an arm's own V1 wrapper |
| **P2** | The producer frame must carry `capture_policy: "P2_EXPLOIT_GUARD_V1"` (`bots.ts`). A frame without it is not evaluated; the tick records the error. | `evaluateLocksV2` |

What the P1 correction does not change:
- STREAK's lean, weight, health, fold or forced-sit flag;
- the Chair's lean, score, bar or gates;
- the family gate (STREAK was already a book read there).

When there is no overlap, nothing happens. A test proves that every V2 arm is
then exactly its V1 arm.

**When the correction matters.** In normal mode the deployed policy needs 2
supporters from 2 families. STREAK and STRIKE alone already fail the family
rule, so a verdict can only change where the double count was needed. That
happens in tight mode (4 supporters from 3 families), which starts after the
arm's own day reaches −100¢. Elsewhere the recorded supporter list is
corrected, but the verdict is the same.

## Arms

These are exactly V1's:
- **CONTROL:** the recovered path, plus P1.
- **BAR_NO_SITMASS:** the Chair bar without its `0.2 × sit_mass` term, plus P1.
- **SUPPORT_UNCAL_E1:** unfolded recovered UNCALIBRATED E1 rows may count as
  support. The waiver runs first, then P1, so a waived STREAK still counts once.
- **COMBINED_DIAG:** both changes, plus P1. Diagnostic only and never promotion
  eligible.
- **NULL_FAV_80:** the favourite benchmark.

The following are V1's, unchanged:
- the 80¢ floor and the < 99 ceiling;
- fees, spread and resting size;
- feeds, the settlement index, model edge and opposition;
- confirmation;
- day risk;
- the production Chair, the learner, booking, followers and settings.

## Persistence

`desk_shadow_receipts` through the shadow lab's append-only writer, under
experiment `MID_RECOVERY_LOCKS_V2_INACTIVE`. Never a V1 row. Every record also
carries:
- `capture_policy`;
- the P1 trace `intervention.e1_book_dedupe`: STREAK's side, the other book
  supporters, and whether the correction applied.

The research factory grades and audits these receipts like V1's (lifecycle
id `recovery-locks-v2`).

## Switch

`MID_RECOVERY_LOCKS_V2_SHADOW_ENABLED=true` (the literal string). It is
independent of `MID_RECOVERY_SHADOW_ENABLED` and
`MID_RECOVERY_LOCKS_SHADOW_ENABLED`. Off by default.

Report: `GET /research/mid-recovery-locks-v2?key=<DESK_ADMIN_KEY>` (404
otherwise).

As in V1, each process start is a fresh session boundary: the market already
open at boot is never collected.
