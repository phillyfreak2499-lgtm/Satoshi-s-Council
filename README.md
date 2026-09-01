# Satoshi’s Council

Live research desk: **[satoshiscouncil.com](https://satoshiscouncil.com)**

A dual Round Table. **Satoshi** chairs Bitcoin 15-minute. **Vitalik** chairs Ethereum 15-minute. Twenty-two BTC seats plus eighteen ETH seats vote. The Chair speaks. You still own the click.

Research display. Not Kalshi. Not financial advice. A well-formed WAIT is a call. No paper tracker.

---

## What is actually running

- **Dual orchestrator** in one process (`--workers 1` on Render Oregon).
- **BTC** — Kalshi `KXBTC15M`, Satoshi in the centre, 22 seats.
- **ETH** — Kalshi `KXETH15M`, Vitalik in the centre, 18 seats.
- **Public Stream** — the gate is an oath, not a visitor password. Checking it mints an HttpOnly `council_desk` cookie. `GET /api/state` is session-gated and thinned (decision, clock, seat directions, health; no accuracy/weights/hierarchy/learning/huddle). There is no paper tracker.
- **Admin** — `POST /api/admin/verify` against `COUNCIL_ADMIN_PASSWORD`. Nothing in JS.
- **Spot** — Binance public data API (`data-api.binance.vision`) from Oregon. `api.binance.com` returns 451 in the US. Coinbase / Binance.US are fallbacks. `/health.spot_ok` is allowed to be false.
- **Perps** — CoinGlass if keyed; otherwise OKX public swaps for funding + OI. The desk does not claim a perp feed it does not have.
- **Proof** — `/proof` is a cached public ledger, rebuilt on settle. Counts are not an edge claim.

The Stream is a TV. There is no paid membership. Live routing is off unless you arm it.

---

## Stack

```
backend/            FastAPI + DualOrchestrator + agents
frontend/static/    index.html + seat.js + wire.js + roundtable.js + room.js + desk-fx.js
data/               Render disk: council.db, learning brain, proof_summary.json
```

Start:

```bash
pip install -r requirements.txt
PYTHONPATH=. uvicorn backend.main:app --host 0.0.0.0 --port $PORT --workers 1
```

Deploy: `DEPLOY_RENDER.md`. Health: `/health`. Build runs `python3 scripts/check.py` (`node --check frontend/static/roundtable.js`).

Secrets (Render dashboard, never JS): `COUNCIL_ADMIN_PASSWORD`, optional `COUNCIL_ACCESS_PASSWORD`, optional `COINGLASS_API_KEY`.

---

## Docs

| File | Role |
|------|------|
| `SECURITY.md` | What is actually gated |
| `DUAL.md` | Two chairs, one process |
| `DOCTRINE.md` | Operating rules |
| `DEPLOY_RENDER.md` | Render disk + one instance |
| `AUDIT.md` | **Archived 2026-08-21** — 2026-08-12 snapshot |
| `PIVOT.md` | **Archived 2026-08-21** — historical pivot notes |

---

Paper first. Confluence required. Stand down when that is the call.
