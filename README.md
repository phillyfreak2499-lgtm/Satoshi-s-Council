# Satoshi Desk

Paper-only **Bitcoin 15-minute** prediction desk. Twenty specialist seats
read tape, structure, candles, book, and derivatives; **SATOSHI** chairs
the vote. Nothing here places a live trade.

Parked in [Satoshi-s-Council](https://github.com/phillyfreak2499-lgtm/Satoshi-s-Council)
as of 2026-09-02. Older Council history is still in git if you need it.

## What this is

- **Bitcoin only.** Kalshi 15-minute up/down contracts. Paper ledger.
- **20 seats** — tape, structure, WICK patterns, book/clock, funding/OI/vol, plus SATOSHI chair.
- **Skill engine** — LIVE / SHADOW / BENCH / UNCALIBRATED / MUTED, Wilson + Brier + EV grading.
- **Demo + live split** — demo ticks and live Kalshi/spot do not share learner state.
- **Chair math** — sit-mass, disagreement tax, learnable seat weights, LAW dimmer, invert hysteresis, hypothesis/invalidate.

Spec: [`docs/SATOSHI_DESK_FULL_PROMPT.md`](docs/SATOSHI_DESK_FULL_PROMPT.md)

## Run

```bash
npm install
npm run dev
```

Dev server binds `0.0.0.0:8080`. Auth and database are off.

## Layout

| Path | What |
|---|---|
| `src/lib/desk/` | Types, seats, skills, chair, learner, feeds, patterns, tape, derivs, persist |
| `src/components/desk/` | Floor UI — strip, bot cards, EYES canvas, SATOSHI tab, settings |
| `src/lib/desk/patterns.ts` | Candle features, 1/2/3-bar patterns, AMD, structure, sweeps |
| `src/lib/desk/tape.ts` | Pulse / tape / whale / velocity microseeds |
| `src/lib/desk/derivs.ts` | Carry / chain / cascade / volt microseeds |

## Rules that do not move

- Paper only. No live-trading arm.
- Bitcoin only. No ETH.
- Candle must be **closed** before a pattern fires.
- Learner grades cents of EV, not just hit-rate.
