# Bitcoin Wire (draft; no activation)

Bitcoin Wire is headline context only. The page at `/news` displays the exact label:

> News context — not research, not a SATOSHI call.

The shared More/menu destinations include Bitcoin Wire. The list fetches `/api/news` on mount and every five minutes, updates relative timestamps each minute, and opens publisher links in a new tab. Loading, empty and refresh-failure states are explicit; a failed refresh preserves the last successful list and marks it as such.

## Data and collection

`migrations/0076_bitcoin_wire.sql` creates only `news_items` and its publication index. URL uniqueness and the publisher check are enforced in Postgres as well as in ingestion. The GET API returns a bare array of at most 30 items ordered by publication time descending, then ID descending. Both API and collector exclude publication times outside the last seven days; the collector deletes older records. Missing or invalid dates and future items are dropped rather than assigned invented publication times.

The separate cron entrypoint is `node --experimental-strip-types scripts/bitcoin-wire/poll.mjs`. `docs/bitcoin-wire.render.yaml` defines the proposed 15-minute schedule (`*/15 * * * *`), with auto-deploy disabled. It is deliberately separate from the production web Blueprint: applying this draft must not implicitly create or activate infrastructure. After a future approval, apply the migration via the normal migration process and provision the cron using that template with `NEWS_DATABASE_URL` pointing to the same Postgres database as the API. `DATABASE_URL` is a fallback. Prefer a dedicated database role permitted to access only `news_items` (plus its identity sequence), with SELECT for the API and SELECT/INSERT/DELETE for the collector.

Each poll takes a Postgres advisory lock to avoid overlap, fetches sources sequentially with 15-second deadlines and 2 MiB response limits, validates redirects against exact publisher hosts, parses RSS/Atom with fast-xml-parser, filters whole-word Bitcoin/BTC in the title or description, and inserts parameterized rows using `ON CONFLICT (url) DO NOTHING`. Source names come from the fixed feed configuration, not feed metadata. Descriptions are used only for filtering and are not persisted or rendered. Fragment identifiers are removed before URL deduplication; query strings are preserved.

A failed publisher does not prevent other sources from inserting or retention from running. Partial failure emits the publisher name and error to cron logs and exits nonzero, making missing coverage visible. Nothing substitutes an aggregator or unauthorized publisher.

## Publisher feed configuration and checks (2026-10-02)

- CoinDesk: `https://www.coindesk.com/arc/outboundfeeds/rss/` (direct HTTP check returned 200 application/xml).
- The Block: `https://www.theblock.co/rss.xml` (200 text/xml).
- Decrypt: `https://decrypt.co/feed` (200 application/xml).
- Bitcoin Magazine: `https://bitcoinmagazine.com/feed` (200 application/rss+xml).
All four feeds were parsed locally with the production parser; each contained eligible Bitcoin items. This is a point-in-time connectivity check, not a guarantee of future feed availability.

Reuters Markets/Crypto (`https://reutersagency.com/feed/?best-topics=business-finance&post_type=best`) was removed from the allowlist 2026-10-02 after its endpoint persistently returned 404 HTML, which forced every poll to exit nonzero. There is no Google News, Feedspot, scraping, or other fallback; do not represent the Wire as having Reuters coverage.

## Isolation and review

No Chair, floor/threshold, booking, learner, paper-ledger, follower, feed engine, or desk runtime implementation is modified. News has no imports from desk logic, store, database pool, or engine. The API uses its own lazy one-connection Postgres pool. No news timers or collectors run in the web process. News traffic necessarily adds a small independent database workload; sharing a database cannot promise identical latency under all loads. Desk policy/source byte identity is the review invariant, not a claim that the full application build is byte-identical.

Existing-file changes are limited to adding the parser dependency/lock entries, one menu destination, and generated routing. All other implementation files are new. The main Render Blueprint and production environment are unchanged. No production migrations were run. No merge or deploy is authorized by this draft.

## Verification

Run `node --experimental-strip-types --test src/lib/news/news.test.ts` for real Postgres-compatible PGlite tests covering dedupe, publisher allowlist, keyword filtering, latest-30/newest-first API JSON, seven-day retention, malformed feeds, unsafe URLs and redirect/response bounds. `scripts/bitcoin-wire.test.mjs` bridges this suite into the existing `npm test` discovery without changing desk test scripts.

Also run `npm run typecheck`, targeted ESLint, migration apply/idempotency tests, and `NITRO_PRESET=node-server npm run build`. Build without production database credentials. Never run a collection test against the production database.

### Results on this branch

- Nine Wire contract tests passed; four official publisher feeds returned 200 and parsed successfully. Reuters returned 404 and was later removed from the allowlist (2026-10-02) so polls exit clean.
- Typecheck, targeted ESLint and the Node-server production build passed. Build output explicitly skipped database migration because `DATABASE_URL` was unset.
- Built `/news` returned 200 with the exact disclaimer. Built `/api/news` returned the expected controlled 503 without database credentials; newest-first success JSON was exercised against PGlite through the same response function used by the route.
- 92 focused Chair, floor, selective-entry, paper-book and learner regression tests passed.
- Initial `npm test` script phase: 1,135 passed, four failed, four skipped. The navigation expectation was updated for the new destination. The two concurrent Vite-backed suites passed when rerun serially. The root-tree check passed separately (3/3) after local smoke/test artifacts were cleared. The serial affected-suite run had 71 passes and only that root-artifact failure before cleanup. No claim is made that the full suite was rerun clean from end to end.
- A content comparison confirmed all 419 tracked desk/runtime files except the navigation destination file are unchanged. Every pre-existing dependency-lock entry is preserved.
- Browser visual/interaction testing was unavailable because the Chromium download failed in this environment; build/SSR and API checks succeeded.
