# Spot Signal Lab V1 — locked specification

Authority is the constant `none`. This is paper research only: no real money, exchange credentials, transaction submission, signing, custody, fund movement, or activation switch for financial execution. The only external request is an unauthenticated GET to `https://api.exchange.coinbase.com/products/BTC-USD/ticker`; redirects are rejected. No alternative host or fallback feed is allowed.

The only signal version is `spot-signal-v1`, seeded active. Positions are simulated long or short, with one open row per version enforced in SQL. There is no scale-in, no same-bar re-entry, no automatic successor version, and no deletion of losing or killed trades.

## Data convention and causal timing

Poll every 15 seconds on an independent non-overlapping timer, booted only when `SPOT_LAB=1`. Default is off. Failed network, storage, or calculation work is caught and reported only within this lab. Application boot and the public decision runtime never await this timer. A new optional server plugin owns start/stop; it imports the lab only after checking the flag. No existing runtime/startup/deployment file changes.

Use the ticker's `time` (last public trade time) and `price`. Reject non-positive/non-finite prices, invalid/future timestamps, and oversized/malformed responses. UTC minute-start is `floor(time / 60000) * 60000`. Upsert that timestamp into `spot_prices_1m`; during the current minute keep the latest observed valid ticker price. Once the minute closes its stored print is immutable. Delayed samples can fill an absent minute, but cannot overwrite an existing closed print. Repeated ticker timestamps cannot make the latest print appear fresher: age comes from stored minute timestamp, not fetch time. Minute truncation makes freshness conservative by up to 59.999 seconds.

A decision at boundary T uses only stored rows with `ts + 60 seconds <= T` (therefore also `ts <= T`). The current partial minute is excluded. No interpolation, backfill from another feed, or reconstructed candles. This is the final sampled ticker print for an observed minute, not an exchange OHLC candle or a guarantee that every trade was sampled.

Sort prices by timestamp. A gap over 180 seconds resets warmup. All entries require the trailing 60 prints to have exact 60-second spacing; even a shorter missing-minute gap prevents entry until 60 contiguous closed minutes exist again. No signal before warmup. Future appended rows must not change a historical decision. Inputs and explicit timestamps fully determine the pure signal and accounting functions; no implicit clock, randomness, I/O, or data access in either pure module.

Directional gates are evaluated once for each closed decision minute in a running process. Failed writes do not advance the in-memory evaluation marker. Restart may recompute a minute, but persisted event checks make its writes idempotent: a version cannot enter if its last entry or exit is at or after T. Every tick still evaluates stale/max-hold/killed flattening, even without a new price minute. A successful no-action evaluation need not create a trade. No same-minute flip after an exit.

## Indicators and state transitions

- `sma_fast`: arithmetic mean of the latest 20 closed prices.
- `sma_slow`: arithmetic mean of the latest 60 closed prices.
- `roc_15`: latest closed price / closed price 15 bars earlier minus 1.
- Raw long gate: `sma_fast > sma_slow` and `roc_15 > 0.0015`.
- Raw short gate: `sma_fast < sma_slow` and `roc_15 < -0.0015`.
- Entry also requires flat, active version, warmed series, new decision minute, no event at/after T, and latest closed minute-start print age at most 90 seconds.
- Both gates false, equal SMAs, or stale entry price: remain flat. Never flip on equal SMAs.
- For an open position, exit on the opposite raw directional gate only with a fresh (at most 90 seconds old) warmed print and a new decision minute; otherwise at 240 minutes held or latest closed print age greater than 180 seconds. Reasons: `opposite`, `max_hold`, `stale`.
- Precedence: killed flatten, stale, max hold, opposite, entry, hold. Exactly 180 seconds is not stale; exactly 240 minutes triggers max hold.
- A killed version opens nothing. Flatten an existing open position on its next tick with a valid stored closed price, reason `killed_flatten`. With no valid stored price or unavailable storage, retain the open row and visibly report the pending/unavailable state; never invent an exit price.

Entry/exit timestamps are the decision minute boundary T. Entry/exit prices are the last eligible stored closed print. Stale and killed flatten use that last stored print as a paper mark, explicitly labelled; this is not a contemporaneous executable quote. Price age is computed from explicit tick time minus stored minute-start timestamp. Held minutes are `(T - entry_ts) / 60000`.

## Accounting and the fixed kill checkpoint

For each completed trade:

`side_sign = +1` for long, `-1` for short.

`gross = side_sign * (exit_price - entry_price) / entry_price`.

`pnl_paper = gross - 0.0010`.

This is gross of market fees and net of a declared 10 bps round-trip haircut (5 bps per side), **not a measured Coinbase fee**. Store gross and pnl_paper. Losses remain visible. Sums are sums of per-trade fractional returns; no sizing/compounding claim.

Only closed v1 rows count. Never evaluate kill before 50 closed trades. Evaluate once at the first 50 completed v1 trades, in exit-time/ID order. Buy-and-hold buys 1 unit at the first v1 entry price and marks at the 50th exit price on this same sequence; `bh_pnl = (exit_50 - entry_1) / entry_1 - 0.0010`, one haircut only, no alternate date/window.

Kill if the first-50 sum of pnl_paper is <= 0, or if that sum is strictly less than this baseline. Reasons are `net_nonpositive`, `trails_buy_hold`, or `net_nonpositive_and_trails_buy_hold`. Equality to a positive baseline passes. Persist killed status, killed_at, reason and both checkpoint numbers. A pass stays active. A later trade cannot restart/rejudge the fixed checkpoint. If killed, checkpoint numbers remain frozen; all trade rows (including any later required flatten) remain visible. For an active version, n_closed and pnl_paper track all closed trades after the checkpoint, with bh_pnl retaining the fixed first-50 baseline.

Serialize each paper mutation through a database function that locks the version row, verifies the expected latest trade ID/status, and atomically applies the event and accounting/version update. A close that produces trade 50 and its kill verdict commit together. Concurrent/retried ticks cannot double close, enter after a simultaneous kill, or revive a killed version. SQL enforces one open row and unique version/entry minute; event guards forbid same-bar re-entry. This function only accesses the three lab tables; the migration seeds no trades.

## Storage and ownership

Use the next free numbered migration verified in the current tree: `0077_spot_signal_lab_v1.sql` (highest occupied numbered migration at registration: `0076_bitcoin_wire.sql`). Three independent tables, no reference to public decision data, no foreign keys to other tables, no views:

- `spot_prices_1m`: ts timestamptz primary key, price numeric not null, source text not null.
- `paper_spot_trades`: id, signal_version, side, entry_ts, entry_price, exit_ts, exit_price, exit_reason, gross, pnl_paper, status (`open` or `closed`). Enforce positive finite prices, valid sides, coherent open/closed fields, and one open row per version.
- `spot_signal_versions`: signal_version primary key, status (`active` or `killed`), killed_at, kill_reason, n_closed, pnl_paper, bh_pnl. Seed only `spot-signal-v1` active, n_closed 0, pnl_paper 0, bh_pnl null.

`signal-v1.ts` is pure signal math/state transitions; `ledger.ts` is pure haircut/checkpoint math; `sql.ts` holds parameterized lab-only SQL and SQL adapter types; `spot-lab.server.ts` performs the sole public ticker request, price writes, paper tick, report reads and timer management. The only allowed existing application data dependency is `@/lib/db`; no decision-runtime imports in either direction. The lab never consumes any public strategy outputs. Timer failures cannot block or alter the public desk.

## Hidden research page

Public path `/lab/spot`, robots metadata `noindex, nofollow`. Exact top-of-page banner:

> Paper research — not financial advice. Signals only.

No sitemap entry; no link from existing pages, menus or public lab. Do not modify `src/routes/lab.tsx`, root, FAQ, LabRoom, books, floor or chamber. The page component lives at `src/routes/lab.spot.tsx`. Because `/lab` has no child outlet, a **new** `src/routes/lab_.spot.tsx` route adapter uses the router's non-nested convention to serve `/lab/spot` directly under root without editing the existing `/lab`. Generated route registration is the only existing code file change.

Use no shared decision-page wrapper. Show authority `none`, version status/reason/checkpoint numbers, poller on/off and last failure, current gate/indicators/warmup/freshness, open paper position or `none`, and every closed trade, both gains and losses. Returns are labelled percentages/fractional paper returns and the declared haircut is explained. Refresh read-only report every 15 seconds. GET report reads never boot collection or mutate version/trades. A cold/off collector may have no prices; say warming/no observations. On storage failure show **Storage unavailable** and do not fabricate an empty/zero book or show `none` as if confirmed. A stale retained client snapshot is explicitly marked unavailable. Rows are never deleted or hidden on kill.

## Verification and shipping

Tests: long win/loss, short win/loss, exact haircut, open-row exclusion, deterministic signals/returns, future-bar no-lookahead, contiguous warmup and gap reset, equal-SMA flat, freshness boundaries, opposite/max-hold/stale exits, persistent same-bar re-entry refusal, one-open/concurrent/retry guards, 49-not-killed, 50 killed on nonpositive/trailing return, passing first-50 checkpoint, killed flatten and immutable killed receipt, storage failure transparency, no partial-minute signal, exact network URL/GET/no redirect, and default-off timer.

Rails test rejects forbidden decision dependencies, financial execution/credential paths, external hosts, or cross-table references in lab implementation; protected files must not import/reference spot-lab or its tables. Assert no seed trades, no sitemap/public links and unchanged protected deployment/startup/public-lab files. The existing npm test discovery runs the lab tests through `scripts/spot-lab-rails.test.mjs`; subprocesses must clear inherited NODE_TEST_CONTEXT so assertions actually run. Real SQL is exercised on PGlite with no production credentials.

Branch `research/spot-signal-lab-v1`, **draft PR only**. Commit this document before any implementation. Code must match this document. No merge, deploy, production migration, infrastructure edits, `render.yaml`, `Procfile` or `startup.sh` changes. Do not merge. Collection remains off unless SPOT_LAB=1.
