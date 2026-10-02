# Council voice and within-bot research — October 2, 2026

Owner scope: five priorities in order. Shadow first; pre-registered kills; no changes to the 80¢ floor, bar, booking/risk rules or production learner without explicit owner word. Merge approval for execution Lab is separate. The paired collector is implemented and defaults OFF. It has no production decision-path caller or trading authority.

## Eight reports read oldest to newest

| File | Recommendation and lead disposition |
|---|---|
| [0532 FOLLOWER-SIZE-5](https://drive.google.com/file/d/1AyGwAK2qGb27s2cLJ4Q8eh_gV2IXX7mf/view) | Muse reports owner-directed follower size 5, LIVE=1 and deployed. Informational; not independently verified here; follower operations are outside this research. |
| [0535 LATE-ENTRY-BAR-ANALYSIS](https://drive.google.com/file/d/13LMAzk2BdOBtXNL__uDdRlfy94PPKgly/view) | No higher late bar. Agree: observational selected late entries cannot justify a production timing change. |
| [0545 SEAT-VOTING](https://drive.google.com/file/d/1k9Gb5gdTCGRan1DIRehuiMmfuNY0haZB/view) | Grade DRIFT and investigate ten quiet seats. Agree, but primary telemetry disproves the broad claim that their skills never fire. |
| [0555 SEAT-WEIGHT-ADDENDUM](https://drive.google.com/file/d/1Kp5mql1pWvX_cOF-M-aMDQHwpjbJATiH/view) | Existing weights already use track record; evaluate removing the confidence cliff. Agree as isolated research. |
| [0558 LISTEN-NOT-GAG](https://drive.google.com/file/d/1MQjOXEPukoNY03z8sJnywQhdlNqvPq1j/view) | Keep voice; weight hearing. Implemented inactive paired Chair adapter. |
| [0602 CHAIR-CONNECTION](https://drive.google.com/file/d/1EZIlOEh2IiVSa9i0jf92Xf9YfZgkXQzp/view) | Remove first gate, preserve authority admission. Only selected numeric confidence gag restored; benches, roles, health, card selection and authority remain intact. |
| [0608 LIVELY-DESK-VISION](https://drive.google.com/file/d/1uhKQ8WbsYi-cM713BscNZ2nWCWsvQPcn/view) | Visible research, personal preferences, honest records. Added read-only comparison board and browser-local favorites; no canonical effect. No fabricated chatter when no signal exists. |
| [0612 WITHIN-BOT-SIGNALS](https://drive.google.com/file/d/1gFYBKuxW14mEjtdQTEjV-cfNhZ_BLdl3/view) | Generalize WICK trust inside each bot. Generic isolated ledger implemented for all 21 seat IDs; reviewed semantic component adapters and prospective receipts are still required. |

## 1. Move the confidence gate — inactive preregistration

ID COUNCIL_VOICE_V1_INACTIVE. Frozen 21-day prospective study begins only after publishing/collector QA. No historical backfill into prospective scores. One complete exact ticker+close window is one trial, never every frame. Control and candidate consume identical selected producer votes, settings and independent private learner copies through the actual runChair. The only intervention restores selected LIVE, healthy, nonbenched sub-bar raw direction and its actual raw confidence; it never uses the forced-WAIT display confidence of 70. No paper-candidate recovery or authority promotion is bundled in.

admitCouncilVotes remains authoritative, including LIVE status, owner hold, retired rules, mature n/ev_n, Wilson, after-fee EV and regime/walkforward requirements. Existing weight, confidence exponent, fade and family folds remain. All Chair bar formulas/constants remain unchanged; the computed bar can naturally differ when the intervention changes directional/sit mass. This is measurement of that mechanism, not bar tuning. The raw adapter returns Chair decisions. The separate paired simulator now applies time softening, sticky Chair, selective admission, current edge/team/floor/resting-size checks and one simulated observed-ask fill per exact window. It preserves current fees and independent book risk. This is a sampled paper model, not evidence of executable IOC fills.

Research kills, frozen before any prospective run:

- Any input mutation, unauthorized admission, production output change or future receipt: kill immediately.
- More than 5% invalid complete windows after 20 observed windows: pause capture; missing data never becomes a zero-return sit.
- At least 20 valid paired windows and aggregate after-fee candidate-minus-control <=−100¢: kill economics.
- At the 21-day end require at least 50 paired windows with changed decisions, positive paired net, separately frozen confirmation and explicit owner acceptance. Otherwise hold the candidate. Never automatic promotion.

Economic kills refer to real prospective, rule-qualified one-contract shadow positions and a matched control with both relevant fees; research Chair decisions alone cannot supply them. No runtime study has begun, and no economic result is claimed.

## 2. DRIFT primary grading — completed diagnostic, not promotion evidence

Read-only Render Postgres dpg-daceqf0ae00c73f310bg-a, desk_ledger_research exact official kalshi-result outcomes; desk_seat_reads receipts matched by ticker AND close_time. Fixed rolling report cohort: close >=2026-09-25T05:00Z and <2026-10-02T05:00Z. This reproduces the Chicago day-boundary report, rather than drifting now()-7 days.

- Stored crew report 2026-10-02: DRIFT reads61, spoke12, gagged49; spoke hit100%; separate mid-window sample74, hit86%, mean−4.3¢. Those are different populations.
- Terminal ledger raw direction and final WAIT: 49/49 correct. Spoken terminal rows:12/12. buildLedgerRow uses the grading source votes near the end of a window; these are not booked-entry reads.
- Within those 49 terminal-selected windows, first telemetry below_speak_conf read with at least120 seconds left: available47, correct43 (91.5%), missing2. Average615.475 seconds left. This cohort was selected retrospectively by its terminal state, so cannot establish a general gagged-read edge.
- Without conditioning on terminal state: first captured below_speak_conf directional DRIFT read with at least120 seconds left in each exact window: **174/238 correct (73.1%)**. Official outcomes only, observed pre-close receipts. This is the better diagnostic, still neither a randomized causal estimate nor trade P&L.
- For the47 earlier receipts in the reported cohort, a backward-only exact-window decision snapshot within8 seconds matched only6 contemporaneous quotes; all6 held-side asks were below80¢. No ask/fee net is imputed for the other41, and no admissible 80¢-floor profit claim can be made from those6.

Verdict: grade complete without rewriting ledger/learner. A promising terminal score does not justify a lower speak bar or a production authority change. Proceed with the frozen shadow gate comparison. Save source query definitions alongside the implementation; the data can advance, but the diagnostic cohort is fixed.

## 3. Within-bot components — framework implemented, adapters pending

signal-book-shadow supports every SEAT_ID, separate bot/kind/version/side keys, first receipt per component-side per exact window, official outcomes, frozen receipt ask+fee, immutable caller inputs and isolated stats. Current/future outcomes cannot be used to tune the same window. It reuses the actual WICK patternTrust: n<8 uncalibrated, fold at n>=12 when Wilson<.4 or economic evidence EV<−1.8, otherwise scale/cap. No production pattern_book or learner writes.

A bad component folds independently; it does not silence the whole bot or invert its side. Bot-specific combination remains outside this generic ledger. **The framework is not a claim that every bot already emits semantic components or tunes itself.** Each needs versioned kinds, own component direction, binding feature/threshold evidence and pre-outcome capture; do not label a parent card's side as the direction of every numeric feature. Context/non-voter signals stay context. No generic feature-to-side conversion is authorized. Opposing component sides are distinct correlated records, not independent trade trials.

Next implementation: WICK existing marks as the reference adapter, then DRIFT structure/acceleration/pullback, TAPE flow, CHAIN funding/OI, STRIKE settlement-distance, and the remaining seat generators. Compare tuned/untuned components on the same frozen prospective receipts; retain untouched controls and per-component no-data counts. Only after real adapter and aggregation tests can any signal-level result be advertised.

## 4. Ten quiet seats — primary diagnosis

desk_seat_reads as_of >=2026-10-01T00:00Z and <2026-10-02T11:00Z. Each seat had10452 sampled rows across180 distinct exact windows. These are sampled ticks, not independent forecasts or complete-window QA.

| Seat | Selected raw/final directional ticks | Directional shadow candidate ticks |
|---|---:|---:|
| CARRY | 0/0 | 390 |
| CASCADE | 0/0 | 8032 |
| EXHAUST | 0/0 | 247 |
| PULSE | 0/0 | 683 |
| STREAK | 0/0 | 4367 |
| TAPE | 0/0 | 2644 |
| VEL | 0/0 | 2963 |
| VOLT | 0/0 | 68 |
| WHALE | 0/0 | 1470 |
| WICK | 0/0 | 1636 |

Selected status SIT for all ten. Recorded reason no_skill_fired means **no selected LIVE rule**, not no generated shadow signal. Some rows are feed_down. pickLiveAndPaper selects LIVE cards eligible in regime and not closed/held/exploit-rejected; it evaluates other cards into paper/shadow without granting authority. Thus raw signal generation is present. Exact per-card status/owner hold/regime/threshold/feed attribution needs candidate census from approved narrow captures; no deep state export, mass unmute, new LIVE labels or threshold relaxation. The voice intervention deliberately does not restore paper candidates, so it cannot by itself activate these seats.

## 5. Public records — display implementation, not deployed

New /api/bot-records uses a read-only, seven-day official research-qualified ledger summary; raw vs final directional hits and denominators, observed windows, suppressed raw directions and role. Missing rows remain zero observations with a dash for hit rate; small samples labelled. Terminal readings explicitly separated from entry accuracy, P&L and paper trades. Favorites persist only in this browser and reorder the comparison board in CrewTab; they do not change existing mutes or canonical Chair/book. No cosmetic winning percentages substituted for economic results.

Daily owner update: existing MUSE automation updated to cover these five ordered tracks, with current states, receipts, blockers, recommendations and exact next actions. Schedule retained daily around8am America/Chicago. This is a bounded read-only reporting run, not continuous background coding or automatic release.

Initial publication was blocked by automatic push review. Zach's subsequent instruction to review and push ready work authorized publication to the Council repository. The reviewed code is now published in draft PR #410, with exact-head GitHub CI required before release. Shell Git lacked push credentials, so the connected GitHub app published a tree verified identical to the reviewed local source. No production policy change, deployed collector or active study is claimed. Review also corrected delayed-outcome trust: a component grade becomes available at its actual official-grade receipt time, not at window close.


## October 2 continuation — semantic receipts only

Added inactive `componentReceipts` for WICK confirmed/context-qualified recent marks and DRIFT aligned returns, strong acceleration, pullback and candle structure. Each observation carries its own direction, exact window, actual frame receipt time and binding feature evidence. Only closed candles already received at the frame are used; unhealthy/divergent/stale spot, invalid returns and future/expired frames produce no observations. No parent-card direction or arbitrary component confidence is substituted. These receipts deliberately cannot enter the confidence-based signal book until a separately reviewed confidence/aggregation specification exists. No collector, timer, persistence, economics or automatic tuning has been activated. The paired simulator and durable collector described below complete that implementation blocker. Deployment resource verification and prospective activation remain pending; no matched profit is claimed from these semantic adapters.


## Paired collector implementation — disabled pending runtime QA

`COUNCIL_VOICE_V1_ENABLED` must equal `true` to create a timer or initialize a study. Default OFF performs no collector database access. The health endpoint only invokes this guarded observer. The header-authenticated `/research/council-voice` report is read-only, uses `x-desk-admin`, returns 404 without authorization and cannot activate a study.

Activation pins a protocol fingerprint and full deployed build SHA, chooses the next complete 15-minute window and enumerates all 2,016 expected windows across 21 days. Restarts preserve that clock and exclude the open restart window. A changed build/protocol, future receipt or mismatched production policy kills integrity. Production state, ledger, learner, alerts and orders receive no writes.

Both shadow books begin with empty risk histories. They consume identical contemporaneous production-selected, already-sticky votes and calibration copied privately for each frame. Each arm owns Chair stickiness, entry watch, first directional lean and sampled book risk. This measures paired sampled books with shared production calibration, not a replay of the production portfolio or a separately trained counterfactual learner.

Sampling is every four seconds under its own measured process CPU, event-loop delay, RSS, container memory limit and DB latency/pool governor sample. It does not enable or depend on the research factory. CPU warmup and pressure failure prevent initialization of a new study; an existing study records durable exclusions. Opening and closing coverage must be within eight seconds, gaps cannot exceed ten seconds, and duplicate frames cannot advance confirmation. Busy, governor, restart and incomplete capture exclusions are durable. A prior-window snapshot at rollover is ignored; input failures are attributed to that input’s close, never the next window. Missing observations invalidate later windows on affected Chicago risk days, including previously graded results whose risk path became uncertain. Those windows carry null economics; missing official outcomes remain pending. Exact ticker plus close official `kalshi-result` outcomes settle shadow risk and after-fee economics atomically. Conflicting official winners do not grade.

Separate migration 0075 stores manifest, expected windows, checkpoint books, immutable replay baseline and exact JSON frame deltas with pre-frame books. Atomic revision checks commit book advancement and frame receipt together; failed writes cannot advance a local book. Input compressed bytes are capped at 64 KiB, per-window replay at 2 MiB and total study replay at 4 GiB. These bound encoded replay content, not total database overhead. Full-window synthetic replay measured approximately 767 KB of encoded content for 225 frames; reconstruction equality is tested on every frame. This is a synthetic feasibility check, not measured production storage, CPU, database cost or profit.

No study has started. Before activation, verify deployed migration, pinned build, disabled status, resource headroom, real frame sizes, authenticated report and restart behavior. The frozen kills and final confirmation/owner acceptance remain mandatory; the report never promotes a candidate automatically. Other seat component adapters and confidence aggregation are separate unfinished research.

Review follow-up: generic component signals now carry ticker and close, and mismatched receipts cannot receive another window’s grade. Runtime tests cover standalone sampler warmup and prior-window rollover.
