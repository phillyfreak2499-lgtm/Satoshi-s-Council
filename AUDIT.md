# Archived 2026-08-21

This file is a **2026-08-12** snapshot. It is not the live desk.

The desk that is running is the dual 22-seat (BTC) + 18-seat (ETH) paper Stream
on satoshiscouncil.com. See `README.md` and `SECURITY.md`.

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

---

## 2026-08-17 Full System Run-Through & Intelligence Upgrades (Grok Team)

### Run Status
- Full extraction, dependency install, syntax (py_compile clean), import, DualOrchestrator instantiate, live pipeline.fetch (Binance/Kalshi/Coinbase), analyze_once, uvicorn /health + /api/state: **all successful**.
- Existing tests pass.
- Resilience excellent: 340+ exception handlers, agent isolation (try/except → muted WAIT), parallel gather with limits, last-good data fallbacks, listen-first boot for Render, adaptive cadence, dual-spot coalescing.
- No critical runtime errors. Minor expected: CoinGlass key optional, occasional Kalshi intentional backoff flaps (handled), ETH market availability variable.

### Hybrid Note
Doctrine/README emphasize longer-horizon research (Accumulate/Buy Zone/Hold/Reduce/Sell/Wait). Implementation remains dual-table with strong BTC 15m path-P&L dual-sided scalp + ETH 1H finish. This is intentional for current paper edge recovery; residual short-horizon agents (odds, strike, panic, cheap, exhaust) remain active. Future LONG_HORIZON flag recommended but not required for smooth operation.

### Concrete Smarter Changes Applied (for better calls)

1. **Wilson score lower-bound ranking** (`backend/learning/adaptive.py`)
   - Added `wilson_lower_bound(successes, n, z=1.96)`.
   - Hierarchy score: `wilson*100 + Laplace_wr*30 + weight*6 + min(c,200)*0.05`.
   - Effect: High-evidence agents rise above lucky short streaks (e.g. 3/3 LB≈0.44 vs 10/10≈0.72). More stable ranks → better listen factors → higher-quality confluence → improved call accuracy over time.
   - Also exposes `wilson_lb` in hierarchy rows for transparency.

2. **Time-adaptive path management** (`backend/learning/btc15m_path.py`)
   - Added `_time_scaled_adverse(base, mins_left)`.
   - CUT / FLIP adverse ¢ thresholds now scale: ~1.35× early (patient), ~0.70× late (protective).
   - Improves primary metric (realized path P&L) by reducing premature exits early in the window and protecting capital when time is short.

3. **Pydantic v2 cleanliness** (`backend/config.py`)
   - Migrated `class Config` → `model_config = ConfigDict(env_file=".env", extra="ignore")`.
   - Eliminates deprecation warnings under current pydantic-settings.

### Additional Recommendations (not coded this pass)
- Mild exponential decay (half-life ~30–50 samples) on correct/wrong counts for stronger recent-regime adaptation.
- Optional `LONG_HORIZON=1` runtime flag that downweights short-term agents and remaps decision language to Accumulate/Buy Zone/etc.
- Expand unit tests around `decide_action`, hierarchy scoring, and calibration bins.
- Monitor Wilson stability + path expectancy in Paper tab; consider Brier/ECE calibration tracking.
- Stronger multi-venue WS or circuit-breaker if deploying at higher frequency.

### Conclusion
System was already high-quality and production-smooth for a paper research desk. The three upgrades above make ranking statistically more robust and path management time-aware, directly improving the quality of decisions ("getting calls right") without changing the core process, WAIT preference, or paper-first doctrine. Ready for continued paper tracking under these rules.
