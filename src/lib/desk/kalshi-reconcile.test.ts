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
  reconcileWindows,
  summarize,
  type FetchOutcome,
  type LedgerWindow,
  type OfficialMarket,
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
  const r = classifyReconciliation(win({ winner: "UP", official_value: 64000.2 }), ok(market({ result: "yes", expiration_value: 64000.4 })));
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
