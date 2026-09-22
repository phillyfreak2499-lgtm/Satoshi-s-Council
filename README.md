# Satoshi's Council

Paper-only **Bitcoin 15-minute** research desk. Twenty specialist seats
read tape, structure, candles, book, and derivatives; **SATOSHI** chairs
the vote. Nothing here places a live trade.

This repo is the **fresh start** (2026-09-02): the chair, WICK catalog,
learner, glossary, and 60-second tour. The older FastAPI dual-table
Council is tabled — keep that zip if you ever want it; do not re-upload
it onto this tree.

## What this is

- **Bitcoin only.** Kalshi 15-minute up/down contracts. Paper ledger.
- **21 seats · 15 currently voting · 3 retired from votes · 3 non-voting pit crew** — specialist market reads, with WARDEN, ORBIT, and WIRE providing non-voting operational context; ODDS, CHEAP and FADE retired from votes; SATOSHI chairs.
- **Skill engine** — LIVE / SHADOW / BENCH / UNCALIBRATED / MUTED, Wilson + Brier + EV grading.
- **Demo + live split** — demo ticks and live Kalshi/spot do not share learner state.
- **Chair math** — sit-mass, disagreement tax, learnable seat weights, LAW dimmer, invert hysteresis, hypothesis/invalidate.
- **Hover/tap glossary** — dotted labels explain themselves. First visit runs a 60-second tour; **?** replays it.

Spec: [`docs/SATOSHI_DESK_FULL_PROMPT.md`](docs/SATOSHI_DESK_FULL_PROMPT.md)

## Run

```bash
npm install
npm run dev
```

Auth and database are off. Paper only.

## Live on Render (same repo)

This tree is Node now, not Python. On the existing web service:

1. Settings → **Node**, version **22**
2. Build command: `npm ci && npm run build`
3. Start command: `npm start`
4. Env: `NITRO_PRESET=node-server`, `HOST=0.0.0.0`, `VITE_AUTH_ENABLED=false`, `NODE_VERSION=22`
5. Remove old Python/Stripe start commands. Keep `DATABASE_URL` only if that Postgres is still up (BOARD). Delete the rest of the old secrets.
6. Manual Deploy → wait for green

`satoshiscouncil.com` will become this paper desk. The old RAIJIN/ARES Council goes offline on that URL.

## Layout

| Path | What |
|---|---|
| `src/lib/desk/` | Types, seats, skills, chair, learner, feeds, patterns, tape, derivs, persist |
| `src/lib/desk/glossary.ts` | Hover/tap copy + tour steps |
| `src/components/desk/` | Floor UI — strip, bot cards, EYES, SATOSHI, settings, tour |
| `src/lib/desk/patterns.ts` | Candle features, 1/2/3-bar patterns, AMD, structure, sweeps |
| `src/lib/desk/tape.ts` | Pulse / tape / whale / velocity microseeds |
| `src/lib/desk/derivs.ts` | Carry / chain / cascade / volt microseeds |

## Rules that do not move

- Paper only. No live-trading arm.
- Bitcoin only. No ETH.
- One source tree. Do not drop `backend/`, `agents/`, `services/`, or `storage/` next to `src/`. `npm run check:tree` (also wired into build and typecheck) fails if those reappear.
- Candle must be **closed** before a pattern fires.
- Learner grades cents of EV, not just hit-rate.
