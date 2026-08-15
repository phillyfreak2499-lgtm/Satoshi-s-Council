# One-Call / Best-Odds Protocol (2026-08-14)

Implemented:
- MAX_CALLS_PER_WINDOW = 1 (hard, irreversible)
- MAX_ENTRY_ODDS_PCT = 90.0 — paper lock band is 10–90¢ (never 99¢ chalk)
- GOAL_CONTRACT in base.py + leader summaries + DOCTRINE.md
- locked_call object on decision /api/state for follower bots
- UI: specialist bots moved to outer FLOOR ring; table reserved for Chair + LOCKED plaque with “FOLLOW” label
- Clear visual lock plate under Chair portrait

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
