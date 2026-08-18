# Satoshi’s Council

**A living Round Table where a council of specialist advisors debates Bitcoin, and SATOSHI — the final authority — decides.**

Process over prediction. Confluence over noise. Discipline over gambling.

---

## What This Is

Satoshi’s Council is a single-asset **Bitcoin research desk**. Four ranked advisors each read a different slice of the market and take a stance; **SATOSHI** sits at the centre as the sole decision-maker and synthesizes the debate into one disciplined call. It is built for **research discipline and accountability**, not short-term betting.

- **Bitcoin only** — one asset, done well. (Ethereum is a *signal* that feeds one advisor, not its own market.)
- **Paper-track first** — no real-capital use
- **A well-formed WAIT beats a lucky call** — the desk sits when the table has not earned a call
- **No auto-trading**

The visual Round Table, the ranked debate, the advisor hierarchy, and adaptive weighting are the core of the system. The goal is fewer, higher-quality decisions — and honest accounting of how good they actually are.

---

## Core Principles

- **Paper first** — no real-capital use until a meaningful sample exists under the current rules
- **Confluence required** — SATOSHI locks a directional call only when enough advisors agree (3 of 4)
- **Process over prediction** — the method is the product; a disciplined *Stand down* is a valid outcome
- **Process over P&L** — the desk tracks rule adherence, confluence quality, and calibration alongside results, never a betting ledger
- **Honest about its edge** — confidence is measured against reality, feeds are shown live/stale/down, and the record is walk-forward tested
- **Free public data** — core analysis uses publicly available feeds

---

## The Council

SATOSHI is rank 0 — the fixed centre seat, the gavel, and can never be ranked, moved, or demoted. The four advisors are **ranked by their recent record**: the strongest sits closest and is heard hardest; a wrong streak mutes an advisor until they earn it back.

| Callsign | Seat | Domain |
|----------|------|--------|
| **SATOSHI** | Centre · rank 0 · final authority | BTC higher-timeframe structure + final synthesis |
| **VITALIK** | Advisor | Ethereum flow & cross-major relative strength (ETH is a signal, not a market) |
| **ARES** | Advisor | Momentum, trend continuity, and tape |
| **RAIJIN** | Advisor · holds a veto | Crowded positioning, funding, regime & volatility risk |
| **ORACLE** | Advisor · holds a veto | Cross-checks, feed health, and process adherence |

A **veto** from RAIJIN or ORACLE forces a *Stand down* regardless of the vote — a protective brake, not an opinion.

Decision language: **Accumulate · Reduce · Maintain · Stand down** (with confidence and the reason behind it).

---

## Accountability tools

These are what make it a *research desk* rather than a signal service — each is a tab in the UI:

- **Calibration** — does the desk's confidence verify? When it says 70%, does it win 70%? Reliability curve, Brier score, ECE, and a "true read" translator that shows what each stated confidence has actually delivered.
- **Data Health** — every feed (BTC spot, Kalshi, CoinGlass derivatives, ETH) shown live / stale / down with its last-update age. If a critical feed drops, the desk says so plainly.
- **Backtest (walk-forward)** — the desk's live forward record is a lookahead-free backtest. Trains on the older calls, tests on the held-out newest slice, and flags decay or overfitting.
- **Provenance** — click SATOSHI's call to see the exact live inputs behind it: the floor, every advisor's read and reason, the risk gates, and the market snapshot.
- **15M lens** — the council's read reframed for the Kalshi 15-minute BTC up/down market. No new bots; a lens on the same debate. Paper research only.

---

## Data sources

Core analysis runs on free/public feeds, each gated through the Data Health panel:

- **Binance** — BTC/ETH spot candles, funding rate, open interest
- **Coinbase** — spot (second price source)
- **Kalshi** — 15-minute BTC up/down market (odds, book, close time)
- **CoinGlass** — aggregated funding / open interest / liquidations (`COINGLASS_API_KEY`)
- **CFBenchmarks** — BRTI research spot reference

---

## Project Layout

```
satoshi-council/
├── backend/                  # FastAPI + agents + services
│   └── services/             # round_table, calibration, backtest, feed_health, kalshi15m, …
├── frontend/                 # Canvas Round Table UI + tabs
├── DOCTRINE.md               # Full operating rules
├── ROSTER.md                 # Council definitions
├── DEPLOY_RENDER.md          # Deployment guide
└── README.md
```

---

## Quick Start (Local)

```bash
cd satoshi-council
pip install -r requirements.txt
PYTHONPATH=. uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

Then open `http://localhost:8000/` — the backend serves the Round Table from `frontend/static/`.

Desk access and admin actions are gated by environment secrets (`COUNCIL_ACCESS_PASSWORD`, `COUNCIL_ADMIN_PASSWORD`); passwords are never stored in code.

---

## Deployment

See `DEPLOY_RENDER.md`. Recommended: Render Web Service + persistent disk.

```bash
PYTHONPATH=. uvicorn backend.main:app --host 0.0.0.0 --port $PORT --workers 1
```

Single instance is deliberate — the analysis loop lives in-process. Health check: `/health`.

---

## Important Notes

This is a research and education tool. It is **paper-only** and places no live orders. Past paper results do not predict future performance, and no system guarantees profits. It is not personalized financial advice.

The earlier multi-market build (sports / weather / politics / arcade desks) and the multi-coin “Council” framing have been retired. The desk is now **Bitcoin only**, centred on SATOSHI, and measured on discipline.

---

Built with process in mind.
Paper first. Confluence required. Stand down when it is the correct decision.
