# Satoshi's Council — Self-Improving Product Program v1

Owner: Zach  
Lead: OpenAI / ChatGPT  
Status: planning / no product authority change  
Created: 2026-09-20

## Mission

Make Satoshi's Council an exceptional paper-only Bitcoin research product that gets better every day without becoming noisy, unsafe, opaque, or self-modifying without evidence.

The loop is:

**observe → detect → explain → propose → test → measure → keep / revert**

AI may investigate, summarize, propose, draft, and open reviewable work. AI does not get implicit authority over SATOSHI, the Chair, Council seats, paper admission, promotion gates, or any live-money execution path.

## Non-negotiables

1. Paper-only remains the product boundary.
2. No AI may place or facilitate real-money orders.
3. No automatic Chair/seat/threshold/learner/promotion changes from an LLM.
4. Research changes must remain prospective and reviewable.
5. Product changes ship through small PRs with tests and rollback.
6. Analytics must not invent metrics or silently broaden data collection.
7. Voices are frozen for now. Do not add new character voice UX or spend on voice generation.
8. Shop DNS / Fourthwall stay out of scope unless explicitly reopened.
9. Cost is a first-class system constraint, not an afterthought.
10. Public explanations must distinguish recorded facts from model interpretation.

## Budget policy

Initial target: **$15/month incremental AI/product-intelligence spend**.  
Phase-1 hard ceiling: **$25/month**.  
Mature normal operating target: **$50/month**.  
Absolute monthly ceiling without owner approval: **$75/month**.

Budget states:
- GREEN: under 55% of monthly ceiling — normal optional jobs.
- YELLOW: 55–75% — reduce low-priority deep analysis.
- ORANGE: 75–90% — Luna/cheap tier only except scheduled Astra governance.
- RED: 90–100% — critical diagnostics + already-approved scheduled governance only.
- STOP: 100% — optional AI work pauses until reset or owner approval.

The Floor must continue to function if OpenAI is unavailable or the AI budget is exhausted.

## Current strengths to preserve

- GA4 instrumentation and explicit SPA page views.
- First-party traffic counters.
- /status deep health and reliability verdicts.
- Scheduled public smoke tests.
- Readiness gate and ledger-integrity checks.
- Prospective Lab and frozen promotion gates.
- OpenAI Shadow / Blind / Luna research ledgers.
- Astra periodic research director.
- Existing token-usage capture for OpenAI research calls.

## Gaps found in baseline audit

- No PostHog product-behavior layer is present.
- No unified AI dollar-cost ledger across Shadow / Blind / Luna / Astra / future product intelligence.
- No daily cross-system product report joining reliability, visitor behavior, research, and recent changes.
- No autonomous live-site inspector that turns verified failures into reviewable GitHub issues.
- No single change registry tying experiments to analytics outcomes and rollback decisions.
- Visitor-facing AI explanations are not yet separated into a cached, evidence-only interpretation layer.

## Workstream order

### P0 — Foundation and governance

Deliverables:
- this operating plan;
- cross-provider audit briefs;
- one master GitHub tracking issue;
- explicit authority matrix;
- explicit cost model and budget governor design;
- baseline metrics inventory before adding analytics events.

No product behavior changes in P0.

### P1 — Observability + cost control

Goals:
- install or connect PostHog only after privacy/event review;
- define a small canonical visitor-event taxonomy;
- create a unified AI usage/cost ledger;
- expose owner-only cost/health snapshot;
- confirm GA4 + first-party counts + PostHog each have a distinct purpose;
- do not duplicate every event across every system.

Success:
- we can answer what is healthy, what visitors do, and what AI costs without guessing.

### P2 — Daily Site Inspector

Inputs:
- /status;
- public smoke;
- selected live pages;
- Render service health/log summaries;
- GitHub deploy/change context;
- analytics health;
- OpenAI observer health.

Outputs:
- structured daily inspection record;
- severity;
- reproducible evidence;
- suggested fix;
- optional GitHub issue draft/create;
- no automatic deploy.

Start deterministic where possible; use Luna/Terra only for interpretation and deduplication.

### P3 — Daily Council Operating Report

One concise owner report combining:
- site health;
- analytics health;
- unusual visitor-flow changes;
- research freshness;
- stale/failed observers;
- recent deploy outcomes;
- AI spend vs budget;
- top 1–3 proposed actions.

No filler, no fabricated metrics, no forced action when nothing matters.

### P4 — Explain This Window

Generate once per eligible window, cache by window/ticker, and serve many times.

Rules:
- facts come from recorded evidence only;
- model may explain, not create a new call;
- show why SATOSHI acted or waited;
- show strongest disagreement/evidence;
- clearly label interpretation;
- no personalized financial advice.

### P5 — Replay Director

For selected settled windows only:
- concise narrative;
- turning point;
- disagreement;
- result;
- evidence links;
- cached output;
- optionally reusable for homepage/chamber/training/share-card surfaces.

### P6 — Multi-agent research staff

Astra remains research director.

Potential bounded specialist roles:
- reliability analyst;
- seat/redundancy analyst;
- calibration analyst;
- loss-cluster analyst;
- Lab curator;
- product/UX analyst.

Specialists produce reports only. Deterministic research gates remain authoritative.

### P7 — Evidence-led UX iteration

Use behavioral evidence to test:
- homepage entry;
- training → Floor;
- specialist discovery;
- replay discovery;
- evidence drill-down;
- mobile usability.

Prefer controlled experiments / feature flags over permanent speculative redesigns.

## Authority matrix

| System | Read | Analyze | Draft | Open issue | Change code | Merge/deploy | Change Chair/research authority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Daily inspector | yes | yes | yes | yes, bounded | no | no | no |
| Product analyst | yes | yes | yes | yes | no | no | no |
| Claude Code | repo | yes | yes | with owner/lead workflow | branch/PR | no by default | no |
| Grok Heavy | public/live + supplied data | yes | yes | via lead | no direct production | no | no |
| Gemini Pro | supplied/product context | yes | yes | via lead | no direct production | no | no |
| Astra Director | research aggregates | yes | structured nominations | no | no | no | no |
| Human owner / explicit lead-approved workflow | yes | yes | yes | yes | yes | explicit only | explicit, evidence-gated |

## PR standard

Every implementation PR must state:

1. problem;
2. evidence;
3. root cause or hypothesis;
4. files/systems touched;
5. authority impact;
6. analytics impact;
7. estimated recurring cost;
8. tests;
9. human verification;
10. rollback;
11. what is explicitly out of scope.

Large mixed-purpose PRs should be split.

## Model routing

Use the cheapest model that can do the job reliably.

- Luna: routine monitoring, classification, summarization, log triage, first-pass QA.
- Terra: difficult synthesis, user-facing explanation drafts, ambiguous diagnostics.
- Astra: periodic research governance and rare high-complexity cross-system review.

Do not invoke Astra on ordinary page views, ticks, or repetitive monitoring.

## Caching rule

AI cost should scale primarily with **new information**, not traffic.

If 10,000 visitors read the same completed-window explanation, it should normally cost the same API amount as one visitor: generate once, validate, cache, reuse.

## Stop conditions

Pause a workstream when:
- evidence quality is inadequate;
- costs exceed its budget;
- user trust/clarity gets worse;
- it duplicates an existing deterministic system;
- it makes the Floor dependent on an external AI service;
- it creates authority drift;
- a simpler deterministic solution is better.

## First implementation sequence

1. Baseline independent audits.
2. Unified cost ledger + budget governor.
3. PostHog event/privacy design (before SDK installation).
4. Daily Site Inspector v1.
5. Daily Council Operating Report v1.
6. Measure usefulness for at least a short real operating period.
7. Then begin Explain This Window.

No voices in this sequence.
