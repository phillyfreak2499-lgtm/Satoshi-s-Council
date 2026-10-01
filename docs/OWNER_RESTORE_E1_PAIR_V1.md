# Reviewed paper-authority restoration

The review ratchet moved predictive cards to SHADOW and reset calibration debt while automatic promotion was disabled. Freezing further demotions did not return the removed cards. This intervention deliberately restores authority; it is not a source-regression fix or evidence that every restored signal qualifies.

The project lead selected `STATUS_AND_STRIKE_CALIBRATION` under Zach's standing authorization to restore earned paper calls. Before activation, the real-money follower was changed only to `LIVE=0`; deployment and fresh `armed DRY` polls were verified. Re-enabling real orders is outside this restoration.

## Scope

`OWNER_RESTORE_E1_PAIR_V1` accepts exact strings only and defaults OFF:

- `STATUS_ONLY`: move only `STRIKE.itm_time` and `CHAIN.oi_with_price` from SHADOW to LIVE after validating the existing authority checks.
- `STATUS_AND_STRIKE_CALIBRATION`: the same status change plus a minimum STRIKE debt release to effective `WARM_N=20`. STRIKE's approved debt is 210 and seat count must be at least 210. Counts, hits, economic evidence and weights are not reset or fabricated. CHAIN calibration is untouched.
- `ROLLBACK`: return the recorded status/debt fields exactly, refusing malformed markers or subsequent changes. Grading's own count growth remains intact. A rolled-back version cannot silently reactivate.

At the pre-activation projection, STRIKE had seat count/debt 210/210, 1,979 economic reads, Wilson 0.948859 and EV 1.491157 cents. CHAIN had seat count/debt 398/340, 1,017 economic reads, Wilson 0.940195 and EV 1.558505 cents. These are aggregate authority inputs, not proof of current entry economics or expected future profit.

STREAK stays SHADOW: STREAK and STRIKE share one effective E1 evidence family. The selected STRIKE/CHAIN pair spans book and derivatives under both existing maps.

## Persistence and verification

The engine restores complete call, risk, pending and grading history first. It applies the intervention to a private candidate and acknowledges a forced full-state save before returning from boot or queueing transitions. A failed save retains the original learner and reports refusal. Invalid risk history remains blocked.

Verify the deployed commit, `owner_restore` marker and exact current status/debt projection before treating activation as complete. Separate post-activation observations by the marker's activation time and deployed build. Do not pool them with earlier or V2 research.

The 80-cent floor, producer health/speaking checks, numeric authority, Chair bar/time factors, two-family support, opposition, economic edges, quote depth/spread, confirmation and daily risk checks remain unchanged. Pilot and V2 activation are separate. An eligible route can be restored while a particular window remains WAIT. Recovery is not demonstrated until a genuine paper call books and notification evidence is verified.

## Primary proposal

- [Claude delivery](https://drive.google.com/file/d/1LOxmPrTa9x3nllcgVgR24P7hClYEZdv0/view)
- [Original module patch](https://drive.google.com/file/d/1dQ_nlQlbbqQMFN1VXwIAlBJd2ZW-aAgO/view)
- [Original test patch](https://drive.google.com/file/d/1bmNQcjfB70wk1GASnNDgjyq6Ep-OHtBk/view)

The integrated implementation additionally rejects malformed/foreign markers and nonfinite authority inputs, rechecks upgrades, and requires durable boot persistence. Historical fixtures remain synthetic and carry no production qualifying authority.
