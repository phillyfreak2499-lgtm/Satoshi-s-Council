# Satoshi’s Council — Operating Doctrine

**Version:** 2026-08-14 (One-Call / Best-Odds Protocol)

## Mission
Contribute to exactly **one** high-quality directional guess on how the current Kalshi 15-minute BTC window ends (BTC open → close: UP or DOWN), taken at the **best available odds**.

## Non-Negotiable Rules (GOAL CONTRACT)

1. **One call per window max.**  
   The Chair may lock only a single graded directional call per Kalshi ticker. Once locked, the call is irreversible for the remainder of the window. Revisions are disabled.

2. **Best-odds filter.**  
   A directional lock is permitted only when the YES mid / ask is inside **10–90¢**.  
   The 99¢ / 1¢ wall is a hard no. Do not shrink the band to 45–55.

3. **Quality over quantity.**  
   WAIT is always preferred over a low-edge, noisy, early, or late call. One excellent guess beats three mediocre ones.

4. **Post-lock behavior.**  
   After the Chair locks, every specialist switches to support/monitor mode. Directional votes are ignored or forced quiet. Debate noise drops so followers can read a clean signal.

5. **Shared goal.**  
   Every specialist and the Chair operate under the same GOAL CONTRACT. Reasoning strings and summaries must reflect it.

## Visual Hierarchy

- **Table (art mode):** Clean decision stage. No specialist seats on the ring. Center shows the large LOCKED plaque (direction, confidence, entry odds, timestamp, “FOLLOW THIS / IRREVERSIBLE”).
- **Floor:** Specialists remain fully visible (outer perimeter, floor color tally, hierarchy panel, debate log, Floor mode immersive view).
- Hierarchy, adaptive weights, ranking, and learning continue unchanged.

## Follower Interface

`/api/state` exposes a clear `locked_call` object:

```json
{
  "direction": "UP" | "DOWN" | null,
  "confidence": 0-100,
  "entry_odds": 61.5,
  "locked_at": "ISO timestamp",
  "ticker": "KXBTC15M-...",
  "irreversible": true,
  "phase": "entry"
}
```

Any external follower bot or human can read this single field without parsing the full debate.

## Metrics That Matter

Track on the Paper / Accuracy surfaces:

- % of windows that produce a lock (utilization)
- Average entry odds of locked calls (target well under 70–75¢)
- Hit-rate split by entry-odds bucket (<60 / 60–80)
- Cents of edge and path points captured
- Lifetime Chair accuracy on the single graded call only

## Why This Exists

15-minute BTC direction is efficient. Noise is expensive.  
This protocol turns the Council into a disciplined command center that fires only when edge and value exist, then stands behind that one call so followers can act with clarity.

Paper-track expectancy before any size.
