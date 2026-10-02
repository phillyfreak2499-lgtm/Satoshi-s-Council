# WEATHER_NULL_V1 — private pre-registration

Authority **none**. No paper, orders, notifications, UI, public routes, Council inputs or promotion. This is a worth-it-or-not test for a potential separate product. The runner imports only its own modules and `pg`; it uses a dedicated `weather_research` Postgres schema and a separate Node child process. Sharing the existing service lifecycle and database infrastructure does not share the Chair/paper code path.

**No collection has been run by this implementation.** The exact `research/weather/spec.json` bytes are SHA-256 registered in the private database before the first network collection. A changed spec under the same ID refuses to run. Changes require a new study ID and a separately reviewed spec. Collection defaults off unless `WEATHER_RESEARCH_ENABLED=true`; no deployment or environment change is implied by this PR.

## Sources and identity

Initial fixed cities: NYC/KNYC/CLINYC; Chicago/KMDW/CLIMDW (Midway, not O'Hare); Miami/KMIA/CLIMIA; Austin/KAUS/CLIAUS. Series: KXHIGHNY, KXHIGHCHI, KXHIGHMIA, KXHIGHAUS. Coordinates are frozen in the spec. Current series and actual market rules name **The Weather Company** as settlement source. NWS hourly point forecasts and station observations are model inputs, never official outcomes. General help-page language is insufficient to override a particular market's rules.

Every run saves raw GET receipts with receipt/source clocks and market rules. Require exact climate identity, settlement-source match, integer bracket inequalities, exhaustive/nonoverlapping ladder and close-time agreement. Official outcome comes only from a non-provisional settled Kalshi market with YES/NO result and numeric final expiration value agreeing with its bracket. A revision or contradiction stops the study for manual review; original receipts are retained.

These current ladders close at local **standard-time** midnight (05:00Z NY/Miami; 06:00Z Chicago/Austin). The model's 24-hour forecast/observation interval ends at that actual market close. Each new market must match this frozen definition, or it is an excluded snapshot. Civil local schedules are separately DST-aware; never infer the target weather date from UTC midnight. New cities or changed settlement rules are outside v1.

Primary docs: [Kalshi series](https://docs.kalshi.com/api-reference/market/get-series), [public GET markets](https://docs.kalshi.com/api-reference/market/get-markets), [current KXHIGHNY source](https://external-api.kalshi.com/trade-api/v2/series/KXHIGHNY), [NWS API](https://www.weather.gov/documentation/services-web-api).

## Capture and training

- Day ahead: one fixed snapshot at 18:00 city civil time, for the next weather date; 15-minute late grace, never a retrospective forecast reconstruction.
- Same day: 08:00 through 20:00 city civil time, once per hour, within the same grace. **Daily-only collection cannot answer the hourly observation-floor question.**
- Nightly: 03:00 city civil time. Revisit the last 14 days of public settled markets to allow delayed official release. Delayed, nonnumeric or provisional outcomes remain unscored.
- Pair the frozen NWS forecast and Kalshi mid within 120 seconds. NWS forecast source stamp must be present, nonfuture and at most six hours old. Verified (`V`) station observations must be nonfuture; hourly observation freshness is at most 90 minutes. Quotes need a valid two-sided market, <=10¢ spread and a complete bracket partition. Missing/stale data remain visible gaps.
- Day-ahead predictor is the maximum of the full 24-hour NWS hourly point forecast. Same-day predictor is the maximum of observed temperature so far and the complete remaining-hour forecast; this is a distinct predictor trained separately by city **and capture hour**.
- Empirical residual distribution: final official high minus that frozen predictor, last 60 eligible earlier city-days, minimum 30. Labels must have been discovered before the prediction clock. No city pooling, future labels, retrospectively retrieved forecasts or fabricated warmup probabilities.
- Convert residual draws to integer daily highs with nearest-integer rounding, assign to exact contract brackets, and save probabilities at capture. This rounding is a frozen model assumption, not a claim about preliminary station conversion. All probabilities sum to one across the full partition.
- Secondary floor arm truncates the empirical same-day high distribution at the verified NWS observed floor. **NWS is a different source from the settlement source; this is a hypothesis, not guaranteed arbitrage.** Store source differences and score failures against official outcomes.

## Test order and stop rules

1. **Replicate the null.** Primary endpoint: paired Brier improvement versus the simultaneously observed day-ahead Kalshi mid, averaged across the complete bracket partition per city/weather-date. All brackets must be scored; one city/date is one unit. Each date is a cluster across cities, preserving cross-city dependence. Compare the date-balanced mean and deterministic date-cluster bootstrap (2,000 resamples, seed in spec); one-sided success is the lower end of the frozen 95% interval >0 **and** at least 2% relative improvement. This is a forecast test, not trading P&L.
2. **Observation-floor edge by hour.** Only after the finalized primary passes. Separate city-date/hour units; floor arm must beat both the same-day forecast arm and contemporaneous mid. Each hour needs >=40 city-days and >=30 distinct dates; use Bonferroni simultaneous intervals for 26 comparisons (13 hours × two comparators), family alpha .05. No picking the best hour from unadjusted intervals.
3. **Tails.** Review after the hourly analysis, conditional on primary success. Fixed low/high tails are mid <=.10 and >=.90, separately by city. Require >=40 eligible city-days and >=30 dates in each cell. Eight Bonferroni comparisons, family alpha .05. Report signed market mispricing plus model-vs-mid Brier; never pool rungs into independent trials or promote a sparse tail.

Evaluation starts on the first date with model-scored day-ahead units available for all four cities, after the 30-day-per-city training minimum. Freeze 60 evaluation weather dates. Allow seven calendar days after the evaluation boundary for official labels, bounded by the overall calendar cap. Need >=160 evaluation city-days, >=40 distinct dates and >=30 per city. Primary failure or insufficient sample at that boundary kills the hypothesis. Primary success ends collection and permits **private review only** of secondary results; no production change or automatic promotion.

Hard stop at 100 calendar days after the first scheduled collection attempt (including failed HTTP attempts): no extension, parameter tuning, extra cities or reset to rescue a result. From day 14, kill on valid day-ahead capture coverage <80% of expected city-days. Stop if raw receipt storage exceeds 512 MiB. A changed spec, official-outcome contradiction/revision or unexpected rule identity is refused/stopped as described above. Network/DB failures are logged as failed jobs, retry only within the capture window, and are never success counts. A timed-out process exits; a restart cannot overwrite a frozen snapshot.

## Operations and cost

No new Render service and no paid API subscription. NWS is free; Kalshi inputs are public market-data GETs. Incremental compute/storage use the existing plan, not a new recurring subscription. Frozen bounds: one connection, serial requests, 12-second HTTP timeout, 5 MiB response limit, 10-page maximum, three-minute job-cycle deadline, 96 MiB child JS heap, 512 MiB raw-receipt budget. A Node heap cap is not an RSS guarantee; observe actual process memory before activation. Sharing infrastructure can still consume resources; weather failure never blocks or restarts the Council process.

Private commands on the service checkout:

```
node research/weather/runner.mjs --install
node research/weather/runner.mjs --report
WEATHER_RESEARCH_ENABLED=true node research/weather/runner.mjs --once
```

The existing Render process starts the independent daemon only after explicit enablement. It schedules its daily, hourly and nightly slots; missed slots remain missing. This uses no ChatGPT scheduled-task automation and requires no public endpoint. Owner reports are CLI JSON or direct SQL against `weather_research.*`; there is no Lab tab, public API or public status counter. Database credentials and raw private reports are never committed.
