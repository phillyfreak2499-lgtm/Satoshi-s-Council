# Satoshi's Council

**A living Round Table of specialist agents for clearer, longer-horizon crypto decisions.**

Process over prediction. Confluence over noise.

> **Status: pivot in progress.** The doctrine, decision language, and horizon described below are the
> direction of the project as of August 2026. Parts of the backend still carry short-horizon
> Kalshi-window logic from the previous version. See `PIVOT.md` for what changed and why, and the
> *Implementation Status* section near the bottom for what is documented vs. what is shipped.

---

## What This Is

Satoshi's Council is a multi-agent research desk. Specialist agents debate market structure,
momentum, volume, regime, crowding, and risk across major coins. The Chair synthesizes the debate
into ranked, process-driven guidance.

It is built for **research discipline and accountability** — not short-term betting.

- Paper-track first
- Strong preference for waiting when confluence is weak
- Longer horizons preferred (hours to days/weeks)
- No auto-trading

The visual Round Table, ranked debate, agent hierarchy, and adaptive weighting are the core of the
system. The goal is fewer, higher-quality decisions.

---

## Core Principles

- **Paper first** — No real-capital use until a meaningful sample exists under the current rules
- **Confluence required** — The Chair needs meaningful agreement among higher-ranked agents
- **WAIT is valid** — Sitting when agreement is weak is correct process
- **Process over P&L** — Track rule adherence and confluence quality alongside results
- **No auto-trading** — Research and accountability desk only
- **Free public data preferred** — The system must never *require* a paid plan to start (one known exception today: the CoinGlass-backed seats CARRY / CHAIN / CASCADE)

Full operating rules live in `DOCTRINE.md`.

---

## Decision Language

**Accumulate · Buy Zone · Hold · Reduce · Sell · Wait**

Every non-Wait decision carries a confidence score, a suggested horizon (e.g. "days to weeks"), and
a brief synthesis of why the ranked agents agree.

This replaces the previous UP / DOWN / WAIT directional calls and the path-management actions
(`LONG_UP`, `REDUCE_DOWN`, `FLAT_ALL`, …) used by the short-horizon version.

---

## Core Decision Seats

These eight seats carry the primary research load under the new doctrine:

| Callsign | Role | Primary Focus |
|----------|------|---------------|
| **CHAIR** | The Gavel | Final synthesis, ranking, overall confluence & risk posture |
| **WICK** | BTC Structure | Bitcoin higher-timeframe structure, levels, pattern quality |
| **PULSE** | ETH Flow | Ethereum volume, flow, and relative strength |
| **DRIFT** | Momentum Scout | Solana + cross-major momentum and trend strength |
| **TAPE** | Multi-Coin Tape | Relative volume and cross-asset confirmation |
| **CARRY** | Crowding & Funding | Perp funding, open interest pressure, crowded positioning |
| **ORBIT** | Regime Watch | Volatility regime, session context, risk-on / risk-off |
| **WARDEN** | Risk Guardian | Feed health, process adherence, size & drawdown guardrails |

> **This table is the target design, not current behavior.** DRIFT has no Solana input yet; TAPE is
> still a Kalshi order-book reader; PULSE is asset-agnostic rather than ETH-specific; WARDEN is
> feed-health only with no size or drawdown logic; and ORBIT is not seated on the ETH table at all.
> `ROSTER.md` carries the full per-seat detail.

See `ROSTER.md` for full seat definitions and the developer mapping notes.

### Full live roster

The running backend currently seats more specialists than the core eight. These remain wired and
visible on the Floor; several were built for short-horizon Kalshi work and are being re-scoped,
de-weighted, or muted as the pivot lands.

| Callsign | Internal key | Title | Pivot disposition |
|----------|--------------|-------|-------------------|
| CHAIR | `leader` / `chair` | The Gavel | Core |
| WICK | `candle_btc` / `candle_eth` | Bitcoin / Ethereum Pattern Specialist | Core |
| PULSE | `volume` | Flow Reader | Core |
| DRIFT | `momentum` | Trend Scout | Core |
| TAPE | `orderflow` | Book Walker | Core |
| CARRY | `funding` | Rate Oracle | Core |
| ORBIT | `regime` | Regime Watch | Core |
| WARDEN | `guardian` | System Guard | Core |
| VOLT | `volatility` | Vol Scout | Retain — supports regime |
| CHAIN | `oi_pressure` | OI Pressure | Retain — supports crowding |
| WHALE | `whale` | Whale Tape | Retain — supports tape |
| CASCADE | `liq` | Liq Cluster | Retain — risk context |
| WIRE | `news` | Sentiment Desk | Retain — optional seat |
| EXHAUST | `exhaust` | Run Fade | Re-scope to higher timeframe |
| FADE | `panic` | Panic Fade | Re-scope to higher timeframe |
| VEL | `spotlag` | Spot Lag | Re-scope — short-horizon origin |
| STREAK | `streak` | Path Reader | De-emphasize — path grading retired |
| CLOCK | `session_tod` | Session Clock | De-emphasize — session micro-timing |
| QUORUM | `quorum` | Floor Count | Internal — floor mechanics |
| LAW | `law` | Enforcer | Internal — rule enforcement |
| ODDS | `odds` | Kalshi Skew | **Mute** — Kalshi-specific |
| STRIKE | `strike` | Strike Scout | **Mute** — Kalshi-specific |
| CHEAP | `cheap` | Value Side | **Mute** — dual-sided scalp logic |

Sub-council micro-bots (CORE / FRAME, SURGE / ECHO, RIFT / SWING, LEDGER / EDGE, YIELD / SWARM,
NODE-B / NODE-K, and others) sit behind each specialist and are unchanged by this pivot.

Two known callsign collisions in `roster.py`: the sub-bots `session` and `fade` render as CLOCK and
FADE, which are already main-seat callsigns. Two different bots currently display under each of
those names — worth renaming.

Internal keys stay stable for weights and learning logic; the UI shows callsigns via `display_name`.

---

## Project Layout

```
satoshi-council/
├── backend/
│   ├── main.py              # FastAPI app + lifespan loop
│   ├── config.py            # weights, thresholds, endpoints
│   ├── agents/              # specialists + Leader/Chair + roster
│   ├── data/                # market feeds + pipeline
│   ├── services/council.py  # orchestrator
│   ├── storage/db.py        # SQLite PerformanceStore
│   ├── risk/                # sizing + risk helpers
│   ├── learning/            # reweighter helpers
│   └── tests/
├── frontend/
│   ├── static/              # the page actually served in production
│   ├── protected/
│   ├── css/  js/            # legacy assets — see Quick Start note
│   └── index.html           # legacy standalone page
├── deploy/                  # huddle + keepalive cron (referenced by render.yaml)
├── DOCTRINE.md              # Full operating rules (active)
├── DOCTRINE-LEGACY-PATH.md  # Archived short-horizon doctrine
├── ROSTER.md                # Agent definitions
├── MEMBERSHIP.md            # Access tiers (proposed, not built)
├── COUNCIL_METHOD.md        # Digital product / playbook
├── PIVOT.md                 # Why and how the system changed
├── GITHUB_SETUP.md          # Repo setup + code priorities
├── DEPLOY_RENDER.md         # Deployment guide
├── requirements.txt
├── render.yaml
└── README.md
```

---

## API Surface

| Endpoint | Returns |
|----------|---------|
| `/health` | Health check for Render |
| `/api/state` | Full council snapshot (decision, agents, weights, market, health) |
| `/api/accuracy` | Chair outcome stats (hit-rate per asset). Process metrics are not yet computed |
| `/api/history` | Recent logged decisions |

### Example `/api/state`

```json
{
  "timestamp": "2026-08-11T14:05:10.584Z",
  "decision": {
    "direction": "WAIT",
    "confidence": 72,
    "summary": "Insufficient confluence – WAIT",
    "score": 0.2651,
    "diversity": 2
  },
  "agents": [
    {
      "agent_name": "candle",
      "direction": "UP",
      "confidence": 58,
      "reasoning": "Breaking local high",
      "category": "candle",
      "features": { "body_ratio": 0.998 }
    }
  ],
  "weights": { "candle": 0.22, "volume": 0.15 },
  "market": {
    "price": 118432.1,
    "funding": 0.0001
  },
  "health": { "binance": true }
}
```

> **The example above is simplified and partly out of date.** Two known gaps: (1) the `direction`
> field still emits legacy `UP` / `DOWN` / `WAIT` values — migrating it to the new decision language
> (`Accumulate`, `Buy Zone`, `Hold`, `Reduce`, `Sell`, `Wait`) is pending, see `ROSTER.md` →
> *Implementation Notes for Developers*; and (2) the live payload is dual-table keyed
> (`mode: "dual"`, `tables: { bitcoin, ethereum }`, plus `leaders` and `scorecard`), not the flat
> single-asset shape shown. Read `backend/services/dual.py` for the authoritative structure.

---

## Grading & Learning

Paper decisions are logged with the prevailing confluence score, agent rankings at the time of
decision, the stated horizon, the later outcome over that horizon, and a process grade (did we
follow the rules?). Weights and ranks update from this history.

Short-window path P&L and Kalshi settle grading are retired as the primary scoreboard.

Metrics that matter:

- Confluence quality distribution
- Wait rate
- Rule adherence rate
- Agent usefulness ranking over time
- Paper expectancy over stated horizons (secondary)
- Maximum paper drawdown under the rules

---

## Quick Start (Local)

```bash
cd satoshi-council
pip install -r requirements.txt
PYTHONPATH=. uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

Then open `http://localhost:8000/` — the backend serves the Round Table out of `frontend/static/`.

Note: `frontend/index.html` is a legacy standalone page that loads its assets from absolute root
paths and renders broken over `file://`. Use the served URL above, not that file.

Windows users: see `WINDOWS-SETUP.txt`.

---

## Deployment

See `DEPLOY_RENDER.md` for the full setup, or `DEPLOY-SIMPLE.txt` for the short version.

Start command (critical):

```bash
PYTHONPATH=. uvicorn backend.main:app --host 0.0.0.0 --port $PORT
```

- Health check: `/health`
- Render → Blueprint → select repo (`render.yaml`)
- Uses Web Service + persistent disk + Huddle Cron + Keepalive Cron
- Plan: Starter or higher. The free tier sleeps and stops continuous analysis.

---

## Membership

- **Free**: Limited / delayed view + public process stats
- **Council Member ($24/mo)**: Full live Round Table, complete reasoning, history, rankings
- Bundle option with *The Council Method* playbook — proposed, not yet priced

None of these tiers are built yet. Access today is a single shared password.

Details in `MEMBERSHIP.md`.

---

## The Council Method

A short practical playbook that teaches the decision framework behind the Round Table. Useful for
crypto research **and** transferable to leadership / sales accountability systems.

See `COUNCIL_METHOD.md`.

---

## Implementation Status

Honest accounting of documented direction vs. shipped code, so the README does not overstate the
system:

| Area | Documented | Shipped |
|------|-----------|---------|
| Round Table UI, ranks, debate log | ✅ | ✅ |
| Adaptive weighting / learning loop | ✅ | ✅ |
| No auto-trading (nothing routes on its own) | ✅ | ✅ Follower OFF by default, live OFF |
| Longer-horizon doctrine | ✅ `DOCTRINE.md` | ⏳ Backend loop still runs on a 15m Kalshi window cadence |
| Decision language | ✅ Accumulate / Buy Zone / … | ⏳ API still emits UP / DOWN / WAIT |
| Multi-coin research scope | ✅ | ⏳ BTC + ETH only, and hardcoded — adding a third coin is a refactor |
| Kalshi-specific seats muted | ✅ Listed above | ⏳ Available behind `RESEARCH_MODE` (off by default). When on, ODDS / STRIKE / CHEAP are silenced and their ~30% of base weight is redistributed proportionally. See *Research Mode* below |
| Path P&L grading retired | ✅ | ⏳ Path grading code still present |
| Process metrics (wait rate, rule adherence, confluence quality, horizon, process grade) | ✅ | ❌ None computed. `/api/accuracy` returns outcome hit-rate only |
| Risk guardrails (size limits, hard drawdown) | ✅ Doctrine rule 7 | ❌ No drawdown logic exists in the backend. WARDEN is feed-health only |
| Membership tiers (free / $24 member) | ✅ `MEMBERSHIP.md` | ❌ Not built. Access is one shared password, no payment integration |
| Core 8 seats consistent across tables | ✅ `ROSTER.md` | ❌ ORBIT is not seated on the ETH table |
| Free public data sufficient | ✅ | ⏳ CARRY / CHAIN / CASCADE forced to WAIT behind a CoinGlass plan wall |
| Off-thesis desks removed | ❌ Not claimed | ❌ Side Table (15m Kalshi arcade) and THE FRONT (Dallas weather markets) still ship as UI tabs, disarmed |

Rows marked ❌ are the honest gaps. They are listed here rather than quietly omitted, because the
first rule of the pivot is not claiming an edge or a capability the system has not demonstrated.

---

## Research Mode

The doctrine calls for muting the Kalshi-specific seats (ODDS, STRIKE, CHEAP) on the primary
research path. Those three carry roughly 30% of base weight, with `strike` the second-heaviest
specialist in the system — zeroing them naively would shrink every Chair score and make confluence
read as weaker than it is.

`RESEARCH_MODE` does it properly. When on, each muted seat is assigned `RESEARCH_MUTE_SHARE` of the
remaining unmuted weight, and the surviving seats absorb the freed weight proportionally on
renormalization. No new weight values are invented, and learned weights on disk are never modified —
the mute is re-derived at normalization time, so turning the flag off restores prior behavior
exactly with all learning intact.

| Setting | Default | Meaning |
|---------|---------|---------|
| `RESEARCH_MODE` | `false` | Master switch |
| `RESEARCH_MUTE_SHARE` | `0.0` | Share of unmuted total each muted seat keeps. `0.0` = fully silent |
| `RESEARCH_MUTED_AGENTS` | `["odds","strike","cheap"]` | Seats affected |

Enable on Render by adding an environment variable `RESEARCH_MODE=true`, or locally in `.env`.

**It is off by default deliberately.** Turning it on materially changes Chair behavior and has not
been backtested. Recommended path: enable it, then paper-track under the new rules and compare wait
rate and confluence quality against the current baseline before drawing conclusions. If it makes
things worse, remove the environment variable — nothing is lost.

Covered by `backend/tests/test_research_mode.py`, including a regression guard proving the mute does
not compound across repeated normalizations.

---

## Important Notes

This is a research and education tool. Past paper results do not predict future performance. No
system guarantees profits. Use only capital you can afford to lose, and only after understanding
the risks.

The original short-horizon Kalshi-focused path has been retired **as the doctrine and the primary
scoreboard**. It has not yet been fully removed from the code: the analysis loop, several seats, and
two secondary desks (Side Table, THE FRONT) still carry short-horizon logic. Those are disarmed and
scheduled for removal or re-scoping, not presented as the product. The historical doctrine is
preserved in `DOCTRINE-LEGACY-PATH.md` for reference.

---

Built with process in mind.
Paper first. Confluence required. Wait when it is the correct decision.
