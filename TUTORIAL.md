# Satoshi’s Council — New Operator Tutorial

**Version:** 2026-08-14 (One-Call / Best-Odds Protocol)

## What this is
A living Round Table of specialist bots watching Kalshi’s 15-minute Bitcoin market (KXBTC15M).  
The Chair (Satoshi) locks **exactly one** high-quality paper call per window — UP or DOWN — only when the chosen side offers best odds (under 80¢). Otherwise WAIT.

This is a research co-pilot. It does **not** place real orders.

## GOAL CONTRACT (non-negotiable)
1. One directional guess per 15-minute window on how the window ends.
2. Taken only at the best available odds (chosen side < 80¢).
3. Once locked → irreversible for that window.
4. WAIT preferred over low-edge or noisy calls.

## How to read the screen
- **Center plaque** = the single source of truth when locked (`LOCKED UP/DOWN @ XX¢ · FOLLOW THIS`).
- **Floor** (outer ring) = specialists still voting and ranking.
- **HIT RATE** badge = Chair directional accuracy (WAIT excluded).
- **LAW** badge = enforcer status after repeated misses.

## How a call is made
1. Specialists vote UP / DOWN / WAIT.
2. Higher-ranked bots count more.
3. Chair requires confluence + pair affinity.
4. Odds gate: chosen side must be under 80¢.
5. First firm full UP/DOWN that clears the gates becomes the single LOCKED call.
6. After lock, the plaque is what followers and the UI follow.

## Scoring
Calls are graded on **Kalshi odds path**, not only the final BTC print.  
Paper P&L is path-scaled. Only the single locked call per window is graded.

## Tabs
Table · Floor · Dashboard · Bots · Ranks · Paper · Charts · Settings  

**Keys:** 1–7 tabs · Floor tab · X BEAST · ESC exit Floor · **?** Help (replay this tutorial)

## Follower bots
Poll `/api/state` and read `locked_call` (or `decision.locked_call`):

```json
{
  "locked": true,
  "direction": "UP",
  "confidence": 67,
  "entry_odds_pct": 61,
  "irreversible": true,
  "ticker": "KXBTC15M-...",
  "goal": "GOAL · 1 window-end guess @ best odds (<80%)"
}
```

When `locked_call` is `null`, there is no active call — stay flat or WAIT.

## Philosophy
Paper-track expectancy before any size.  
Quality over quantity. One high-edge guess per window.
