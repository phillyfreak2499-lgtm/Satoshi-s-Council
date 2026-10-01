# Authority quarantine and Chair sit-mass

Owner priority: answer whether unavailable seats suppress available sources before any further restoration or retirement.

## Confirmed defect

On main `25b306a`, the real producer's `pickLiveAndPaper` returns its ordinary WAIT fallback when its selectable LIVE pool is empty. `sitUnlessSure` returns a natural WAIT without setting `forced_sit`. `admitCouncilVotes` checks only directional reads and therefore leaves this WAIT ordinary. `runChair` excludes forced sits, but included these ordinary fallback WAITs in sit-mass. The bar adds `0.2 * sitMass`.

An isolated reproduction with the real producer and Chair, all predictive cards SHADOW, and otherwise identical market/learner/settings gave sit-mass 1 and bar 0.54. Removing those quarantined rows gave sit-mass 0 and bar 0.34. This is a mechanical reproduction, not a production window, historical economic replay, or a claim of recovered bookings. Maximum pre-clamp tax is 0.20; the exact current-market tax requires a captured complete frame and learner context.

## Bounded correction

Count an ordinary WAIT in sit-mass only if the seat has a selectable LIVE card that passes the existing directional authority checks in the current regime AND the seat has no active COACH bench, mute, veto, unhealthy feed, incomplete calibration or zero-weight hold. Preserve every admitted direction in the denominator. Preserve a genuine authorized WAIT, the confidence/calibration discount, score weights, ranking, folding, hard gates, 80-cent floor, booking, risk, notification and follower controls. Remove unavailable ordinary WAITs from the Chair's WAIT quorum as well. The persisted abstention_eligible marker and shared chairQuorumMember predicate keep Chair quorum and roster receipts consistent, without rewriting legacy rows. No card status, calibration, history, retirement, or promotion changes.

Card inventory mirrors LIVE selection, explicit holds, sample and regime requirements, retired directional exclusions and the existing EXPLOIT guard. The shared numeric authority checks are reused. Each current row records selectable LIVE-card and authority-ready-card counts; legacy frames remain explicitly unverified in the availability summary.

## Public representation

Fifteen is a roster of roles, not a count of available evidence sources. Current-frame counts are shown on the homepage, Guided, Pro and Chair grid. Quarantined seats are labelled research; LIVE cards without authority are labelled held. The shared research-lean instrument, seat-page summary, compact BotCard and individual Chamber roster cards carry the distinction. Chamber uses the current read-only frame; absent authority metadata is unverified rather than voting. About, FAQ, root metadata, share metadata, Chamber roster copy and README use roster language. Availability, current speaking and booked entry are separate facts.

## Remaining investigation

Keep the ten silent seats in shadow. Review each card's original exclusion, current input health, evaluation activity and after-fee record. Do not restore or retire based on absence of production speech alone. Existing retired seats retain their historical labels; this change retires none. The authorized QUORUM_ABLATION_V1 remains a separate prospective study; no mid-flight tuning or automatic promotion is authorized. Collector activation and the durable start boundary must still be verified before counting its 21 days.

## Second-review acceptance checks

Real-producer COACH bench and expiry controls; real Chair output through chairRoster and quorumCheck across quarantine, bench, mute, unhealthy feeds, calibration holds and authorized WAIT; rendering of Chamber, summaries, compact cards and Guided/Pro counts; legacy metadata remains unverified. Issue #385 stays open. Owner authorization covers branch revision and review only; no merge or deployment without separate approval.
