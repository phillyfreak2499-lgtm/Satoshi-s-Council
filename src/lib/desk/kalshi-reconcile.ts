/**
 * S2-7 — independent historical reconciliation (pure; no DB, no network, no feed).
 *
 * THE QUESTION. For each historical paper window, does the exact market identity
 * and outcome the LEDGER recorded agree with the OFFICIAL Kalshi record for that
 * exact market? The authoritative side is fetched independently from Kalshi; the
 * ledger only supplies the thing being audited (ticker, close_time, our winner,
 * our official value). This module NEVER treats a ledger-derived field as the
 * external truth.
 *
 * TWO SEPARATE QUESTIONS, never collapsed:
 *   A. the binary market OUTCOME  (our winner vs Kalshi's settled result)
 *   B. the official UNDERLYING value (our official_value vs Kalshi expiration_value),
 *      and only when Kalshi actually exposes a trustworthy value — otherwise
 *      UNVERIFIABLE. A binary winner is never proof of an exact underlying value.
 *
 * IDENTITY IS EXACT, and fails closed. Every comparison is keyed by the exact
 * market: ticker AND close_time. It reuses the repo's window-identity invariant
 * (tickerAgrees / tickerCloseMs / CLOSE_TOLERANCE_MS) — never ticker-only, never
 * close-only, never nearest/latest, never ±15-minute guessing. A stale-ticker row
 * whose embedded close contradicts its own close is declared internally invalid;
 * it is NOT rescued by any official result (the 2026-09-10 duplicate-ticker block).
 *
 * Transport failures are NOT mismatches; missing external evidence is NOT a match.
 */
import { CLOSE_TOLERANCE_MS, tickerAgrees } from "./window-identity.ts";

/** The internal window under audit, read from desk_ledger (SELECT only). */
export type LedgerWindow = {
  ticker: string;
  close_time_ms: number;
  /** desk_ledger.winner — our graded outcome. "UP"/"DOWN", or anything else = absent. */
  winner: string;
  /** desk_ledger.official_value — our recorded official underlying, or null. */
  official_value: number | null;
};

/** The Kalshi public market payload (subset of KalshiMarketRow + status). Provider-origin. */
export type OfficialMarket = {
  ticker?: string;
  result?: string;
  settlement_value?: string | number;
  settlement_ts?: string;
  close_time?: string;
  expiration_time?: string;
  expiration_value?: string | number;
  status?: string;
};

/**
 * The transport result for one ticker. A failure (timeout/429/5xx/not-found) is a
 * distinct outcome, never folded into a mismatch. `not_found` means the market does
 * not exist at Kalshi; `unavailable` means we could not get a trustworthy answer.
 */
export type FetchOutcome =
  | { ok: true; market: OfficialMarket }
  | { ok: false; reason: "unavailable" | "not_found" };

/**
 * The result of ONE HTTP attempt against one host, as the server's transport edge
 * reports it. `retryable` folds 429 / 5xx / timeout / network / malformed together
 * (the thing to back off and try again); `not_found` is a 404 (rotate hosts, never
 * back off); `ok` carries the parsed market. `retryAfterMs` is the server-parsed
 * `Retry-After`, in ms, when the response carried one.
 */
export type MarketAttempt =
  | { status: "ok"; market: OfficialMarket }
  | { status: "not_found" }
  | { status: "retryable"; retryAfterMs: number | null };

/** Conservative transport defaults for the MANUAL auditor — deliberately gentle so a
 *  bulk run never bursts into Kalshi's rate limiter. */
export const RECONCILE_CONCURRENCY_DEFAULT = 1;
export const INTER_MARKET_DELAY_MS_DEFAULT = 150;
export const MAX_ATTEMPTS_PER_MARKET_DEFAULT = 3; // total attempts across hosts, per market
export const BASE_BACKOFF_MS_DEFAULT = 400;
export const MAX_BACKOFF_MS_DEFAULT = 8_000;
/** Honor `Retry-After`, but never stall the auditor on a pathological value. */
export const RETRY_AFTER_CAP_MS = 60_000;

export type FetchPacing = {
  maxAttempts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
};

/** The injected edges the pure orchestrator needs: one HTTP attempt, and a sleep. */
export type FetchDeps = {
  attempt: (url: string) => Promise<MarketAttempt>;
  sleep: (ms: number) => Promise<void>;
};

/**
 * Parse a `Retry-After` header value to ms, or null. Kalshi (and HTTP) allow either
 * delta-seconds (`"2"`) or an HTTP-date. Pure: the caller supplies `nowMs` so the
 * date form is deterministic and testable. A non-finite/negative result is null.
 */
export function parseRetryAfterMs(value: string | null | undefined, nowMs: number): number | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (s === "") return null;
  if (/^\d+$/.test(s)) return Number(s) * 1000;
  const at = Date.parse(s);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, at - nowMs);
}

/**
 * Fetch ONE market by exact ticker, conservatively. A bounded TOTAL attempt budget
 * (default 3) rotates across the hosts — so failover is preserved without turning a
 * failure into an immediate all-hosts request storm — backing off between transient
 * attempts (honoring `Retry-After`, else exponential with a cap). A 404 rotates hosts
 * within the budget but never backs off and never spins. When the budget is spent the
 * outcome is `unavailable` (or `not_found` if every attempt was a 404). Pure: the HTTP
 * attempt and the sleep are injected, so tests drive it with fixtures and never wait.
 */
export async function fetchMarketViaHosts(
  hosts: readonly string[],
  ticker: string,
  deps: FetchDeps,
  opts: FetchPacing = {},
): Promise<FetchOutcome> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? MAX_ATTEMPTS_PER_MARKET_DEFAULT);
  const base = opts.baseBackoffMs ?? BASE_BACKOFF_MS_DEFAULT;
  const cap = opts.maxBackoffMs ?? MAX_BACKOFF_MS_DEFAULT;
  const ring = hosts.length > 0 ? hosts : [""];
  let sawNotFound = false;
  for (let i = 0; i < maxAttempts; i += 1) {
    const host = ring[i % ring.length]!;
    const url = `${host}/markets/${encodeURIComponent(ticker)}`;
    const r = await deps.attempt(url);
    if (r.status === "ok") return { ok: true, market: r.market };
    if (r.status === "not_found") {
      sawNotFound = true;
      continue; // rotate to the next host; a 404 is never retried with backoff
    }
    // retryable: back off before the next attempt, unless the budget is spent.
    if (i < maxAttempts - 1) {
      const backoff =
        r.retryAfterMs != null
          ? Math.min(r.retryAfterMs, RETRY_AFTER_CAP_MS)
          : Math.min(cap, base * 2 ** i);
      await deps.sleep(backoff);
    }
  }
  return { ok: false, reason: sawNotFound ? "not_found" : "unavailable" };
}

/** The binary-outcome classification (question A). */
export type WinnerClass =
  | "MATCH"
  | "WINNER_MISMATCH"
  | "EXTERNAL_UNAVAILABLE"
  | "EXTERNAL_UNSETTLED"
  | "EXTERNAL_IDENTITY_MISMATCH"
  /** The payload carried no usable external market identity (no ticker, or no
   *  close witness at all). Absence of evidence — never a MATCH, never a mismatch. */
  | "EXTERNAL_IDENTITY_UNVERIFIABLE"
  | "TICKER_CLOSE_MISMATCH"
  | "INTERNAL_OUTCOME_MISSING"
  | "INVALID_INTERNAL_WINDOW";

/** The official-underlying-value classification (question B). */
export type ValueClass = "OFFICIAL_VALUE_MATCH" | "OFFICIAL_VALUE_MISMATCH" | "OFFICIAL_VALUE_UNVERIFIABLE";

export type ReconResult = {
  ticker: string;
  close_time_ms: number;
  winner_class: WinnerClass;
  value_class: ValueClass;
  internal_winner: string | null;
  external_winner: "UP" | "DOWN" | null;
  internal_value: number | null;
  external_value: number | null;
  /** Which external identity witnesses were consulted and what each said. */
  witnesses: {
    ticker_embedded_close_ok: boolean | null; // the INTERNAL ticker's own close vs the row close
    external_ticker_ok: boolean | null; // payload ticker == requested ticker
    external_close_ok: boolean | null; // payload close within tolerance of the row close
  };
  /** Human-readable, reproducible evidence line. */
  note: string;
};

/** Value-comparison tolerance for the official underlying. Reuses the repo's
 *  established official-value agreement semantics: `lab.server.ts` counts a settle
 *  as "exact" when `abs(settle_avg - official_value) <= 0.05` (the settlement-receipt
 *  math and its SQL both use 0.05). We match that exactly rather than inventing a
 *  looser definition of "match"; it is tight enough that a real underlying gap is a
 *  mismatch, not rounding. */
export const VALUE_EPSILON = 0.05;

const SETTLED_STATUSES = new Set(["settled", "finalized", "determined", "closed_settled"]);

/** yes→UP, no→DOWN, else settlement_value 1/0, else null. The repo's parse, inlined. */
function officialWinner(m: OfficialMarket): "UP" | "DOWN" | null {
  const r = String(m.result ?? "").toLowerCase();
  if (r === "yes") return "UP";
  if (r === "no") return "DOWN";
  const v = Number(m.settlement_value);
  if (v === 1) return "UP";
  if (v === 0) return "DOWN";
  return null;
}

/**
 * The payload's trading-close clock, in ms, or null. ONLY `close_time` is read.
 *
 * `expiration_time` is a DIFFERENT, deprecated expiry clock (Kalshi distinguishes
 * the two and they can differ) and is NEVER substituted for it — the same rule the
 * official-value path enforces in window-identity (`mayWriteOfficial`). A payload
 * that carries no `close_time` simply has no external close witness; the row's
 * ticker-encoded close must then stand as the witness, exactly as that path does.
 */
function closeMsOf(m: OfficialMarket): number | null {
  const c = Date.parse(String(m.close_time ?? "")) || 0;
  return c > 0 ? c : null;
}

function finite(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** The official underlying value, if Kalshi exposes a trustworthy one. `expiration_value`
 *  is the settled 60s-BRTI average; `settlement_value` is the BINARY indicator and is
 *  NOT the underlying, so it is never used here. Absent/non-finite → null (UNVERIFIABLE). */
function officialUnderlying(m: OfficialMarket): number | null {
  const v = finite(m.expiration_value);
  return v != null && v > 0 ? v : null;
}

/**
 * Classify one window against its independently-fetched official market.
 *
 * The winner question is decided first by INTERNAL identity (a row whose ticker
 * positively contradicts its own close is invalid and gets no external rescue),
 * then INTERNAL completeness, then transport, then EXTERNAL identity (fail closed),
 * then settled-state, then the actual outcome. The value question is answered
 * independently and only when the identity is sound and Kalshi exposes a value.
 */
export function classifyReconciliation(internal: LedgerWindow, fetched: FetchOutcome): ReconResult {
  const base = {
    ticker: internal.ticker,
    close_time_ms: internal.close_time_ms,
    internal_winner: internal.winner === "UP" || internal.winner === "DOWN" ? internal.winner : null,
    external_winner: null as "UP" | "DOWN" | null,
    internal_value: internal.official_value,
    external_value: null as number | null,
    value_class: "OFFICIAL_VALUE_UNVERIFIABLE" as ValueClass,
    witnesses: {
      ticker_embedded_close_ok: tickerAgrees(internal.ticker, internal.close_time_ms),
      external_ticker_ok: null as boolean | null,
      external_close_ok: null as boolean | null,
    },
  };

  // (1) INTERNAL identity. The ticker's own embedded close must not positively
  // contradict the row's close (the stale-ticker/new-close block). No external
  // substitution can fix an internally inconsistent window. null (unparseable) is
  // not a contradiction and does not block.
  if (base.witnesses.ticker_embedded_close_ok === false) {
    return { ...base, winner_class: "TICKER_CLOSE_MISMATCH", note: reproNote(internal, null, "internal ticker encodes a close that contradicts the row close") };
  }

  // (2) INTERNAL completeness. External truth may exist, but our side is absent.
  if (base.internal_winner == null) {
    return { ...base, winner_class: "INTERNAL_OUTCOME_MISSING", note: reproNote(internal, null, "ledger winner is not UP/DOWN") };
  }

  // (3) TRANSPORT. A failure is never a mismatch.
  if (!fetched.ok) {
    return { ...base, winner_class: "EXTERNAL_UNAVAILABLE", note: reproNote(internal, null, `external fetch ${fetched.reason}`) };
  }
  const m = fetched.market;

  // (4) EXTERNAL identity, fail closed. The payload must name the SAME market —
  // a ticker that is PRESENT and exactly equal to the requested/internal ticker —
  // and, when it carries a close, that close (from `close_time` ONLY, never
  // `expiration_time`) must agree with the exact row close within tolerance.
  const extTicker = String(m.ticker ?? "").trim();
  const externalTickerOk = extTicker.length > 0 ? extTicker === internal.ticker : null;
  const extClose = closeMsOf(m);
  const externalCloseOk = extClose == null ? null : Math.abs(extClose - internal.close_time_ms) <= CLOSE_TOLERANCE_MS;
  const witnesses = { ...base.witnesses, external_ticker_ok: externalTickerOk, external_close_ok: externalCloseOk };

  // A payload that names a DIFFERENT market is a positive disagreement.
  if (externalTickerOk === false) {
    return { ...base, witnesses, winner_class: "EXTERNAL_IDENTITY_MISMATCH", note: reproNote(internal, extTicker, `payload names a different market (${extTicker})`) };
  }
  // A payload whose own close contradicts the row close is a positive disagreement.
  if (externalCloseOk === false) {
    return { ...base, witnesses, winner_class: "EXTERNAL_IDENTITY_MISMATCH", note: reproNote(internal, extTicker, `payload close ${m.close_time} outside tolerance of the row close`) };
  }

  // A MATCH requires a MEANINGFUL external identity, never missing evidence:
  //   (a) the payload ticker is present and exactly equal (externalTickerOk === true), AND
  //   (b) at least one close witness holds — the payload's own close_time agrees,
  //       or (when the payload carries no close) the internal ticker's encoded close
  //       agrees with the row (ticker_embedded_close_ok === true).
  // A payload with no ticker, or with neither close witness, is absence of evidence,
  // not a verdict — and must never be allowed to produce MATCH.
  const tickerCloseWitness = base.witnesses.ticker_embedded_close_ok === true;
  if (!(externalTickerOk === true && (externalCloseOk === true || tickerCloseWitness))) {
    const why =
      externalTickerOk !== true
        ? "payload carries no ticker — no external market identity"
        : "payload carries no close witness and the internal ticker does not establish one";
    return { ...base, witnesses, winner_class: "EXTERNAL_IDENTITY_UNVERIFIABLE", note: reproNote(internal, extTicker || null, why) };
  }

  // (5) SETTLED state. Not-yet-settled is not a mismatch.
  const extWinner = officialWinner(m);
  const status = String(m.status ?? "").toLowerCase();
  const settled = extWinner != null || SETTLED_STATUSES.has(status);
  if (!settled || extWinner == null) {
    return { ...base, witnesses, winner_class: "EXTERNAL_UNSETTLED", note: reproNote(internal, extTicker, `external status "${status || "?"}", no official result yet`) };
  }

  // Question A — the binary outcome.
  const winner_class: WinnerClass = extWinner === base.internal_winner ? "MATCH" : "WINNER_MISMATCH";

  // Question B — the official underlying value, independent of A, only if Kalshi
  // exposes a trustworthy value AND we recorded one. Never derived from our side.
  const extValue = officialUnderlying(m);
  let value_class: ValueClass = "OFFICIAL_VALUE_UNVERIFIABLE";
  if (extValue != null && internal.official_value != null) {
    value_class = Math.abs(extValue - internal.official_value) <= VALUE_EPSILON ? "OFFICIAL_VALUE_MATCH" : "OFFICIAL_VALUE_MISMATCH";
  }

  return {
    ...base,
    witnesses,
    external_winner: extWinner,
    external_value: extValue,
    value_class,
    winner_class,
    note: reproNote(internal, extTicker, `ours=${base.internal_winner} official=${extWinner} → ${winner_class}`),
  };
}

function reproNote(w: LedgerWindow, extTicker: string | null, why: string): string {
  const close = Number.isFinite(w.close_time_ms) ? new Date(w.close_time_ms).toISOString() : String(w.close_time_ms);
  return `${w.ticker} @ ${close}${extTicker ? ` (ext ${extTicker})` : ""} · ${why}`;
}

export type ReconSummary = {
  rows_examined: number;
  externally_queried: number;
  externally_verified: number; // MATCH + WINNER_MISMATCH (a real external verdict landed)
  winner_matches: number;
  winner_mismatches: number;
  identity_invalid: number; // TICKER_CLOSE_MISMATCH + EXTERNAL_IDENTITY_MISMATCH
  external_identity_unverifiable: number; // payload had no usable external identity (absence of evidence)
  external_unavailable: number;
  external_unsettled: number;
  internal_missing: number;
  official_value_matches: number;
  official_value_mismatches: number;
  official_value_unverifiable: number;
  /** Every non-MATCH winner outcome, for reproduction. */
  failures: ReconResult[];
};

/** Aggregate classified results into the report shape. Pure. */
export function summarize(results: ReconResult[]): ReconSummary {
  const s: ReconSummary = {
    rows_examined: results.length,
    externally_queried: 0,
    externally_verified: 0,
    winner_matches: 0,
    winner_mismatches: 0,
    identity_invalid: 0,
    external_identity_unverifiable: 0,
    external_unavailable: 0,
    external_unsettled: 0,
    internal_missing: 0,
    official_value_matches: 0,
    official_value_mismatches: 0,
    official_value_unverifiable: 0,
    failures: [],
  };
  for (const r of results) {
    // "externally queried" = we actually attempted/received an external answer
    // (everything except a row rejected on internal grounds before any fetch).
    if (r.winner_class !== "TICKER_CLOSE_MISMATCH" && r.winner_class !== "INTERNAL_OUTCOME_MISSING") s.externally_queried++;
    switch (r.winner_class) {
      case "MATCH":
        s.winner_matches++;
        s.externally_verified++;
        break;
      case "WINNER_MISMATCH":
        s.winner_mismatches++;
        s.externally_verified++;
        break;
      case "TICKER_CLOSE_MISMATCH":
      case "EXTERNAL_IDENTITY_MISMATCH":
        s.identity_invalid++;
        break;
      case "EXTERNAL_IDENTITY_UNVERIFIABLE":
        s.external_identity_unverifiable++;
        break;
      case "EXTERNAL_UNAVAILABLE":
        s.external_unavailable++;
        break;
      case "EXTERNAL_UNSETTLED":
        s.external_unsettled++;
        break;
      case "INTERNAL_OUTCOME_MISSING":
        s.internal_missing++;
        break;
      case "INVALID_INTERNAL_WINDOW":
        s.identity_invalid++;
        break;
    }
    if (r.value_class === "OFFICIAL_VALUE_MATCH") s.official_value_matches++;
    else if (r.value_class === "OFFICIAL_VALUE_MISMATCH") s.official_value_mismatches++;
    else s.official_value_unverifiable++;
    if (r.winner_class !== "MATCH") s.failures.push(r);
  }
  return s;
}

/**
 * The report shape the server runner produces and the CLI prints. Pure data —
 * defined here (not in the server adapter) so the renderer and its test stay pure.
 */
export type ReconReport = {
  period_days: number;
  earliest_ms: number | null;
  latest_ms: number | null;
  summary: ReconSummary;
  results: ReconResult[];
};

/**
 * Render a reconciliation report for a CLI or log: first a single machine-readable
 * JSON line (the whole report), then human-readable evidence for EVERY non-MATCH
 * outcome — each with its exact reproduction note. Pure; no I/O, no process exit.
 * The caller decides exit status (a mismatch is a finding, not an execution error).
 */
export function renderReconReport(report: ReconReport): string {
  const s = report.summary;
  const range =
    report.earliest_ms != null && report.latest_ms != null
      ? ` [${new Date(report.earliest_ms).toISOString()} .. ${new Date(report.latest_ms).toISOString()}]`
      : "";
  const lines: string[] = [
    JSON.stringify(report),
    `# reconciled ${s.rows_examined} window(s) over ${report.period_days}d${range}`,
    `# winner: ${s.winner_matches} match / ${s.winner_mismatches} mismatch · ` +
      `value: ${s.official_value_matches} match / ${s.official_value_mismatches} mismatch / ${s.official_value_unverifiable} unverifiable`,
    `# identity_invalid ${s.identity_invalid} · identity_unverifiable ${s.external_identity_unverifiable} · ` +
      `unsettled ${s.external_unsettled} · unavailable ${s.external_unavailable} · internal_missing ${s.internal_missing}`,
  ];
  if (s.failures.length === 0) {
    lines.push("# no non-MATCH outcomes");
  } else {
    lines.push(`# ${s.failures.length} non-MATCH outcome(s), with evidence:`);
    for (const f of s.failures) lines.push(`${f.winner_class}\t${f.value_class}\t${f.note}`);
  }
  return lines.join("\n");
}

export type FetchMarket = (ticker: string) => Promise<FetchOutcome>;

/**
 * Reconcile a batch of ledger windows against Kalshi, with bounded concurrency.
 * Pure apart from the injected `fetchMarket` (so tests drive it with fixtures and
 * it never touches the network itself). Each exact window is fetched and classified
 * INDEPENDENTLY — a duplicate ticker across closes is queried once per exact window,
 * and one market's official result can never validate another window's row.
 */
export async function reconcileWindows(
  rows: readonly LedgerWindow[],
  fetchMarket: FetchMarket,
  opts: { concurrency?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<ReconResult[]> {
  // CONSERVATIVE BY DEFAULT. This is a manual bulk auditor, not a hot path: it runs
  // sequentially (concurrency 1) and spaces its external fetches, so a full run never
  // bursts into Kalshi's rate limiter. A caller may raise concurrency, but the ceiling
  // stays low on purpose.
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? RECONCILE_CONCURRENCY_DEFAULT, 8));
  const delayMs = Math.max(0, opts.delayMs ?? INTER_MARKET_DELAY_MS_DEFAULT);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const out: ReconResult[] = new Array(rows.length);
  let next = 0;
  async function worker(): Promise<void> {
    let fetchedHere = false; // pace only BETWEEN this worker's real fetches
    for (;;) {
      const i = next++;
      if (i >= rows.length) return;
      const row = rows[i]!;
      // A row that is internally invalid or missing our outcome is NOT fetched —
      // there is nothing external can decide for it, and we must not let another
      // market answer for it. Skipped rows cost no request and no pacing delay.
      if (tickerAgrees(row.ticker, row.close_time_ms) === false || !(row.winner === "UP" || row.winner === "DOWN")) {
        out[i] = classifyReconciliation(row, { ok: false, reason: "unavailable" });
        continue;
      }
      if (fetchedHere && delayMs > 0) await sleep(delayMs); // inter-market spacing
      fetchedHere = true;
      let fetched: FetchOutcome;
      try {
        fetched = await fetchMarket(row.ticker);
      } catch {
        fetched = { ok: false, reason: "unavailable" };
      }
      out[i] = classifyReconciliation(row, fetched);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length || 1) }, () => worker()));
  return out;
}
