/** The YES-path horizon study, admin-key only.
 *
 *  THE FINDING. Four modules read `snap.yes_mid_path` at fixed ARRAY OFFSETS —
 *  4, 6 and 10 slots back — and label the results d30, d60 and d120. Mind the gap
 *  count: the anchor is index `length - back` and the newest is `length - 1`, so
 *  `back` slots back crosses `back - 1` GAPS, implying three different sample
 *  intervals (30/3 = 10s, 60/5 = 12s, 120/9 = 13.3s). The array itself is normally
 *  built from Kalshi candlesticks at period_interval=1, ONE MINUTE per slot, so under
 *  normal conditions "d30" spans three minutes, "d60" five and "d120" nine — 6x, 5x
 *  and 4.5x their labels. On the rarer per-tick fallback the same offsets span 12, 20
 *  and 36 seconds at the standard 4s cadence, so one named quantity ranges about 15x
 *  (the ratio of the slot widths). The labels are not approximate; they name
 *  materially different horizons.
 *
 *  THREE SEPARATE QUESTIONS, REPORTED SEPARATELY. They are independent, and collapsing
 *  them is how "span_ms is 60000" becomes the false claim "this is the last 60 seconds":
 *
 *    (1) SPAN COVERAGE — was there an anchor at least the requested interval behind the
 *        newest point? -> true_state / coverage_ok / overshoot_ms. A 30s request on
 *        1-minute candles can only land on a 60s span (100% overshoot), so 30s is NOT
 *        EXACTLY REPRESENTABLE on a pure 1-minute grid. A coarse historical
 *        approximation does exist; it simply is not a faithful 30-second
 *        decision-time measurement. 60s and 120s divide the grid, so their SPAN is
 *        exact — which settles nothing about (2) or (3).
 *
 *    (2) ENDPOINT FRESHNESS — how stale was the newest point versus the decision tick?
 *        -> newest_age_ms. The reading ends at the newest SAMPLE, not at now.
 *
 *    (3) DECISION-HORIZON FIDELITY — does the row actually cover
 *        `as_of - horizon -> as_of`, or an older interval of the right length?
 *        -> anchor_age_ms / decision_overshoot_ms / decision_fidelity.
 *
 *  THE CASE THAT FORCES (3). Newest candle 45s old, anchor 60s behind it: span_ms is
 *  60000 and overshoot_ms is 0, which looks exact, but the interval measured is about
 *  t-105s to t-45s. Zero span overshoot must never be read as exact horizon coverage.
 *  Identities: anchor_age_ms = newest_age_ms + span_ms, and
 *  decision_overshoot_ms = newest_age_ms + overshoot_ms.
 *
 *  NO FRESHNESS CUTOFF IS CHOSEN. `decision_fidelity` is structural — does the interval
 *  end at the decision moment, before it, or after it — not tuned. Magnitudes are
 *  reported so a reader decides later what is tolerable. Nothing here is corrected.
 *
 *  WHAT THIS REPORTS. Per horizon, prospectively: what production reads, what the
 *  clock says, the signed and absolute divergence, how often each was even
 *  available, what the offset actually spanned, and the source mix behind it.
 *
 *  THREE OUTCOMES, THREE BUCKETS. "0", null and NaN are never collapsed, because
 *  they mean different things operationally: `legacy_short_path` is production's
 *  `: 0` branch, which consumers receive and act on as a real number;
 *  `legacy_non_finite` is a NaN, which reads downstream as a QUIET TAPE rather than
 *  as an error, because `Math.abs(NaN) >= k` is false. A non-zero non-finite count
 *  is a separate defect worth knowing about — reported here, deliberately not fixed
 *  in the change that added this measurement.
 *
 *  MEASUREMENT ONLY. No seat, DSL rule, threshold, Chair input, learned weight or
 *  skill status reads any of it, and no consumer was changed. Migrating them would
 *  redefine every calibration record fitted against the old numbers, so that is a
 *  separate decision with its own research-era boundary, and this endpoint exists
 *  so that decision can rest on a distribution instead of an example.
 *
 *  Read-only research on a paper-only desk. Wrong or missing key → 404. */
export default async function pathParity(event: { url: URL; req: { headers: Headers } }) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  try {
    const { adminKeyOk } = await import("../../src/lib/desk/admin.server");
    const key = event.url.searchParams.get("key") ?? event.req.headers.get("x-desk-admin") ?? "";
    if (!adminKeyOk(key)) return new Response("not found", { status: 404 });

    const { parityStanding, PATH_RESEARCH_VERSION } = await import(
      "../../src/lib/desk/path-parity.server"
    );
    const { HORIZONS } = await import("../../src/lib/desk/path-time");

    const days = Math.min(365, Math.max(1, Number(event.url.searchParams.get("days") ?? 30) || 30));
    const rows = await parityStanding(days);
    const nonFinite = rows.reduce((a, r) => a + r.legacy_non_finite, 0);

    return json({
      at: new Date().toISOString(),
      research_version: PATH_RESEARCH_VERSION,
      days,
      // Stated rather than implied: this endpoint measures, and the consumer
      // migration is a separate, later decision. Nothing here changes a reading.
      authority: { changes_nothing: true, paper_only: true, consumers_unchanged: true },
      horizons: HORIZONS,
      // THE counter: how often the DSL-facing value is non-finite, which downstream
      // reads as a quiet tape rather than as an error.
      legacy_non_finite_total: nonFinite,
      // Stated on the response so nobody reads a zero span overshoot as exact horizon
      // coverage: these three are independent and each row answers all three.
      reads_as: {
        span_coverage: "true_state / coverage_ok / overshoot_ms",
        endpoint_freshness: "newest_age_ms",
        decision_horizon_fidelity: "anchor_age_ms / decision_overshoot_ms / decision_fidelity",
        note: "overshoot_ms = 0 means the SPAN matched the request, not that the interval ended at as_of",
      },
      rows,
    });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
