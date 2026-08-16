# Dual Table — Bitcoin (Satoshi) + Ethereum (Vitalik)

## What shipped
- Two independent councils in one process
- **Satoshi** → Kalshi 15m BTC (`KXBTC15M`) — new brain, not a 1H clock change
- **Vitalik** → Kalshi hourly ETH (`KXETHD`) — stays 1H. Do not start ETH 15m.
- Independent `locked_call`, agents, weights, accuracy per table
- Floor mode: side-by-side chairs + plaques
- Vitalik portraits: green=UP, red=DOWN, white=WAIT
- All audio removed
- Tuned for **2 CPU / 4 GB** (default ~4s sequential dual cycle)

## API
`GET /api/state` returns:
```json
{
  "dual": true,
  "tables": { "bitcoin": {...}, "ethereum": {...} },
  "btc": {...},
  "eth": {...},
  ...back-compat BTC fields at top level
}
```

## Config
- `ENABLE_ETH_TABLE=true`
- `SERIES_BTC=KXBTC15M` / `SERIES_ETH=KXETHD`
- `ANALYSIS_INTERVAL_BTC=4` / `ANALYSIS_INTERVAL_ETH=4`
- `DUAL_SEQUENTIAL=true`
- `BEAST_MODE=false` by default (enable in Settings if you want hotter)

## UI
- **BTC / ETH** focus buttons in header (Table view shows one chair)
- **Floor** shows both tables side-by-side
- `?` tutorial still available

## Deploy
1. Use a **2 CPU / 4 GB** instance
2. Drop backend + frontend files from the dual zips
3. Hard-refresh the browser
4. Confirm logs show: `DualOrchestrator started (btc=on eth=on ...)`
