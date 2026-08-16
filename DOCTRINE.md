# Satoshi’s Council — Operating Doctrine

**Version:** 2026-08-16 (Path P&L / Dual-Sided Scalp)

The One-Call / Best-Odds Protocol is **dead for BTC 15m**. ETH 1H keeps it.

## Mission

**BTC 15m:** scalp both Up and Down contracts inside the window. Realized path P&L is the scoreboard. Directional accuracy — did the official settle match a single door — is secondary.

**ETH 1H:** still exactly one high-quality finish guess at the best available odds (10–90¢). One irreversible lock. Not dual-sided.

## BTC 15m — Non-Negotiable Rules

1. **Path P&L is primary.**  
   The real grade is realized paper P&L on the path book. A window that made money is a win even if the official settle disagrees with the first lean. Final-direction hit-rate is a footnote.

2. **Dual-sided scalp is the edge.**  
   Hold both Up and Down when combined cost is attractive. Holding both sides at once is expected and normal. It is not a bug, a hedge apology, or a broken lock.

3. **Both legs only when leftover is real.**  
   Open the second door only when UP ask + DOWN ask leaves room after vig. Never invent a pair from mid.

4. **The Chair stays active the full 15 minutes.**  
   There is no irreversible one-call lock. The Chair may scale in, scale out, reduce, or flip either leg independently for the whole window.

5. **Paper fill at the real ask, not mid.**  
   Missing NO ask may be 100 − yes bid. Missing YES ask may be 100 − no bid. Mid is display only.

6. **Dead 99¢ book = sit.**  
   You cannot scale out of chalk. 1¢ / 99¢ is a hard no.

7. **Quality filters stay — pointed at scalping.**  
   Sit the first ~2 minutes and the last ~2.5 unless EV is still ≥ 0. Playable band 10–90 after vig. Explore paper locks when EV ≥ 0 on a real book. 99¢ / stale / empty still sit. WAIT is a skip, not a miss.

8. **Retrain on old 15-minute books only.**  
   Do not port 1H weights, 1H settle keys, or CoinGlass 1h onto this book.

## ETH 1H — One-Lock (unchanged)

1. One graded directional call per hourly ticker.
2. Once locked, irreversible for that window.
3. Book must be inside 10–90¢. Never 99¢ chalk.
4. WAIT preferred over a low-edge, noisy, early, or late call.

## Chair management directions (BTC 15m)

Specialists recommend `LONG_UP` / `LONG_DOWN` / `REDUCE_*` / `FLAT_*` — path/scalp edge, not a finish call. They keep gathering the full 15 minutes. A Chair book does not silence them.

The Chair emits management actions:

`LONG_UP` · `LONG_DOWN` · `REDUCE_UP` · `REDUCE_DOWN` · `FLAT_UP` · `FLAT_DOWN` · `FLAT_ALL` · `SWAP` · `WAIT`

`BOTH` is the live display when both doors are open. `UP_HOLD` / `DOWN_HOLD` stay as legacy UI aliases.

`/api/state` `locked_call` on a 15m book is **not** “FOLLOW THIS / IRREVERSIBLE”. It is live position state: size Up, size Down, average prices, unrealized edge, next action, last sizing. `irreversible` is false. ETH `locked_call` stays one-lock.

## Sizing

BTC 15m Chair and paper-journal fills use `size_for_leader()` / `compute_position_size()`. Inputs are real edge, P(finish), confidence, confluence, ask, spread, book size, seconds left, and open risk. `open_risk` counts **both legs**. Hard maxes beat Kelly — Kelly is informational only and never raises size past `DYNAMIC_SIZING_MAX` / `PAPER_STAKE_DEFAULT`. Scalp clips and dual-sided pairs size smaller. Each paper fill stores the sizing audit (reasons + multipliers). ETH stays a flat paper ticket. Do NOT wire Follower.

## Visual Hierarchy

- **Table (art mode):** Clean decision stage. BTC 15m plaque shows the live dual-sided book (sizes, averages, next action). ETH plaque still reads as a single LOCKED call.
- **Floor:** Specialists remain fully visible. Dual-sided gold (`BOTH`) is a valid Chair color, not an error.
- Hierarchy, adaptive weights, ranking, and learning continue. 15m learning grades path P&L, not finish match.

## Follower Interface

Follower stays **OFF**. Live stays **OFF**. Paper only. No new Floor chairs.

`/api/state` still exposes `locked_call`. On BTC 15m it carries `path_book`, `position`, `sizing`, and `irreversible: false`. On ETH 1H it stays a single irreversible door.

## Metrics That Matter

Track on the Paper / Accuracy surfaces:

- Realized path P&L per 15m window (the scoreboard)
- Dual-sided utilization (windows that held both doors)
- Scale / cut / flip counts
- Average leftover after vig on dual opens
- Sit rate on chalk / dead / first-3m / last-2.5m
- ETH 1H hit-rate on the single graded call (unchanged)

## Why This Exists

15-minute BTC direction is efficient. A single irreversible guess donates the path.  
The Council stays in the book for the full 15 minutes and takes leftover on both doors when the pair is cheap.

Paper-track expectancy before any size.
