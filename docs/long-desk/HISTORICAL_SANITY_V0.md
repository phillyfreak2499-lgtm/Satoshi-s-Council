# Long Desk v0 historical sanity check

**Run date:** 2026-09-19  
**Purpose:** read-only behavior check; not threshold selection, optimization, or evidence of predictive value  
**Receipt:** `DATA_RECEIPT_V0.md`

## Population

- Daily BTC-USD rows: 749
- Source span: 2024-09-01 through 2026-09-19
- Weekly reviews tested: **55**
- Review Mondays: 2025-09-01 through 2026-09-14
- Starting state: STAND
- Frozen transition rule:
  - STAND → HOLD after two consecutive 3/3 reviews
  - HOLD retained at 2/3 or 3/3
  - HOLD → STAND at 0/3 or 1/3

## Read-only answers

### How often would the stance have flipped?

**5 state changes across 55 weekly reviews.**

- STAND → HOLD: 3 times
- HOLD → STAND: 2 times

### Does HOLD last weeks / months or bounce?

In this sample it **bounces more than intended**:

- first HOLD run: 1 week
- second HOLD run: 1 week
- third HOLD run: 3 weeks through the end of the tested period

No HOLD run lasted a month.

### Does STAND dominate forever?

It does not literally dominate forever, but it dominates heavily:

- STAND: **50 / 55 weeks (90.9%)**
- HOLD: **5 / 55 weeks (9.1%)**

Longest STAND run: **31 weeks**.

### Any nonsense periods?

Two obvious brittle periods:

1. 2025-10-06 promoted to HOLD after the required confirmation, then returned to STAND one week later.
2. 2026-05-18 promoted to HOLD with the 30-day check only barely positive at about +0.4%, then returned to STAND one week later.

Those are behavior observations, not permission to change the thresholds.

## Check-count distribution

- 0/3: 23 weeks
- 1/3: 8 weeks
- 2/3: 16 weeks
- 3/3: 8 weeks

## State runs

| State | Start review | End review | Length |
|---|---|---|---:|
| STAND | 2025-09-01 | 2025-09-29 | 5 weeks |
| HOLD | 2025-10-06 | 2025-10-06 | 1 week |
| STAND | 2025-10-13 | 2026-05-11 | 31 weeks |
| HOLD | 2026-05-18 | 2026-05-18 | 1 week |
| STAND | 2026-05-25 | 2026-08-24 | 14 weeks |
| HOLD | 2026-08-31 | 2026-09-14 | 3 weeks |

## Interpretation

This sanity check exposes a weakness: v0 is STAND-heavy and produced two one-week HOLD runs.

That does **not** reopen v0.

Brief #001 already exists, so the 30d / 90d / drawdown-healing checks and state logic remain frozen for Briefs #001–#004.

The history check is diagnostic only. It cannot be used to retune the rule on this sample.

## Forbidden conclusions from this check

Do not use this history to:

- choose prettier return thresholds,
- change confirmation count,
- change HOLD exit logic,
- optimize drawdown-healing magnitude,
- add new indicators until the historical occupancy looks nicer,
- claim HOLD or STAND predicts returns.

The only current question is whether four frozen-rule Briefs are useful, clear, repeatable, and worth returning to without a buy link.
