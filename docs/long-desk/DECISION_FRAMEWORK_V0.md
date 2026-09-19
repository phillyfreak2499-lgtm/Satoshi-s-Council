# Long Desk decision framework v0

**Status:** product-research rule, not a validated forecasting model and not public advice  
**Purpose:** make the Long Desk repeatable enough to write four honest Briefs without borrowing the Floor

## 1. What the stance means

The stance is a **house research state**, not a personal order.

- **HOLD** = the slow evidence is jointly constructive enough that the Long Desk's ownership thesis is intact. It does **not** mean a non-owner should buy now.
- **STAND** = the slow evidence is mixed, newly improving but unconfirmed, deteriorating, or incomplete. The house is not asserting a change in ownership behavior.

If legal/product review later finds HOLD too action-coded, rename the public noun. Do not change the underlying rule to preserve a label.

**ADD is not part of v0.** It stays behind legal review and separate product proof.

## 2. The review clock

The Long Desk reviews once per week from a fixed snapshot:

**Monday 00:00 UTC** (the completed UTC week).

No stance may change because of a 15-minute window, an intraday move, or a midweek headline.

The optional daily status is not a new decision. It may say only:

- **STANCE UNCHANGED · next review Monday**
- **REVIEW TRIGGERED · stance unchanged pending weekly review**

That prevents the daily chip from becoming a spot signal feed.

## 3. Decisive inputs for v0

V0 deliberately starts small. Three slow checks decide the state.

### A. 30-day structure
Positive when the completed 30-day spot return is above 0%.

### B. 90-day structure
Positive when the completed 90-day spot return is above 0%.

### C. drawdown healing
Positive when drawdown from the trailing-365-day high is **less severe than it was four weeks earlier**.

Example:
- four weeks ago: -43%
- current: -34%
- result: healing

No magnitude threshold is used in v0. Direction matters; the Brief can still describe depth.

## 4. Context inputs — visible, not decisive yet

These may be discussed but cannot change the stance until a rule is written before outcomes are seen:

- 7-day return
- current drawdown depth
- weekly realized volatility
- daily Fear & Greed
- funding, basis and open interest **only after** they are aggregated onto a genuine long clock
- macro / scheduled-event context

The existing Floor's short-window funding/OI reads are not Long Desk inputs merely because they come from the same source.

## 5. Prohibited inputs

A Long Desk stance must not read:

- Chair UP / DOWN / WAIT
- live seat votes or seat confidence
- Kalshi strike or countdown
- current Kalshi order book
- one-window result or Floor P&L
- Floor win rate / "Council accuracy"
- current-window fair value
- a 15-minute derivative delta

The same raw public feed may be reused only after the Long Desk creates its own slow aggregation.

## 6. State rule

At each weekly review, record the three decisive checks as positive or not positive.

### STAND → HOLD

Require **3 of 3 positive checks at two consecutive weekly reviews**.

Why two reviews: one strong week should not turn the Long Desk into a momentum alert.

### HOLD stays HOLD

HOLD remains while **at least 2 of 3** decisive checks are positive.

If exactly 2 of 3 remain positive, the Brief must name the failing check.

### HOLD → STAND

Move to STAND when **1 or 0 of 3** decisive checks are positive at a scheduled weekly review.

Also move to STAND if any decisive input is missing, stale, or cannot be reproduced.

### STAND stays STAND

Anything short of the two-review 3-of-3 confirmation remains STAND.

No price target is required. The state-change condition is the invalidation.

## 7. Why the rule is asymmetric

HOLD takes more evidence to earn than it takes to retain.

That is intentional. The Long Desk should be slow to make a constructive ownership assertion and should not flip states because one monthly measurement barely crosses zero.

This is hysteresis, not a claim that the thresholds predict returns.

## 8. Brief receipt

Every Brief prints:

- 30d structure: + / -
- 90d structure: + / -
- 4-week drawdown healing: + / -
- prior week's check count
- current check count
- current stance + since date
- exact rule required to change stance
- inputs explicitly excluded from the Floor

No combined percentage or confidence score.

## 9. Brief #001 classification

Using the 2026-09-19 research snapshot:

- 30d return: about **+17.2%** → positive
- 90d return: about **+27.1%** → positive
- trailing-year drawdown: improved from about **-43.4% four weeks earlier** to about **-33.6%** → healing

Current check count: **3 / 3**.

But this is the first recorded Long Desk review under the rule.

Therefore:

**STAND — 3/3 constructive, awaiting a second consecutive weekly confirmation.**

That is a better reason than inventing a one-off support level after seeing today's chart.

## 10. What v0 does not claim

- It is not validated against future Bitcoin returns.
- It does not say HOLD will outperform STAND.
- It does not optimize thresholds on history.
- It does not use the Floor as a hidden feature.
- It does not recommend a position size.
- It does not create ADD.
- It exists to test whether a repeatable, understandable Long Desk Brief is useful enough to deserve a product.

The four-Brief experiment comes before automation, optimization or public UI.
