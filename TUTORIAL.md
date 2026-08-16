# Satoshi’s Council — New Operator Tutorial

**Version:** 2026-08-16 (Path P&L / Dual-Sided Scalp)

## What this is
A living Round Table of specialist bots watching Kalshi’s 15-minute Bitcoin market (KXBTC15M) and the Ethereum hourly table.  
Satoshi runs a **dual-sided 15m path book** — hold both, scale, cut, or flip — scored on realized paper P&L. Vitalik still locks **exactly one** high-quality ETH 1H paper call — UP or DOWN — only when the book is inside 10–90¢ (never 99¢ chalk). Otherwise WAIT.

This is a research co-pilot. It does **not** place real orders.

## GOAL CONTRACT (non-negotiable)
1. BTC 15m is path P&L — dual-sided scalp, not one irreversible directional lock.
2. Hold both Up and Down when combined cost is attractive. Scale / cut / flip either leg the full 15 minutes.
3. Score realized paper P&L, not a close-direction hit. Directional accuracy is secondary.
4. ETH 1H stays one finish guess at the best available odds (10–90¢). WAIT preferred over low-edge noise.

## How to read the screen
- **Center plaque** = live BTC 15m position (size Up, size Down, averages, next action) or the ETH one-lock (`LOCKED UP/DOWN @ XX¢`).
- **Floor** (outer ring) = specialists still voting and ranking.
- **HIT RATE** badge = Chair score. BTC 15m is path P&L (WAIT excluded). ETH is directional accuracy (WAIT excluded).
- **LAW** badge = enforcer status after repeated misses.

## How a call is made
1. Specialists vote UP / DOWN / WAIT.
2. Higher-ranked bots count more.
3. Chair requires confluence + pair affinity — pointed at leftover and scalp quality, not a single door.
4. Odds gate: BTC 15m 20–80 after vig. ETH 1H 10–90¢. Never play 99¢ chalk.
5. BTC 15m stays active the full window. ETH’s first firm full UP/DOWN that clears the gates becomes the single LOCKED call.
6. After an ETH lock, the plaque is what the UI follows. BTC 15m plaque is the live book.

## Scoring
BTC 15m grades **realized paper P&L** on the path book. Official settle only marks leftover legs.  
ETH 1H still grades the single locked call. Paper P&L is path-scaled.

## Tabs
Table · Floor · Dashboard · Bots · Ranks · Paper · Front · Charts · Settings  

**Keys:** 1–7 tabs · Floor tab · X BEAST · ESC exit Floor · **?** Help (replay this tutorial)

## Raijin / THE FRONT
Raijin is the weather Chair. THE FRONT is his Floor — a real ring table, not a city list.

- **Dallas daily high only.** Series `KXHIGHTDAL`. Settle **DFW / KDFW**, not Love Field. Date lives in the ticker.
- **Seats:** **GLASS** (NWS PANE) · **PIT** (THE PIT) · **FROST** (FROST KILL) · **BONE** (BONE CLIMO) · **MESH** (THE WEB).
- **Subs** (feed a chair, do not vote): **HEAT** (NOW VS THE HIGH) · **ECHO** (YDAY BONES) · **CELL** (STORM CAP).
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
  "direction": "BOTH",
  "action": "LONG_UP",
  "irreversible": false,
  "path_book": true,
  "ticker": "KXBTC15M-...",
  "goal": "GOAL · path P&L · dual-sided scalp (20–80¢)",
  "position": {
    "size_up": 10,
    "size_down": 10,
    "avg_up": 42,
    "avg_down": 42
  }
}
```

ETH 1H `locked_call` is still one door, `irreversible: true`, goal `GOAL · 1 window-end guess @ best odds (10–90¢)`.

When `locked_call` is `null`, there is no active call — stay flat or WAIT.

Follower stays OFF. Live stays OFF.

## Philosophy
Paper-track expectancy before any size.  
BTC 15m: stay in the book and take leftover on both doors.  
ETH 1H: quality over quantity. One high-edge guess per window.
