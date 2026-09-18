# NULL_HORIZON_V1 — Lab-only, authority none

Frozen 2026-09-17. Paper research. Does not write to the Chair, learner, promotion, skill status, or the paper book.

## Question

On the same 700 complete replays the Lab already uses, does a horizon-weighted council beat a driftless null after fee?

## Arms

| Arm | Definition |
| --- | --- |
| NULL | Recorded lab `fair` at the horizon frame as P(UP). That fair is the live clock model Φ((S−K)/σ). If fair is missing, the arm sits. Do not invent vol from later spots in the same window. |
| HEARD | Walk-forward log-odds vote using only |code|=2 seats (Chair-heard). |
| RAW | Same vote with the whisper off (|code|≥1). |
| HORIZON | Same raw reads, but each seat's weight is its walk-forward log-odds at *that* horizon only. |

## Shared booking rule

Take the side only when:

- predicted p minus ask minus fee ≥ 3¢
- ask in 80–98¢
- spread ≤ 2¢
- hold to official settlement

Also print the +1¢ extra-cost case.

Fee is `ceil(7 · P · (1−P))` cents, the desk's existing taker formula.

## Gate (not promotion)

HORIZON must beat NULL on **Brier and net** at 450s and 180s, walk-forward, before anyone discusses a Chair change. 60s is descriptive. 15s is a market-tape check.

Meeting a count is not promotion. Review gates stay frozen: 250 prospective fills, 30 days, 25 paired control-loss windows.

## How to run

```
DATABASE_URL=... npm run lab:null-horizon
```

Read-only SELECT. Refuses to start without DATABASE_URL. Prints JSON, then a table. Exit 0 on findings; nonzero only if the query fails.

## How to read the table

- Ignore 0:15 win rate. 97% at 15s is the book at 97¢. Use hit minus market p.
- n taken / n eligible matters. A 90% arm on 12 windows is not a Chair.
- Drawdown sits next to net.
- RAW beating HEARD means the whisper gate is the story. HORIZON still has to beat NULL.
