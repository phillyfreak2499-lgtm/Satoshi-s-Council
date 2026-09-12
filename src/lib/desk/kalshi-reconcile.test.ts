/**
 * S2-7 — independent reconciliation behavior (R1–R16).
 *
 * The external side is always a FIXTURE standing in for the Kalshi public payload;
 * the ledger side is the thing under audit. These prove the classifier never lets a
 * ledger field become the external truth, fails closed on identity, and keeps the
 * winner and official-value questions separate.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyReconciliation,
  fetchMarketViaHosts,
  INTER_MARKET_DELAY_MS_DEFAULT,
  parseRetryAfterMs,
  reconcileWindows,
  renderReconReport,
  summarize,
  type FetchOutcome,
  type LedgerWindow,
  type MarketAttempt,
  type OfficialMarket,
  type ReconReport,
} from "./kalshi-reconcile.ts";

const T = "KXBTC15M-26SEP111800-00"; // encodes 2026-09-11 18:00 ET = 22:00Z
const C = Date.parse("2026-09-11T22:00:00Z");
const Ciso = "2026-09-11T22:00:00Z";

function win(over: Partial<LedgerWindow> = {}): LedgerWindow {
  return { ticker: T, close_time_ms: C, winner: "UP", official_value: null, ...over };
}
function market(over: Partial<OfficialMarket> = {}): OfficialMarket {
  return { ticker: T, result: "yes", close_time: Ciso, status: "settled", ...over };
}
const ok = (m: OfficialMarket): FetchOutcome => ({ ok: true, market: m });

test("R1: exact window + exact market agree on winner → MATCH", () => {
  const r = classifyReconciliation(win({ winner: "UP" }), ok(market({ result: "yes" })));
  assert.equal(r.winner_class, "MATCH");
  assert.equal(r.external_winner, "UP");
});

test("R2: identity agrees but official outcome differs → WINNER_MISMATCH", () => {
  const r = classifyReconciliation(win({ winner: "UP" }), ok(market({ result: "no" })));
  assert.equal(r.winner_class, "WINNER_MISMATCH");
  assert.equal(r.external_winner, "DOWN");
});

test("R3: internal ticker encodes c1 but row close is c2 → TICKER_CLOSE_MISMATCH, no external substitution", () => {
  // Even handed a perfectly good (but wrong-window) market, the row is invalid.
  const r = classifyReconciliation(win({ close_time_ms: C + 900_000 }), ok(market({ close_time: "2026-09-11T22:15:00Z", ticker: T })));
  assert.equal(r.winner_class, "TICKER_CLOSE_MISMATCH");
  assert.equal(r.external_winner, null, "no external result is adopted for an internally invalid row");
});

test("R4: requested T, payload names T2 → EXTERNAL_IDENTITY_MISMATCH", () => {
  const r = classifyReconciliation(win({}), ok(market({ ticker: "KXBTC15M-26SEP111815-00" })));
  assert.equal(r.winner_class, "EXTERNAL_IDENTITY_MISMATCH");
  assert.equal(r.witnesses.external_ticker_ok, false);
});

test("R4b: a different market that encodes the SAME close is still a different market — ticker-string identity is load-bearing", () => {
  // The payload ticker parses to the identical close (same date token, different
  // series prefix), so the close-agreement backstop cannot reject it. Only exact
  // ticker-string identity can — matching on close alone is the 2026-09-10 half-identity.
  const r = classifyReconciliation(win({}), ok(market({ ticker: "KXBTCXX-26SEP111800-00" })));
  assert.equal(r.winner_class, "EXTERNAL_IDENTITY_MISMATCH");
  assert.equal(r.witnesses.external_ticker_ok, false);
  assert.equal(r.external_winner, null, "no outcome is adopted from a differently-named market");
});

test("R5: ticker agrees but payload close contradicts the row close → fail closed", () => {
  const r = classifyReconciliation(win({}), ok(market({ close_time: "2026-09-11T23:00:00Z" })));
  assert.equal(r.winner_class, "EXTERNAL_IDENTITY_MISMATCH");
  assert.equal(r.witnesses.external_close_ok, false);
});

test("R5b: the NEXT window's close (15 min away) is not 'near enough' — the tolerance is 90s, not a nearest-window fallback", () => {
  // Ticker agrees; the payload close is the adjacent quarter-hour. A widened
  // tolerance would wrongly accept the neighbour, so this pins the 90s rail.
  const r = classifyReconciliation(win({}), ok(market({ close_time: "2026-09-11T22:15:00Z" })));
  assert.equal(r.winner_class, "EXTERNAL_IDENTITY_MISMATCH");
  assert.equal(r.witnesses.external_close_ok, false);
});

test("R5c: payload carries no ticker → EXTERNAL_IDENTITY_UNVERIFIABLE, never MATCH (even with a matching close)", () => {
  const r = classifyReconciliation(win({}), ok(market({ ticker: undefined })));
  assert.equal(r.winner_class, "EXTERNAL_IDENTITY_UNVERIFIABLE");
  assert.equal(r.witnesses.external_ticker_ok, null);
  assert.equal(r.external_winner, null, "no outcome is adopted from a market that names no ticker");
});

test("R5d: payload carries neither ticker nor close → EXTERNAL_IDENTITY_UNVERIFIABLE", () => {
  const r = classifyReconciliation(win({}), ok(market({ ticker: undefined, close_time: undefined })));
  assert.equal(r.winner_class, "EXTERNAL_IDENTITY_UNVERIFIABLE");
});

test("R5e: expiration_time is NOT a close witness — a payload whose only time is a contradicting expiration_time is not a mismatch, and matches on the exact ticker", () => {
  // close_time absent, expiration_time wildly different. If expiration_time were
  // (wrongly) used as the close, this would be EXTERNAL_IDENTITY_MISMATCH.
  const r = classifyReconciliation(win({}), ok(market({ close_time: undefined, expiration_time: "2026-09-11T23:30:00Z" })));
  assert.equal(r.winner_class, "MATCH", "expiration_time is ignored; the exact ticker's encoded close is the witness");
  assert.equal(r.witnesses.external_close_ok, null, "no external close witness was established");
});

test("R5f: exact payload ticker with absent close_time → MATCH via the internal ticker-close witness", () => {
  const r = classifyReconciliation(win({}), ok(market({ close_time: undefined })));
  assert.equal(r.winner_class, "MATCH");
  assert.equal(r.witnesses.external_ticker_ok, true);
  assert.equal(r.witnesses.external_close_ok, null);
});

test("R5g: unparseable internal ticker + absent external close_time → EXTERNAL_IDENTITY_UNVERIFIABLE (fail closed, no witness of either kind)", () => {
  const U = "RENAMEDSERIES"; // carries no embedded close
  const r = classifyReconciliation(win({ ticker: U }), ok(market({ ticker: U, close_time: undefined })));
  assert.equal(r.witnesses.ticker_embedded_close_ok, null, "the internal ticker does not parse");
  assert.equal(r.winner_class, "EXTERNAL_IDENTITY_UNVERIFIABLE");
});

test("R6: official source says not settled → EXTERNAL_UNSETTLED, not a mismatch", () => {
  const r = classifyReconciliation(win({}), ok({ ticker: T, close_time: Ciso, status: "active" }));
  assert.equal(r.winner_class, "EXTERNAL_UNSETTLED");
});

test("R7: API unavailable (timeout/429/5xx) → EXTERNAL_UNAVAILABLE, not a mismatch", () => {
  assert.equal(classifyReconciliation(win({}), { ok: false, reason: "unavailable" }).winner_class, "EXTERNAL_UNAVAILABLE");
  assert.equal(classifyReconciliation(win({}), { ok: false, reason: "not_found" }).winner_class, "EXTERNAL_UNAVAILABLE");
});

test("R8: external exists but internal winner absent → INTERNAL_OUTCOME_MISSING", () => {
  const r = classifyReconciliation(win({ winner: "WAIT" }), ok(market({ result: "yes" })));
  assert.equal(r.winner_class, "INTERNAL_OUTCOME_MISSING");
});

test("R9: official underlying value match (only when external exposes a value)", () => {
  // Within the repo's 0.05 tolerance: a 0.02 gap is a MATCH, and external_value is
  // the payload's value, never ours.
  const r = classifyReconciliation(win({ winner: "UP", official_value: 64000.38 }), ok(market({ result: "yes", expiration_value: 64000.4 })));
  assert.equal(r.winner_class, "MATCH");
  assert.equal(r.value_class, "OFFICIAL_VALUE_MATCH");
  assert.equal(r.external_value, 64000.4);
});

test("R10: official underlying value mismatch", () => {
  const r = classifyReconciliation(win({ winner: "UP", official_value: 64000 }), ok(market({ result: "yes", expiration_value: 64050 })));
  assert.equal(r.value_class, "OFFICIAL_VALUE_MISMATCH");
});

test("R11: winner verifiable but external underlying absent → value UNVERIFIABLE", () => {
  const r = classifyReconciliation(win({ winner: "UP", official_value: 64000 }), ok(market({ result: "yes", expiration_value: undefined })));
  assert.equal(r.winner_class, "MATCH");
  assert.equal(r.value_class, "OFFICIAL_VALUE_UNVERIFIABLE");
  assert.equal(r.external_value, null);
});

test("R11b: external value present but we never recorded one → UNVERIFIABLE, never derived from our side", () => {
  const r = classifyReconciliation(win({ winner: "UP", official_value: null }), ok(market({ result: "yes", expiration_value: 64000 })));
  assert.equal(r.value_class, "OFFICIAL_VALUE_UNVERIFIABLE");
});

// Official-value tolerance is the repo's established 0.05 (lab.server.ts), not a
// looser invention. These pin both sides of the boundary without rounding.
test("R9-tol-a: official value gap 0.04 (< 0.05) → OFFICIAL_VALUE_MATCH", () => {
  const r = classifyReconciliation(win({ winner: "UP", official_value: 64000 }), ok(market({ result: "yes", expiration_value: 64000.04 })));
  assert.equal(r.value_class, "OFFICIAL_VALUE_MATCH");
});

test("R9-tol-b: official value gap 0.05 → OFFICIAL_VALUE_MATCH (the boundary is inclusive, <= 0.05)", () => {
  const r = classifyReconciliation(win({ winner: "UP", official_value: 64000.05 }), ok(market({ result: "yes", expiration_value: 64000.1 })));
  assert.equal(r.value_class, "OFFICIAL_VALUE_MATCH");
});

test("R9-tol-c: official value gap 0.06 (> 0.05) → OFFICIAL_VALUE_MISMATCH", () => {
  const r = classifyReconciliation(win({ winner: "UP", official_value: 64000 }), ok(market({ result: "yes", expiration_value: 64000.06 })));
  assert.equal(r.value_class, "OFFICIAL_VALUE_MISMATCH");
});

test("R9-tol-d: a materially different official value → OFFICIAL_VALUE_MISMATCH", () => {
  const r = classifyReconciliation(win({ winner: "UP", official_value: 64000 }), ok(market({ result: "yes", expiration_value: 64050 })));
  assert.equal(r.value_class, "OFFICIAL_VALUE_MISMATCH");
});

test("R12: external truth is the fixture, not the ledger — mutating our winner changes only our side", () => {
  const ext = ok(market({ result: "yes" })); // official = UP, fixed
  const asUp = classifyReconciliation(win({ winner: "UP" }), ext);
  const asDown = classifyReconciliation(win({ winner: "DOWN" }), ext);
  assert.equal(asUp.external_winner, "UP");
  assert.equal(asDown.external_winner, "UP", "external winner is unchanged by our ledger value");
  assert.equal(asUp.winner_class, "MATCH");
  assert.equal(asDown.winner_class, "WINNER_MISMATCH");
});

test("R13: exact neighbouring windows cannot cross-match", async () => {
  const T2 = "KXBTC15M-26SEP111815-00"; // 22:15Z
  const C2 = C + 900_000;
  const rows: LedgerWindow[] = [win({ winner: "UP" }), win({ ticker: T2, close_time_ms: C2, winner: "DOWN" })];
  // Each ticker fetches its OWN market; a correct feed returns the matching market.
  const fetchMarket = async (t: string): Promise<FetchOutcome> =>
    t === T
      ? ok(market({ ticker: T, result: "yes", close_time: Ciso }))
      : ok(market({ ticker: T2, result: "no", close_time: "2026-09-11T22:15:00Z" }));
  const res = await reconcileWindows(rows, fetchMarket, { concurrency: 2 });
  assert.equal(res[0]!.winner_class, "MATCH");
  assert.equal(res[1]!.winner_class, "MATCH");
  // And if the feed mistakenly returns window-1's market for window-2, identity catches it.
  const crossed = await reconcileWindows([win({ ticker: T2, close_time_ms: C2, winner: "DOWN" })], async () => ok(market({ ticker: T, close_time: Ciso })), {});
  assert.equal(crossed[0]!.winner_class, "EXTERNAL_IDENTITY_MISMATCH");
});

test("R14: one official result does not validate a duplicate ticker across many closes (2026-09-10 block)", async () => {
  const D = "KXBTC15M-26SEP100300-00"; // encodes 2026-09-10 03:00 ET = 07:00Z
  const c0700 = Date.parse("2026-09-10T07:00:00Z");
  const rows: LedgerWindow[] = [
    win({ ticker: D, close_time_ms: c0700, winner: "UP" }), // the one legitimate market
    win({ ticker: D, close_time_ms: c0700 + 900_000, winner: "UP" }), // 07:15 — stale ticker
    win({ ticker: D, close_time_ms: c0700 + 1_800_000, winner: "UP" }), // 07:30 — stale ticker
  ];
  // The official market for D is the 07:00 market (UP). It must NOT validate the others.
  const fetchMarket = async (): Promise<FetchOutcome> => ok({ ticker: D, result: "yes", close_time: "2026-09-10T07:00:00Z", status: "settled" });
  const res = await reconcileWindows(rows, fetchMarket, {});
  assert.equal(res[0]!.winner_class, "MATCH", "the 07:00 window legitimately matches");
  assert.equal(res[1]!.winner_class, "TICKER_CLOSE_MISMATCH", "07:15 is internally invalid, not validated by the 07:00 result");
  assert.equal(res[2]!.winner_class, "TICKER_CLOSE_MISMATCH", "07:30 likewise");
  const s = summarize(res);
  assert.equal(s.winner_matches, 1);
  assert.equal(s.identity_invalid, 2);
});

test("R16: a transport failure is never counted as externally verified (no silent pass)", () => {
  // An unreachable API is absence of evidence, not a verdict: it must not inflate
  // the verified count, and it is never a match or a mismatch.
  const s = summarize([
    classifyReconciliation(win({}), { ok: false, reason: "unavailable" }),
    classifyReconciliation(win({}), { ok: false, reason: "not_found" }),
  ]);
  assert.equal(s.externally_verified, 0, "unavailable rows are not verified");
  assert.equal(s.winner_matches, 0);
  assert.equal(s.winner_mismatches, 0);
  assert.equal(s.external_unavailable, 2);
});

test("R15: the runner performs reads only — no write hook is reachable", async () => {
  // The pure runner receives an injected fetchMarket and returns results; it has no
  // DB handle and cannot write. We assert it only ever READS via fetchMarket.
  let calls = 0;
  const fetchMarket = async (): Promise<FetchOutcome> => {
    calls++;
    return ok(market({}));
  };
  await reconcileWindows([win({})], fetchMarket, {});
  assert.equal(calls, 1, "exactly one external read for one valid window; no other I/O");
});

test("an internally-invalid or winner-missing row is never fetched (no external query wasted or trusted)", async () => {
  let calls = 0;
  const fetchMarket = async (): Promise<FetchOutcome> => {
    calls++;
    return ok(market({}));
  };
  const rows: LedgerWindow[] = [
    win({ close_time_ms: C + 900_000 }), // stale ticker → invalid
    win({ winner: "WAIT" }), // missing our outcome
  ];
  const res = await reconcileWindows(rows, fetchMarket, {});
  assert.equal(calls, 0, "neither invalid nor outcome-missing rows hit the external API");
  assert.equal(res[0]!.winner_class, "TICKER_CLOSE_MISMATCH");
  assert.equal(res[1]!.winner_class, "INTERNAL_OUTCOME_MISSING");
});

test("CLI report: renderReconReport emits a machine-readable JSON line then evidence for every non-MATCH", () => {
  const results = [
    classifyReconciliation(win({ winner: "UP" }), ok(market({ result: "yes" }))), // MATCH
    classifyReconciliation(win({ winner: "UP" }), ok(market({ result: "no" }))), // WINNER_MISMATCH
    classifyReconciliation(win({ winner: "UP" }), { ok: false, reason: "unavailable" }), // EXTERNAL_UNAVAILABLE
  ];
  const report: ReconReport = {
    period_days: 90,
    earliest_ms: C,
    latest_ms: C,
    summary: summarize(results),
    results,
  };
  const text = renderReconReport(report);
  const [first, ...rest] = text.split("\n");

  // (1) first line is the whole report as parseable JSON.
  const parsed = JSON.parse(first!) as ReconReport;
  assert.equal(parsed.summary.winner_matches, 1);
  assert.equal(parsed.summary.winner_mismatches, 1);
  assert.equal(parsed.summary.external_unavailable, 1);
  assert.equal(parsed.results.length, 3);

  // (2) evidence lines carry the exact note for each non-MATCH outcome, and none
  // for the MATCH.
  const body = rest.join("\n");
  assert.ok(body.includes("WINNER_MISMATCH"), "the mismatch is reported with evidence");
  assert.ok(body.includes("EXTERNAL_UNAVAILABLE"), "the unavailable row is reported");
  assert.ok(!/\bMATCH\b\t/.test(body), "the clean MATCH is not listed as a failure");
});

// ---------------------------------------------------------------------------
// S2-7A — transport hardening (pacing + bounded retries). The HTTP attempt and
// the sleep are injected, so these never touch the network and never wait.
// ---------------------------------------------------------------------------

const HOSTS = ["https://a.example/trade-api/v2", "https://b.example/trade-api/v2", "https://c.example/trade-api/v2"];
const settled = (): OfficialMarket => market({ result: "yes" });

/** An injected attempt that replays a sequence (repeating the last entry) and records URLs. */
function attemptsFrom(seq: MarketAttempt[]) {
  const urls: string[] = [];
  let i = 0;
  const attempt = async (url: string): Promise<MarketAttempt> => {
    urls.push(url);
    return seq[Math.min(i++, seq.length - 1)]!;
  };
  return { attempt, urls };
}
function recordSleep() {
  const calls: number[] = [];
  return { calls, sleep: async (ms: number): Promise<void> => void calls.push(ms) };
}

test("T1: one 200 succeeds immediately — no retry, no sleep", async () => {
  const { attempt, urls } = attemptsFrom([{ status: "ok", market: settled() }]);
  const { calls, sleep } = recordSleep();
  const r = await fetchMarketViaHosts(HOSTS, T, { attempt, sleep });
  assert.equal(r.ok, true);
  assert.equal(urls.length, 1);
  assert.equal(calls.length, 0, "no backoff on a clean success");
});

test("T2: 429 then 200 succeeds after one retry", async () => {
  const { attempt, urls } = attemptsFrom([{ status: "retryable", retryAfterMs: null }, { status: "ok", market: settled() }]);
  const { calls, sleep } = recordSleep();
  const r = await fetchMarketViaHosts(HOSTS, T, { attempt, sleep });
  assert.equal(r.ok, true);
  assert.equal(urls.length, 2);
  assert.equal(calls.length, 1, "one backoff between the two attempts");
  assert.equal(calls[0], 400, "first backoff is the base");
});

test("T3: Retry-After is honored (sleeps the server-provided delay)", async () => {
  const { attempt } = attemptsFrom([{ status: "retryable", retryAfterMs: 1500 }, { status: "ok", market: settled() }]);
  const { calls, sleep } = recordSleep();
  const r = await fetchMarketViaHosts(HOSTS, T, { attempt, sleep });
  assert.equal(r.ok, true);
  assert.deepEqual(calls, [1500], "the Retry-After value is slept, not the exponential default");
});

test("T4: 503 then 200 succeeds after retry", async () => {
  const { attempt } = attemptsFrom([{ status: "retryable", retryAfterMs: null }, { status: "ok", market: settled() }]);
  const { calls, sleep } = recordSleep();
  const r = await fetchMarketViaHosts(HOSTS, T, { attempt, sleep });
  assert.equal(r.ok, true);
  assert.equal(calls.length, 1);
});

test("T5: timeout/network then 200 succeeds after retry", async () => {
  const { attempt } = attemptsFrom([{ status: "retryable", retryAfterMs: null }, { status: "ok", market: settled() }]);
  const { calls, sleep } = recordSleep();
  const r = await fetchMarketViaHosts(HOSTS, T, { attempt, sleep });
  assert.equal(r.ok, true);
  assert.equal(calls.length, 1);
});

test("T6: repeated transient failure returns EXTERNAL_UNAVAILABLE, bounded, with exponential backoff", async () => {
  const { attempt, urls } = attemptsFrom([{ status: "retryable", retryAfterMs: null }]); // always transient
  const { calls, sleep } = recordSleep();
  const r = await fetchMarketViaHosts(HOSTS, T, { attempt, sleep });
  assert.equal(r.ok, false);
  assert.equal((r as { reason: string }).reason, "unavailable");
  assert.equal(urls.length, 3, "total attempts are bounded (default 3 per market)");
  assert.deepEqual(calls, [400, 800], "exponential backoff between attempts, none after the last");
});

test("T6b: backoff is capped", async () => {
  const { attempt } = attemptsFrom([{ status: "retryable", retryAfterMs: null }]);
  const { calls, sleep } = recordSleep();
  await fetchMarketViaHosts(HOSTS, T, { attempt, sleep }, { maxAttempts: 5, baseBackoffMs: 1000, maxBackoffMs: 3000 });
  assert.deepEqual(calls, [1000, 2000, 3000, 3000], "doubling, then held at the cap");
});

test("T7: a 404 does not spin — bounded host rotation, no backoff, returns not_found", async () => {
  const { attempt, urls } = attemptsFrom([{ status: "not_found" }]); // every host 404s
  const { calls, sleep } = recordSleep();
  const r = await fetchMarketViaHosts(HOSTS, T, { attempt, sleep });
  assert.equal(r.ok, false);
  assert.equal((r as { reason: string }).reason, "not_found");
  assert.equal(urls.length, 3, "tried each host once, no indefinite retry");
  assert.equal(calls.length, 0, "a 404 is never backed off");
});

test("T8: the exact market endpoint is unchanged and hosts rotate — no query, no history path", async () => {
  const { attempt, urls } = attemptsFrom([{ status: "retryable", retryAfterMs: null }]);
  const { sleep } = recordSleep();
  await fetchMarketViaHosts(HOSTS, T, { attempt, sleep });
  assert.equal(urls[0], `${HOSTS[0]}/markets/${encodeURIComponent(T)}`);
  assert.equal(urls[1], `${HOSTS[1]}/markets/${encodeURIComponent(T)}`, "attempts rotate across hosts");
  assert.equal(urls[2], `${HOSTS[2]}/markets/${encodeURIComponent(T)}`);
  for (const u of urls) {
    assert.ok(u.endsWith(`/markets/${encodeURIComponent(T)}`), "exact /markets/{ticker} endpoint");
    assert.ok(!u.includes("?"), "no query string");
    assert.ok(!/history|historical|settlements?/.test(u), "never a historical endpoint");
  }
});

test("parseRetryAfterMs: delta-seconds, HTTP-date, and junk", () => {
  assert.equal(parseRetryAfterMs("2", 0), 2000);
  assert.equal(parseRetryAfterMs("0", 0), 0);
  assert.equal(parseRetryAfterMs(null, 0), null);
  assert.equal(parseRetryAfterMs("", 0), null);
  assert.equal(parseRetryAfterMs("soon", 0), null);
  const now = Date.parse("2026-09-12T00:00:00Z");
  const ms = parseRetryAfterMs(new Date(now + 5000).toUTCString(), now);
  assert.ok(ms !== null && ms >= 4000 && ms <= 6000, "HTTP-date resolves to ~5s ahead");
});

test("reconcileWindows defaults to sequential (concurrency 1) and paces between fetches", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const { calls, sleep } = recordSleep();
  const fetchMarket = async (): Promise<FetchOutcome> => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await Promise.resolve(); // yield so overlapping workers (if any) would be observed
    inFlight -= 1;
    return { ok: true, market: settled() };
  };
  const rows: LedgerWindow[] = [win({}), win({}), win({})];
  await reconcileWindows(rows, fetchMarket, { sleep });
  assert.equal(maxInFlight, 1, "default concurrency is 1 — no overlapping external requests");
  assert.equal(calls.length, 2, "paced between the 3 fetches (no delay before the first)");
  assert.ok(calls.every((ms) => ms === INTER_MARKET_DELAY_MS_DEFAULT), "default inter-market spacing");
});

test("reconcileWindows does not pace for skipped (not-fetched) rows", async () => {
  const { calls, sleep } = recordSleep();
  let fetches = 0;
  const fetchMarket = async (): Promise<FetchOutcome> => {
    fetches += 1;
    return { ok: true, market: settled() };
  };
  const rows: LedgerWindow[] = [
    win({ close_time_ms: C + 900_000 }), // stale ticker → skipped, not fetched
    win({}), // fetched (first real fetch, no leading pace)
    win({}), // fetched (paced once)
  ];
  await reconcileWindows(rows, fetchMarket, { sleep });
  assert.equal(fetches, 2, "only the two valid rows are fetched");
  assert.equal(calls.length, 1, "one pace between the two real fetches; the skip costs none");
});
