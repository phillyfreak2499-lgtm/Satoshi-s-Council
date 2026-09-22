# Seven-day operator card — observations, not retuning

Day 1: run `npm run reconcile:book` at a fixed as-of; confirm the four /books
periods MATCH the reference; read the era table; confirm the deployed
`min_speaking` (2) against the owner reference (3) and decide item 1 of the
activation checklist.

Day 2: run the review-ratchet rail; read `reviewExposure()` for calls until
the next review per seat; confirm the missing-grade treatment (12 slots,
8 exclusions, no booked exposure).

Day 3: validate quotes, fee fingerprint, settlement and receipt integrity:
`docs/sql/exports/jump_settlement.sql` (jump_ms null count), `grade_gaps.sql`,
`booked_fills.sql` identity check.

Day 4: review the three manifests (`docs/experiments/*.json`), the controls,
the sample gates (250 AND 30 d AND 25) and the isolation rails.

Day 5: deploy collectors only after approval; the prospective clock starts at
the `prospective_start_at` written at activation.

Day 6: completeness (receipts per window per arm), duplicate writes (must be
0: primary key), overhead, policy parity between PKG_85 and the live book's
gate vector.

Day 7: continue / pause / kill review. A favourable first week does not
shorten the 30-day requirement.

Daily report fields: eligible MID speakers and groups (`desk_chair_evals`),
reachable quorum (gate vector), entry WAIT vs no-fill vs missing, qualified
fills, net and needed WR, peak drawdown and pending full-loss exposure, stale
minutes by source, status/review changes, policy fingerprint, ledger parity,
E1–E3 completeness and authority isolation.

Diagnosis triggers (not permission to act): average eligible MID speakers
< 0.5; two healthy days without a shadow fill; a seat speaking on > 60% of
windows; a sudden call-count change; a seat within 20 calls of a review.
None of these loosens a quorum, imposes a quota, mutes a seat, or promotes a
veto. An 80¢ quote existing is not a positive-edge opportunity.
