# TAKE90 V2: profit-taking research

TAKE90_V1 sells on a 90-cent held-side bid even when the original fill was more expensive. It can therefore realize a loss under a rule described as taking profit.

TAKE90_V2 is a separate frozen experiment. It sells at the first usable held-side bid of at least 90 cents whose recorded net is strictly positive after both modelled fees. Otherwise it holds to official settlement. It can still lose the full position; it is not a stop-loss or a guaranteed loss cap.

- Frozen at 2026-09-14T16:44:11.000Z.
- Parameters: take_cents=90, min_net_cents=0, with strict greater-than for net.
- Same entry, side, timestamp and fee model as HOLD and the existing exit experiments.
- The writer includes a candidate only for an entry at or after its frozen date. An older recovered fill cannot seed this version.
- Existing TAKE90_V1, HOLD, the Chair, 80-cent entry policy, active Floor composition and promotion thresholds remain intact.
- No historical observations are backfilled or counted toward V2. The Lab discovers the added candidate from the registry and starts at zero.

## Evidence motivating the trial

Read-only production review through the September 14, 2026 16:30 UTC close found 35 paired HOLD/TAKE90_V1 observations. HOLD earned +270 cents with two losses and a worst result of -84 cents. TAKE90_V1 earned +152 cents with six losses and a worst result of -5 cents. Both large HOLD losses had first traded at a bid that the TAKE90 comparator could sell into for +6 cents.

Nine replay records were flagged partial. On the remaining 26, HOLD earned +179 cents and TAKE90_V1 +127 cents. The study contains only two losing HOLD positions. It establishes a useful hypothesis, not promotion eligibility.

An exploratory 20-cent net-loss trigger on those same 35 replays earned +127 cents, sold seven eventual winners at a loss, and had a -102-cent cumulative drawdown versus HOLD's -84 cents. The combined 90-cent target and 20-cent stop earned +5 cents. Neither stop rule is added here; no parameter search was performed.

The new version addresses the target-sale loss directly. It does not claim that waiting for a positive sale is always preferable: a position may never reach that price and can settle at a full loss.

## Verification

Behavioral tests cover high entries, strict net-profit and rounding boundaries, UP and DOWN sellable bids, pre-entry and unusable quotes, full-loss fallback, unchanged V1 results, frozen parameters, and entry-time eligibility. The actual writer is exercised with database transport substituted to verify version separation, the shared fill, idempotency and no evidence for a sit-out.
