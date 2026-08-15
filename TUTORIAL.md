# Satoshi’s Council — New Operator Tutorial

**Version:** 2026-08-15 (Ares / ATS)

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
Table · Floor · Dashboard · Bots · Ranks · Paper · Front · Charts · Settings  

**Keys:** 1–7 tabs · Floor tab · X BEAST · ESC exit Floor · **?** Help (replay this tutorial)

## Raijin / THE FRONT
Raijin is the weather Chair. THE FRONT is his Floor — a real ring table, not a city list.

- **Dallas daily high only.** Series `KXHIGHTDAL`. Settle **DFW / KDFW**, not Love Field. Date lives in the ticker.
- **Seats:** **GLASS** (official / NWS high) · **PIT** (Kalshi vs that number) · **FROST** (veto junk / SICK / thin book) · **BONE** (this city’s history / climo).
- Hits count like BTC / ETH. Pending until NWS CLI posts the next morning.
- Paper first. Live stays off until you arm this tab. Does not place 1H Chair locks. Never talks to Follower.
- Equal chair on the shared Floor (Satoshi · Vitalik · Raijin · Ares). Full-size ring on the Front tab.

## Ares / ATS
Ares is the sports Chair. One game. Gold tab **ATS**. Calls are COVER / NO-COVER, the team name, or OVER / UNDER. WAIT stays WAIT. Seats: LINE · STEAM · FADE · HURT · ICE. CLOCK / FORM / WX are subs. Paper only. Follower off.

Do not look for other cities on this board. v1 is Dallas only.

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
