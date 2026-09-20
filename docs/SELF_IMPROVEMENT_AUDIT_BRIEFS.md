# Independent Audit Briefs — Self-Improving Council v1

These audits are intentionally independent. Do not let one model's conclusion anchor the others.

## Claude Code — repository architecture and failure-mode audit

You are the senior repository engineer auditing Satoshi's Council before a new self-improvement platform is added.

Repository: phillyfreak2499-lgtm/Satoshi-s-Council

FIRST PASS IS READ-ONLY. Do not edit code, create branches, open PRs, alter production, or change Chair/seat/research logic.

Goal: identify the cleanest architecture for:
1. a unified AI usage/cost ledger across existing OpenAI Shadow, Blind, Luna, Astra and future AI product jobs;
2. a hard monthly budget governor that cannot break the Floor;
3. a daily site inspector using existing /status, public smoke, reliability, Render/GitHub context and analytics health;
4. a daily owner report;
5. later cached Explain This Window and Replay Director outputs.

Audit specifically:
- existing OpenAI call sites, usage persistence, retry logic and failure behavior;
- health/status/readiness/public-smoke systems that should be reused;
- current DB patterns and migrations;
- scheduling / long-running-process assumptions on Render;
- race conditions and duplicate-job risks;
- where a generic AI-job abstraction would help vs over-engineer;
- privacy/security risks;
- test strategy;
- cheapest incremental path.

Hard rules:
- paper-only;
- no live execution;
- no automatic Chair/seat/learner/promotion authority;
- voices are out of scope;
- no shop/Fourthwall changes;
- no new code in this pass.

Return:
A. architecture map;
B. gaps;
C. proposed schema/API boundaries;
D. failure modes;
E. recommended PR sequence, each small and independently testable;
F. what NOT to build;
G. any disagreements with the proposed program and why.

## Grok Heavy — adversarial live-product / UX / reliability audit

Act as an adversarial product reviewer and live-site QA lead.

Target: https://satoshiscouncil.com

READ-ONLY. Do not submit forms, make paper calls, moderate content, change settings, or perform any persistent action.

Goal: find the highest-value problems a daily autonomous inspector should detect.

Inspect major public surfaces on desktop and mobile:
- home;
- desk / Floor;
- books/results;
- record;
- arena;
- board;
- lab;
- chamber;
- training + WICK/TAPE/DRIFT;
- about;
- FAQ;
- several seat pages;
- several recent replay/window pages;
- /status if public.

Look for:
- broken/stale/missing data;
- contradictory copy;
- data/UI mismatches;
- dead or confusing actions;
- loading/error-state quality;
- mobile overflow/touch issues;
- information overload;
- hierarchy/conversion problems;
- inaccessible interactions;
- repeated friction;
- anything that makes the product feel less trustworthy.

Do not score for style alone. Separate:
1. correctness/reliability;
2. comprehension;
3. conversion/discovery;
4. visual polish.

Return:
A. top 10 issues ranked by impact;
B. evidence/URL for each;
C. which can be detected deterministically;
D. which need browser vision/LLM judgment;
E. suggested inspector checks;
F. 5 things that are already strong and should not be redesigned.

## Gemini Pro — product systems / information architecture audit

You are a product systems designer reviewing Satoshi's Council before adding AI-driven self-improvement.

Do not propose a wholesale redesign.

Goal: make the product easier to understand and revisit while preserving its research-desk identity.

Using the live site and supplied product description, analyze:
- first-visit mental model;
- navigation / room architecture;
- Floor comprehension;
- path from homepage → specialist/training → Floor → replay/results;
- Lab comprehension for non-technical visitors;
- replay/content discoverability;
- mobile hierarchy;
- trust signals;
- opportunities for contextual AI explanation without adding a generic chatbot.

Return:
A. user journey map;
B. comprehension bottlenecks;
C. 5 highest-leverage UX changes;
D. measurement plan for each;
E. components/design-system gaps;
F. what should stay visually restrained;
G. what should never be delegated to generative AI.

Constraints:
- paper-only;
- no voices;
- no generic prediction chatbot;
- no new prediction bots;
- no automatic research authority;
- evidence-led experimentation over redesign-by-opinion.
