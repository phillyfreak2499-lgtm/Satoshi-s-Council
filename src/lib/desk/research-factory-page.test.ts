import assert from "node:assert/strict";
import test from "node:test";
import { MAX_RAW_CHARS, esc, renderResearchPage, type PageInput, type StoredReport } from "./research-factory-page.ts";

const rep = (report_kind: string, payload: unknown, extra: Partial<StoredReport> = {}): StoredReport => ({ report_kind, report_key: "latest", report_version: 1, payload, created_at: "2026-09-28 17:00:00+00", build_sha: "abcdef1234", ...extra });
const base = (extra: Partial<PageInput> = {}): PageInput => ({
  generated_at: "2026-09-28T17:30:00.000Z",
  overview: {
    health: { enabled: true, running: true, completed: 12, paused: 1, error: null, last_guard: null },
    decision_tape: { enabled: true, running: true, written: 40, error: null },
    book_depth: { enabled: false, running: false, written: 0, book_missing: 0, error: null },
    trade_flow: { enabled: true, running: true, venues: { COINBASE_SPOT: { written: 120, gaps: 1, halted: null }, OKX_PERP: { written: 0, gaps: 0, halted: "CONTRACT_SPEC_MISMATCH" } }, error: null },
    wick_shadow: { enabled: true, running: true, written: 8, fired: 2, error: "boom" },
    jobs: [{ job_kind: "window", status: "complete", n: 30 }, { job_kind: "rollup", status: "failed", n: 1 }],
    recent_failures: [{ job_kind: "rollup", job_key: "2026-09-28T16", attempts: 3, error: "db down", updated_at: "x" }],
    authority: { production_authority: "NONE", auto_promotion: false, paid_apis: "none" },
  },
  latest: [], digest: null, ...extra,
});

test("every database value is escaped: a hostile payload cannot inject markup or script", () => {
  const evil = "</pre></details><script>alert(1)</script><img src=x onerror=alert(2)>";
  const html = renderResearchPage(base({
    latest: [rep(`kind${evil}`, { note: evil }), rep("lifecycle", { rows: [{ experiment: evil, arm: evil, status: evil, current_sample: {}, current_result: {} }] })],
    overview: { ...base().overview, wick_shadow: { enabled: true, error: evil } },
  }));
  assert.equal(/<script/i.test(html), false, "no script element");
  assert.equal(/<img/i.test(html), false, "no injected element");
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.equal(esc(`"'<>&`), "&quot;&#39;&lt;&gt;&amp;");
});

test("static and self-contained: no script, no external resource, not indexable", () => {
  const html = renderResearchPage(base());
  assert.equal(/<script|<link |<iframe|src=|https?:\/\//i.test(html), false);
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
  assert.match(html, /@media \(prefers-color-scheme:dark\)/);
  assert.match(html, /production authority NONE/);
});

test("empty factory: every section still renders and says what is missing", () => {
  const html = renderResearchPage(base());
  for (const h of ["Collectors and factory", "Experiments: lifecycle", "Evidence safety", "Instrument tests", "All reports", "JSON routes"]) assert.ok(html.includes(h), h);
  assert.ok(html.includes("no lifecycle report yet"));
  assert.ok(html.includes("No reports yet"));
  assert.ok(html.includes("CONTRACT_SPEC_MISMATCH"), "a halted venue is shown");
  assert.ok(html.includes("db down"), "recent failures are shown");
  assert.ok(html.includes("boom"), "a collector error is shown");
});

test("headlines: lifecycle, evidence safety and instrument verdicts come from the stored reports", () => {
  const html = renderResearchPage(base({ latest: [
    rep("lifecycle", { rows: [{ experiment: "MID_RECOVERY_LOCKS_V2_INACTIVE", arm: "BAR_NO_SITMASS", status: "COLLECTING", promotion_eligible: false, flag_for_human_review: true,
      current_sample: { observed_windows: 44, fills: 7, clean_settled_fills: 6, suspect_fills: 1, invalid_fills: 0 },
      current_result: { win_rate_pct: 83.3, win_rate_ci95: { lo: 43.6, hi: 97 }, breakeven_win_rate_pct: 86.2, net_cents: -12.5 }, matched_null_fav: { net_cents: 4 } }] }),
    rep("evidence_safety", { question: "Which existing recovery results are safe enough to use as evidence?", rows: [{ experiment: "MID_RECOVERY_LOCKS_V1_INACTIVE", arm: "CONTROL", safe_to_use: "CLEAN_SUBSET_ONLY", fills: 5, evidence_grade_fills: 3, receipt_statuses: { SUSPECT: 2 }, top_reasons: [{ code: "P2_LIVE_CARD_NOT_SELECTED", n: 2 }] }] }),
    rep("trade_flow", { h0: { verdict: "INSUFFICIENT_SAMPLE", clean_observations: 41, h0: { id: "TRADE_FLOW_H0_V1", min_clean_observations: 300 } } }),
    rep("wick_shadow", { h0: { verdict: "RETIRE_CANDIDATE", clean_observations: 320, fires: 44, h0: { id: "WICK_EFFORT_RESULT_H0_V1", min_clean_observations: 300 } } }),
    rep("research_summary", { current_bottleneck: { blocker: "CONFIRMATION_INCOMPLETE" }, honesty: { rule: "EXPLORATORY findings can earn a frozen prospective test" } }),
    rep("utilization", { jobs: 30, cpu_ms: 1234, research_compute_utilization: 0.004, peak_rss_mb: 210, resource_guard_pauses: {}, note: "upper bound" }),
  ], digest: rep("daily_digest", { day: "2026-09-27" }, { report_key: "2026-09-27" }) }));
  for (const s of ["BAR_NO_SITMASS", "83.3%", "[43.6–97]", "86.2%", "-12.5", ">review<", "CLEAN_SUBSET_ONLY", "P2_LIVE_CARD_NOT_SELECTED ×2",
    "41 / 300", "TRADE_FLOW_H0_V1", "RETIRE_CANDIDATE", "320 / 300 · 44 fires", "CONFIRMATION_INCOMPLETE", "Latest daily digest (2026-09-27)", "Research compute", "abcdef1"]) assert.ok(html.includes(s), s);
  assert.match(html, /<span class="badge bad">RETIRE_CANDIDATE<\/span>/);
  assert.match(html, /<span class="badge warn">CLEAN_SUBSET_ONLY<\/span>/);
  assert.match(html, /<span class="badge good">COLLECTING<\/span>/);
  assert.ok(html.includes("Kalshi book depth") && html.includes("no report yet"), "a missing instrument report is shown as missing");
});

test("one huge report is cut, not allowed to swamp the page", () => {
  const html = renderResearchPage(base({ latest: [rep("pockets", { blob: "x".repeat(MAX_RAW_CHARS * 2) })] }));
  assert.ok(html.length < MAX_RAW_CHARS * 1.2);
  assert.ok(html.includes("cut at 200,000 characters"));
});
