# Beast Mode — max power / live-ness

## What this build does
- **~1.0–1.5s analysis cycles** when the book is hot; ~3s when flat WAIT
- **All specialists in parallel** (`asyncio.gather`) — every research seat kept
- **Dual spot**: Binance futures + Coinbase BTC-USD mid consensus
- **Funding/OI TTL 20s** (was 45s)
- **90× 1m candles** for exhaust/vel history
- **UI poll 800ms**; canvas soft-pauses only when the browser tab is hidden

Nothing helpful was cut. Style stays; only idle-tab paint is throttled.

## Hardware / hosting (recommended)

| Setup | Why |
|-------|-----|
| **Always-on VPS, US East/Central** (e.g. NYC / Chicago / Dallas) | Lowest latency to Binance + Kalshi + Coinbase. Better than a laptop that sleeps. |
| **4+ vCPU, 8 GB RAM** | Parallel agents + httpx + SQLite are light; headroom matters under load. |
| **Stable wired or good Wi-Fi** | Cycle time is dominated by network RTTs, not CPU. |
| **Not free-tier shared hosts if you can avoid them** | Noisy neighbors + cold starts hurt “as live as it can.” |

Local gaming PC is fine for development. For **24/7 paper/live**, prefer a small dedicated VPS near US exchanges.

## Optional upgrades (later)
1. **Binance WebSocket** mark price + klines (sub-second prints; needs `websockets` package)
2. **Kalshi WebSocket** orderbook if API key + WS access
3. **Render / Fly / Railway** always-on paid instance, single worker
4. **Dedicated IP** if you hit rate limits

## Env toggles (`backend/config.py` or env)
```
BEAST_MODE=true
PARALLEL_AGENTS=true
DUAL_SPOT=true
ANALYSIS_INTERVAL=1.5
ANALYSIS_INTERVAL_HOT=1.0
ANALYSIS_INTERVAL_FLAT=3.0
```

UI poll override in browser console:
```js
localStorage.setItem("council_poll_ms", "500"); location.reload();
```
