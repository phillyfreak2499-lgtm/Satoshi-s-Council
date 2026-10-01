# Hourly accuracy — September 30, 2026

Read-only live Postgres audit. Cutoff **September 30, 9:25 PM Chicago / October 1, 02:25 UTC**. All numbers below are reproduced by `research/hourly/accuracy.sql` and preserved in `docs/research/hourly-accuracy-2026-09-30.json`. The CLI uses a read-only transaction and imports no Council module.

The displayed hourly **book** is collection/settlement only: currently 299 ledger windows, zero entries, since September 18. The separate hourly **research model** already generates selected **YES/NO** candidates against a named KXBTCD strike. These are not Bitcoin's 15-minute UP/DOWN contract. Neither has authority to paper-book or place orders.

The research model has been calling since **September 21 at 3:30:06 PM Chicago** (20:30:06 UTC), about nine days and six hours at the report cutoff. Model version `hour-research-v1.0.0`; the strict CF Benchmarks source/freshness correction preceded the first call. These are 199 settled retained candidate-hours, not the 238,000+ rung/checkpoint probability rows. Every scored candidate in this snapshot passes the report's settlement-index source and vendor-age checks; none was excluded. There are 23 retained WAIT rows, including ungraded waits; WAIT is not an accuracy denominator. The open hour can still update a retained WAIT, so the SQL cutoff is a snapshot-selection parameter, not a reconstruction of overwritten intra-hour state.

| Observed ask | Settled candidates |   Wins |  Hit rate | Needed after fees | Net after fees, ¢ |
| ------------ | -----------------: | -----: | --------: | ----------------: | ----------------: |
| 0–19¢        |                 95 |     12 |     12.6% |             14.5% |              −181 |
| 20–39¢       |                 38 |     12 |     31.6% |             28.1% |              +131 |
| 40–59¢       |                 18 |      7 |     38.9% |             49.6% |              −193 |
| 60–69¢       |                  8 |      7 |     87.5% |             65.9% |              +173 |
| 70–79¢       |                  6 |      5 |     83.3% |             74.0% |               +56 |
| 80–84¢       |                 13 |      8 |     61.5% |             83.7% |              −288 |
| 85–89¢       |                 16 |     13 |     81.3% |             88.2% |              −111 |
| 90–94¢       |                  5 |      5 |    100.0% |             92.6% |               +37 |
| 95–99¢       |                  0 |      0 |         — |                 — |                 — |
| **Overall**  |            **199** | **69** | **34.7%** |         **36.6%** |          **−376** |

Each net is a hypothetical one-contract candidate result at its frozen ask and stored fee; these are not paper fills, executable-strategy P&L or dollar-sized trades. Hit rate uses `side = official result`, not profitability as a proxy. Needed win rate is mean `(ask + fee) / 100`, not an estimate requiring both winning and losing examples. Brier compares the same candidates: **model 0.163284; market 0.157418** (lower is better). Model probability is already in the candidate's YES/NO side; market YES probability is complemented for NO.

**Lead judgment:** the hourly research is worth continuing to measure because the observer already exists and supplies a clean separate record. It is not ready for paper: aggregate economics are negative, paired Brier is worse than market, and the attractive bands contain only 5–8 examples. The 20–39¢ band has 38 examples, but selecting it after seeing this table would be a new hypothesis requiring its own frozen prospective test. No gate, rule, authority, collection cadence or public surface has been changed by this audit.

Reproduce privately:

```
node research/hourly/report.mjs 2026-10-01T02:25:00Z
```

The report requires DATABASE_URL, stays in a read-only transaction, separates model versions, flags pending/excluded candidates and exposes by-price counts, start/end clocks, hit rate, break-even rate, after-fee results and paired Brier. Raw historical snapshots are not rewritten. Public model/book displays and production behavior are untouched.
