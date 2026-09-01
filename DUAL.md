# Dual Table — Bitcoin (Satoshi) + Ethereum (Vitalik)

## What shipped
- Two independent councils in one process
- **Satoshi** → Kalshi 15m BTC (`KXBTC15M`)
- **Vitalik** → Kalshi 15m ETH (`KXETH15M`)
- Independent `locked_call`, agents, weights, accuracy per table
- Floor mode: side-by-side chairs + plaques
- Tuned for **2 CPU / 4 GB**

## API
`GET /api/state` returns a thinned poll:

```json
{
  "dual": true,
  "tables": { "bitcoin": {...}, "ethereum": {...} }
}
```

Fat research books (accuracy, weights, huddle) stay on their own gated routes.

## Config
- `ENABLE_ETH_TABLE=true`
- `SERIES_BTC=KXBTC15M` / `SERIES_ETH=KXETH15M`
- `ANALYSIS_INTERVAL_BTC=2` / `ANALYSIS_INTERVAL_ETH=2`
- `DUAL_SEQUENTIAL=true`

## Deploy
1. Use a **2 CPU / 4 GB** instance
2. Start: `PYTHONPATH=. uvicorn backend.main:app --host 0.0.0.0 --port $PORT --workers 1`
3. Confirm logs show: `DualOrchestrator started`
