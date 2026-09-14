# Ledger window investigation — 14 September 2026

The missing 12:45 UTC window is a real data loss. The restart gap is reproduced and a prevention fix is prepared. The original complete grading record cannot be recovered from the retained database records inspected.

## Evidence

- Window: KXBTC15M-26SEP140845-45, closing 2026-09-14 12:45:00 UTC.
- Render deployment dep-dajuoa0u01pc739ftf80 began at 12:44:24 UTC and finished at 12:45:20 UTC, spanning the close.
- There is no desk_ledger row and no desk_replay row for this exact window.
- Two decision snapshots remain: OPENING at 12:30:14 UTC and FIRST_DIRECTIONAL at 12:36:58 UTC. These are earlier observations; neither is the final grading snapshot.
- The saved paper call is DOWN at 85 cents, recorded at 12:36:58 UTC. Its settlement field remains null.
- The saved entry metadata records a 1-cent fee and build fc099ee3bb052800035c450bc7d4ebe95631233a.
- The exact [official market](https://api.elections.kalshi.com/trade-api/v2/markets/KXBTC15M-26SEP140845-45) is finalized with result no (DOWN), close_time 12:45 UTC, and expiration value 77899.32.
- The documented paper-position outcome is therefore 100 - 85 - 1 = +14 cents. This is a reconstruction from the saved entry and official outcome, not a newly recovered complete ledger row.
- Pending settlement and ledger-write queues are empty for the missing window. The retained mid-window research sample is still ungraded.

## Failure and prevention

The engine saved pending windows after rollover and saved completed ledger jobs. It did not save the active window's snapshot, votes, or grading candidate. A process replacement that crossed close could therefore lose the only input needed to create a pending or completed record, even though the earlier paper entry survived.

The proposed fix checkpoints the original grading input during regular state saves. After restart, it passes that input to the existing settlement path, retaining exact identity checks and duplicate-grade protection. It never treats the checkpoint as a fresh feed or recomputes historical votes. State saves are serialized in capture order to prevent an older write from overwriting a newer completion.

## Recovery limit

The final seat-level votes and final grading frame are absent from the retained records inspected. An earlier Chair read is not a substitute. The present ledger schema also requires grading fields; creating a row with invented values or zero defaults would misrepresent this loss.

No historical records, research eligibility rules, health thresholds, or paper results have been changed. The missing window remains visible. A future recovery operation should restore only fields supported by original evidence and represent missing grading evidence explicitly, outside countable research results.

## Validation

Eight regression tests execute the actual engine persistence and settlement functions with database I/O and the downstream grading consumer substituted. They cover a restart across close, restart before close, newer observations, delayed settlement, legacy state, malformed identities, overlapping saves, and write failure recovery. All eight pass.

The existing reliability, window identity, pending recovery and settlement suites also pass: 82 tests. Full repository CI is required before deployment.

