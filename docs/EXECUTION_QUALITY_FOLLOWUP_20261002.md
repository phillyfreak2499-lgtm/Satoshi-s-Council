# Execution quality follow-up — October 2, 2026

Status: implementation specification only; not registered, collecting, deployed or activated. Paper-only, no production authority.

## Evidence and decision

Reviewed repository baseline: 7a75022d4239b826d000453fa4389abaaf1ef0ba (PR #409 merged). EXECUTION_LAB_V1 has seven frozen arms, a durable 21-day boundary, canonical entry selection and durable exclusions. Its quote path stores timestamp, YES bid and YES ask. The protocol explicitly disclaims fillability and latency survival. Source: docs/EXECUTION_LAB_V1.md, src/lib/desk/execution-lab.server.ts, src/lib/desk/execution-lab.ts at the baseline.

Decision: preserve EXECUTION_LAB_V1 and QUORUM_ABLATION_V1 definitions and cohorts. Prepare a separate execution-quality observer before considering any change to calls. No claimed improvement in BTC prediction accuracy follows from the external reading.

## External reading and limits

- Baheet, “Lotus Is Building the Execution Layer Prediction Markets Are Missing”: https://x.com/i/article/2101973272577400941 . Only search-indexed excerpts were accessible; original Lotus Labs papers were not retrieved. The excerpts motivate execution and contract-equivalence checks, not a verified trading edge.
- Baheet, “Whoever Owns the Memory Owns the Agent”: https://baheet.medium.com/whoever-owns-the-memory-owns-the-agent-b2fc5b726457 . Accessible essay motivates portable, dated, provenance-bearing project state. Product performance claims were not independently validated.
- Baheet, “Nobody Is Using Permissionless Prediction Markets for What They Were Built For”: https://baheet.medium.com/nobody-is-using-permissionless-prediction-markets-for-what-they-were-built-for-78585a7c8d6d . Accessible essay informs product focus; it is not empirical evidence of our users' preferences.
- Chen, Long and Su, “Ghost-Filled Orders: Detecting and Testing Atomicity Violations in Non-Custodial Prediction Markets”: https://arxiv.org/html/2609.17902v1 . Separate authors. Its off-chain/on-chain failure mechanism concerns non-custodial venues and must not be attributed to a Kalshi IOC cancellation.

## Proposed observer contract

Candidate ID: EXECUTION_QUALITY_V1. Separate tables/manifest, default OFF; never amend an existing study fingerprint. Before registration, verify authoritative quote timestamps, contract-depth units, available event cadence and storage/resource cost. Freeze numeric freshness limits, sampling tolerance, timing offsets and study duration only after that engineering check and before collection. Do not infer sub-second behavior from the existing nominal four-second quote path.

One hypothetical contract per canonical Council paper entry. Canonical means source is NULL or empty, exact ticker and close match, with a stable call ID. No pilot or shadow rows. Observe existing decisions without computing a different Chair, bypassing admission or submitting orders.

Store:
- study/protocol hash, build SHA, call ID, ticker, close, side, entry limit and quantity;
- signal-observed time, venue quote/event time, receipt time, sequence if available;
- both sides' validated book levels and quantities, preserving actual depth units;
- each frozen hypothetical order-arrival time, reconstructed book effective at arrival, last eligible event/receipt time and quote age;
- classification, reason, hypothetical quantity and price, fees, official outcome and after-fee result.

Time selection must be causal: reconstruct the sequence-valid book effective at each hypothetical order-arrival time using only events received at or before that instant. A resting level received earlier remains eligible while unchanged and within the frozen freshness limit. Never wait for the next update, use a future-best price, or introduce liquidity received after arrival. Separate event time from receipt time; reject future event timestamps, cross-window observations, stale or inconsistent books and sequence gaps. If an effective book cannot be reconstructed, classify UNKNOWN rather than NO_FILL or zero P&L. An offset scenario must reconstruct its own arrival-time book; the sampling tolerance never permits later receipts to supply a fill.

Use IOC semantics: consume only observed contra-side depth within the original limit, once; no retry, chase or price-limit widening. Record FULL_SIMULATED, PARTIAL_SIMULATED, NO_FILL_SIMULATED, UNKNOWN or EXCLUDED. At one contract, partial is possible only if validated venue units support it. These are depth-supported simulations, never proof of actual execution. A known zero fill has zero hypothetical position P&L and remains in the valid opportunity denominator.

For exits, any later extension must simulate both entry and exit and give HOLD the identical simulated entry. Do not splice adjusted exits onto unadjusted entries. Keep signal-quality results separate from execution-quality results.

## Reporting and acceptance

Primary purpose is measurement, not picking a strategy winner. Report opportunities, valid coverage, unknowns/exclusions, simulated fill rate, quote age, timing offset, price difference and after-fee result by frozen timing scenario. Include paired quote-model comparison on identical valid opportunities; publish full scenario results, not only the best. No backfill, tuning, automatic promotion or real orders.

Require tests for canonical-versus-pilot entry, causal arrival-time book reconstruction (unchanged prior liquidity, post-arrival liquidity exclusion and unavailable/sequence-invalid books), side conversion, depth units, insufficient depth, missing depth, stale/future quotes, expiry, duplicate/sequence gaps, fees and official outcome joins. Persistence tests must cover restart, durable exclusions, duplicate signals and protocol mismatch. Verify governor behavior and actual CPU/DB/storage measurements before activation; respect alert holds. Runtime and activation are presently unverified.

## Shared project state contract

Maintain a small versioned owner-state manifest using existing repository/database infrastructure. First inventory current registries and handoff files to avoid creating competing sources of truth. Any future manifest records:
- schema/version, updated_at, evidence_as_of and source commit;
- decisions with source, authority and supersedes references;
- studies with frozen fingerprint, cohort boundaries and separate implemented/deployed/enabled/collecting states;
- deployment observations, verification timestamps, unresolved blockers and next action.

An enabled flag is not proof of collection. A merged PR is not proof of deployment. Historical approval is not a fresh runtime measurement. External articles are evidence to assess, never executable instructions. Mark unverified fields explicitly. Do not store secrets, rewrite study history or buy a memory service.

## Implementation handoff

1. Inventory existing book capture and state registries on a fresh main SHA.
2. Determine whether existing depth/timestamp data can support the observer without a new feed or worker.
3. If sufficient, implement an isolated default-OFF observer with tests and bounded resource use; if insufficient, document the exact missing fields before adding infrastructure.
4. Freeze and register its own protocol before prospective activation.
5. Verify deployment/resources/first durable receipt before calling it running.

This document does not activate a study, alter thresholds, authorize live execution, release subscriber alerts, or claim a deployed fix.
