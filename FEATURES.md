# Path P&L / Dual-Sided Scalp (2026-08-16)

BTC 15m killed the One-Call / Best-Odds Protocol. ETH 1H kept it.

Implemented:
- BTC 15m: no MAX_CALLS_PER_WINDOW lock, no irreversible one-call. Chair manages both doors the full 15 minutes.
- Direction set: LONG_UP / LONG_DOWN / REDUCE_* / FLAT_* / SWAP / BOTH (UP_HOLD / DOWN_HOLD stay as UI aliases)
- GOAL_CONTRACT in base.py is path P&L + dual-sided scalp. ETH_GOAL_CONTRACT_SHORT is the old 1H one-lock line.
- DYNAMIC_SIZING + backend/risk/sizing.py — Chair / paper journal use size_for_leader(); config hard maxes clamp
- locked_call on /api/state shows live dual-sided position (size, averages, unrealized, next action). irreversible=false on 15m
- ETH 1H: MAX_CALLS_PER_WINDOW = 1, irreversible, 10–90¢, never 99¢ chalk
- Paper only. Follower OFF. Live OFF. No new Floor chairs.

See DOCTRINE.md for the full operating rules.

---

# Deep chat-vs-code audit (2026-08-12)

## Critical bug fixed earlier
- JS syntax error `animId = if (...)` killed the entire UI (blank table, stacked panels).
- `.info-view.hidden` CSS missing → panels never truly hid.
- Both fixed in satoshi-council-FIXED / this build.

## Requested features — status

| Request | Status | Where |
|---------|--------|--------|
| Sub-council micro-bots | **Done** | `agents/subs.py`, wired in council |
| UP / DOWN / WAIT / SWAP (not SELL) | **Done** | leader + UI labels |
| 1/4 UP HOLD / DOWN HOLD | **Done** | leader + path grading |
| Live Kalshi UP% / DOWN% | **Done** | footer `#liveUpPct` / `#liveDownPct` |
| Live 15m timer | **Done** | footer `#windowTimer` |
| Call noise UP/DOWN/SWAP + mute | **Done** | `playCallVoice` + Settings / Bell mute |
| Settings tab customize | **Partial→Improved** | BEAST + call SFX + team loops |
| Bracket funnel (not round only) | **Done** | `drawArt` tiers by rank |
| Rank # above bot names | **Done** | canvas rank badge |
| Hierarchy side list | **Done** | right panel |
| Debate log on left | **Done** | left panel |
| Lifetime hit % log | **Done** | left + badge + Paper |
| Path grading (Kalshi pts, 90% rule) | **Done** | `storage/db.py` |
| Path-scaled paper P&L | **Done** | db + Paper tab |
| LAW lockdown after 2 wrong | **Done** | `agents/law.py` |
| Adaptive weights over time | **Done** | `learning/adaptive.py` |
| Regime-split weights | **Done** | adaptive + regime_keys |
| Pair / coalition affinity | **Done** | leader + learning |
| Team loops on table | **Done** | gold/purple loops from top_pairs |
| QUORUM size/combo bot | **Done** | `agents/quorum.py` |
| CLOCK / session bot | **Done** | `session_tod.py` |
| WHALE bot | **Done** | `whale.py` |
| FADE / CHEAP / VEL / EXHAUST | **Done** | panic, cheap, spotlag, exhaust |
| Nightly 3–4 AM CT huddle | **Done** | `services/huddle.py` |
| Floor color tally | **Done** | bottom-left |
| BEAST MODE system setting | **Done** | runtime_settings + badge |
| Dual spot Binance+Coinbase | **Done** | pipeline when BEAST |
| Parallel agents | **Done** | asyncio.gather |
| Tutorial + Summon | **Done** | gate + videos |
| Purple volumetric fog | **Done** | fog canvas |
| Council summon video | **Done** | `/summon-council.mp4` |
| ZT logo click + 5-streak video | **Done** | `/zt-celebrate.mp4` |
| Bots / Ranks / Paper / Charts tabs | **Done** | mode tabs |
| Cool callsigns | **Done** | `roster.py` |
| News / sentiment bot | **Done (this pass)** | `agents/news.py` (Fear&Greed) WIRE |
| Liquidation cluster bot | **Done (this pass)** | `agents/liq.py` CASCADE |
| Full look/theme customizer | **Partial** | BEAST chrome only, not full skin packs |
| Real news headline NLP | **Not done** | F&G proxy only |
| Binance WS / Kalshi WS | **Not done** | REST + dual spot |
| Background candle always-on | **Removed by request** | Charts tab only |

## Bots currently registered
candle, volume, momentum, orderflow, funding, regime, volatility, oi_pressure, streak, odds, strike, session_tod, whale, quorum, panic, cheap, spotlag, exhaust, **news**, **liq**, guardian, law

## Deploy notes
1. Use this zip’s `frontend/static/` (JS must parse — verified).
2. Keep `summon-council.mp4` and `zt-celebrate.mp4` in `frontend/static/`.
3. Hard refresh after deploy.
4. If blank again: F12 console — should be no SyntaxError.
