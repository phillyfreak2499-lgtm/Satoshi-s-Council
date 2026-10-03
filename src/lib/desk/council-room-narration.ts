/**
 * Council Room V1 — Phase 1 narration adapter.
 *
 * Pure. Turns already-mapped Chamber statements (desk_system_events rows with
 * public = true, read through listChamberSpeech) into typed narration events.
 * No database, no engine, no writer, no voice, no network. Nothing here can
 * change desk state; it only decides whether a recorded row is identifiable
 * enough to narrate and which neutral template describes it.
 *
 * Rules (docs/COUNCIL_ROOM_V1.md):
 * - every narrated line traces to one stored event_key, source and timestamp;
 * - fields are allowlisted and typed; stored prose is kept only as archival evidence;
 * - templates are deterministic third-person descriptions of the stored fields,
 *   never quotes, motives, confidence or fills the record does not carry;
 * - a malformed, unknown or identity-inconsistent record is refused, not guessed;
 * - research, the Chair's decision and the paper book stay separate layers.
 */
import type { ChamberStatement } from "./chamber-reactions.ts";
import { isSystemSourceType } from "./system-events.ts";
import { CLOSE_TOLERANCE_MS, WINDOW_GRID_MS, onGrid, tickerAgrees } from "./window-identity.ts";

export const COUNCIL_ROOM_SCHEMA_VERSION = 1;

/** Where every Phase 1 row comes from. There is no second source. */
export const COUNCIL_ROOM_SOURCE = "desk_system_events" as const;

/** A recorded time this far after receipt is treated as a bad clock, not news. */
export const FUTURE_SKEW_MS = 120_000;

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/;
const CALL_ID_RE = /^(\d{10,16})-(UP|DOWN)-(\d{10,16})$/;

/**
 * The decision layer a record belongs to. Kept distinct on purpose: a research
 * milestone is not a Chair decision, and a Chair decision is not a paper position.
 */
export type NarrationLayer = "research" | "chair" | "book" | "integrity" | "conditions";

export type TemplateKey =
  | "book.paper_call_logged"
  | "chair.wait.feed_condition"
  | "chair.wait.hard_gate"
  | "chair.wait.under_bar"
  | "chair.wait.no_edge"
  | "chair.wait.agreement_withheld"
  | "integrity.feed_alert"
  | "integrity.feed_recovered"
  | "research.experiment_started"
  | "research.evidence_milestone"
  | "conditions.seat_flagged"
  | "conditions.seat_cleared";

export type WindowIdentity = {
  ticker: string;
  close_time: number;
  /** Always true: a ticker whose own close cannot be parsed and matched is refused. */
  ticker_agrees: true;
};

export type NarrationEvent = {
  schema_version: typeof COUNCIL_ROOM_SCHEMA_VERSION;
  /** Stable id: the stored, insert-once event_key. */
  event_id: string;
  layer: NarrationLayer;
  event_type: ChamberStatement["event_type"];
  speaker: ChamberStatement["speaker"];
  template_key: TemplateKey;
  /** Deterministic neutral sentence built only from `fields`. */
  text: string;
  /** Stored payload wording, preserved verbatim as evidence. Never the headline. */
  archival_text: string;
  recorded_at: string;
  recorded_ms: number;
  /**
   * When the row was received: the server's clock right after the page-load read,
   * or this client's clock right after a follow-up read. Never the recorded time.
   */
  received_at: string;
  window: WindowIdentity | null;
  seat: string | null;
  source: {
    table: typeof COUNCIL_ROOM_SOURCE;
    event_key: string;
    source_type: string;
    source_id: string;
  };
  /** desk_system_events carries no build or commit identity; reported, not invented. */
  build: null;
  fields: Record<string, string | number | boolean | null>;
  /** The mapped statement, kept for the existing evidence panel. */
  statement: ChamberStatement;
};

export type RefusalReason =
  | "malformed-identity"
  | "unknown-record"
  | "invalid-recorded-time"
  | "missing-receipt-time"
  | "future-recorded-time"
  | "window-identity"
  | "rollover-mismatch"
  | "book-identity"
  | "missing-fields";

export type Refusal = { event_id: string; reason: RefusalReason; detail: string };

export type AdaptResult = { ok: true; event: NarrationEvent } | { ok: false; refusal: Refusal };

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function refuse(event_id: string, reason: RefusalReason, detail: string): AdaptResult {
  return { ok: false, refusal: { event_id, reason, detail } };
}

function utc(ms: number): string {
  return new Date(ms).toISOString().slice(11, 16) + " UTC";
}

function cents(v: number): string {
  return `${Math.round(v * 10) / 10}¢`;
}

/**
 * A window-bound record must name one real quarter-hour market, agree with the
 * ticker's own encoded close, and have been recorded while that market was open.
 * The last check is the rollover guard: a stale ticker carried past its close
 * (the 2026-09-10 failure) is refused rather than narrated as current.
 */
function windowOf(
  s: ChamberStatement,
  recordedMs: number,
  expectedSourceId: (ticker: string, close: number) => string,
): WindowIdentity | Refusal {
  const ticker = str(s.evidence.ticker);
  const close = num(s.evidence.close_time);
  if (!ticker || close == null || !onGrid(close)) {
    return { event_id: s.event_key, reason: "window-identity", detail: "Record has no usable quarter-hour window identity." };
  }
  if (s.source_id !== expectedSourceId(ticker, close) || !s.event_key.includes(`:${ticker}:${close}`)) {
    return { event_id: s.event_key, reason: "window-identity", detail: "Event key, source id and window fields disagree." };
  }
  const agrees = tickerAgrees(ticker, close);
  if (agrees === false) {
    return { event_id: s.event_key, reason: "rollover-mismatch", detail: "Ticker's own close time disagrees with the recorded window." };
  }
  // The desk trades one verified ticker family (KXBTC15M-YYMMMDDHHMM-MM). A ticker the
  // canonical parser cannot read carries no checkable close, so it is not narrated.
  if (agrees !== true) {
    return { event_id: s.event_key, reason: "window-identity", detail: "Ticker identity cannot be verified against its own encoded close." };
  }
  if (recordedMs < close - WINDOW_GRID_MS - CLOSE_TOLERANCE_MS || recordedMs > close + CLOSE_TOLERANCE_MS) {
    return { event_id: s.event_key, reason: "rollover-mismatch", detail: "Recorded outside the window it names." };
  }
  return { ticker, close_time: close, ticker_agrees: true };
}

function isRefusal(v: WindowIdentity | Refusal): v is Refusal {
  return "reason" in v;
}

type Built = Pick<NarrationEvent, "layer" | "template_key" | "text" | "window" | "seat" | "fields">;

function chairWait(s: ChamberStatement, w: WindowIdentity): Built | Refusal {
  const e = s.evidence;
  const reason = str(e.wait_reason);
  const gates = Array.isArray(e.failed_hard) ? e.failed_hard.filter((g) => typeof g === "string" && g) : [];
  const fields = {
    wait_reason: reason,
    failed_gates: gates.join(","),
    score: num(e.score),
    bar: num(e.bar),
    quorum_up: e.quorum?.up ?? null,
    quorum_down: e.quorum?.down ?? null,
    quorum_wait: e.quorum?.wait ?? null,
  };
  const base = { layer: "chair" as const, window: w, seat: null, fields };
  const where = `${w.ticker} (closes ${utc(w.close_time)})`;
  if (e.roster_check?.status === "MISMATCH") {
    return { ...base, template_key: "chair.wait.agreement_withheld", text: `SATOSHI recorded WAIT on ${where}. The saved vote counts disagree with the saved seat roster, so no agreement claim is shown.` };
  }
  const gateList = gates.length ? ` (${gates.join(", ")})` : "";
  switch (reason) {
    case "feed-condition":
      return { ...base, template_key: "chair.wait.feed_condition", text: `SATOSHI recorded WAIT on ${where}. A data-trust gate was failing${gateList}.` };
    case "hard-gate":
      return { ...base, template_key: "chair.wait.hard_gate", text: `SATOSHI recorded WAIT on ${where}. A hard gate was failing${gateList}.` };
    case "under-bar": {
      const scored = fields.score != null && fields.bar != null ? ` Recorded score ${fields.score} against bar ${fields.bar}.` : "";
      return { ...base, template_key: "chair.wait.under_bar", text: `SATOSHI recorded WAIT on ${where}. No hard gate failed; the weighted vote did not clear its bar.${scored}` };
    }
    case "no-edge":
      return { ...base, template_key: "chair.wait.no_edge", text: `SATOSHI recorded WAIT on ${where}. Gates passed and the vote cleared, but no side was recorded as worth its ask.` };
    default:
      return { event_id: s.event_key, reason: "missing-fields", detail: "WAIT record has no recognised wait_reason." };
  }
}

/**
 * CHAIR_DIRECTIONAL is written from a canonical Chair CallLogRow (source == null)
 * that the paper book appended after every booking guard passed. The call id the
 * book assigned is the identity; without it, or if it disagrees with the window
 * or side, the row is not labelled as a paper call.
 */
function bookCall(s: ChamberStatement, w: WindowIdentity): Built | Refusal {
  const e = s.evidence;
  const lean = str(e.lean);
  const entry = num(e.entry_cents);
  const callId = str(e.call_id);
  const m = CALL_ID_RE.exec(callId);
  if ((lean !== "UP" && lean !== "DOWN") || entry == null || !(entry > 0 && entry < 100)) {
    return { event_id: s.event_key, reason: "missing-fields", detail: "Paper call is missing side or entry price." };
  }
  if (!m || Number(m[1]) !== w.close_time || m[2] !== lean) {
    return { event_id: s.event_key, reason: "book-identity", detail: "Paper call has no canonical book call id matching its window and side." };
  }
  return {
    layer: "book",
    template_key: "book.paper_call_logged",
    text: `The paper book logged a canonical Chair ${lean} call on ${w.ticker} at ${cents(entry)} (call ${callId}). Paper only.`,
    window: w,
    seat: null,
    fields: { lean, entry_cents: entry, call_id: callId },
  };
}

function integrity(s: ChamberStatement, w: WindowIdentity): Built | Refusal {
  const e = s.evidence;
  const feed = str(e.feed);
  const fields = { provider: "kalshi", feed, gap: str(e.gap), receipt_age_s: num(e.receipt_age_s), last_change_age_s: num(e.last_change_age_s) };
  if (s.event_type === "SYSTEM_HEALTH_RECOVERED") {
    if (feed !== "LIVE") return { event_id: s.event_key, reason: "missing-fields", detail: "Recovery record does not carry a LIVE feed state." };
    return { layer: "integrity", template_key: "integrity.feed_recovered", text: `WARDEN recorded the Kalshi feed back to LIVE during ${w.ticker}.`, window: w, seat: null, fields };
  }
  if (feed !== "STALE" && feed !== "DOWN") return { event_id: s.event_key, reason: "missing-fields", detail: "Alert record does not carry a STALE or DOWN feed state." };
  const age = fields.receipt_age_s != null ? ` Receipt age at the time: ${fields.receipt_age_s}s.` : "";
  return { layer: "integrity", template_key: "integrity.feed_alert", text: `WARDEN recorded the Kalshi feed as ${feed} during ${w.ticker}.${age}`, window: w, seat: null, fields };
}

function research(s: ChamberStatement): Built | Refusal {
  const e = s.evidence;
  const id = str(e.candidate_id);
  const label = str(e.candidate_label) || id;
  if (!id || s.source_id !== id || !s.event_key.includes(`:${id}`)) {
    return { event_id: s.event_key, reason: "malformed-identity", detail: "Experiment record does not name one candidate consistently." };
  }
  const fields = { candidate_id: id, candidate_label: label, sample_n: num(e.sample_n), milestone: num(e.milestone), paper_only: e.paper_only === true, authority: str(e.authority) || "none" };
  if (s.event_type === "EXPERIMENT_STARTED") {
    return { layer: "research", template_key: "research.experiment_started", text: `ALCHEMIST recorded ${label} as a frozen shadow-research specimen. It has no production authority.`, window: null, seat: null, fields };
  }
  if (fields.milestone == null) return { event_id: s.event_key, reason: "missing-fields", detail: "Evidence milestone record has no milestone count." };
  return { layer: "research", template_key: "research.evidence_milestone", text: `ALCHEMIST recorded ${label} reaching ${fields.milestone} countable prospective observations. A sample milestone only; no authority is earned.`, window: null, seat: null, fields };
}

function conditions(s: ChamberStatement): Built | Refusal {
  const e = s.evidence;
  const seat = str(e.seat).toUpperCase();
  const action = str(e.action).toLowerCase();
  if (!seat || (action !== "flag" && action !== "clear") || !s.source_id || !s.event_key.endsWith(`:${s.source_id}`)) {
    return { event_id: s.event_key, reason: "malformed-identity", detail: "Seat-audit record lacks a seat, action or consistent slug." };
  }
  const fields = { seat, action, reads: num(e.reads), spoke: num(e.spoke), mid_n: num(e.mid_n), grade_n: num(e.grade_n) };
  return action === "flag"
    ? { layer: "conditions", template_key: "conditions.seat_flagged", text: `SWEEP recorded a seat condition flag on ${seat}. Observation only; it carries no authority.`, window: null, seat, fields }
    : { layer: "conditions", template_key: "conditions.seat_cleared", text: `SWEEP recorded a seat condition cleared on ${seat}. Observation only; it carries no authority.`, window: null, seat, fields };
}

/**
 * Adapt one mapped statement. `receivedMs` is a real receipt time: the server's
 * clock after the page-load read, or this client's clock after a later read.
 * A row without a usable receipt time is refused, so every rendered line carries one.
 */
export function adaptStatement(s: ChamberStatement, receivedMs: number): AdaptResult {
  const id = typeof s?.event_key === "string" ? s.event_key : "";
  if (!KEY_RE.test(id) || !isSystemSourceType(String(s?.source_type ?? "")) || !str(s?.source_id) || !s?.evidence) {
    return refuse(id || "(missing)", "malformed-identity", "Record lacks a valid event key, source type or source id.");
  }
  const recordedMs = Date.parse(String(s.occurred_at ?? ""));
  if (!Number.isFinite(recordedMs)) return refuse(id, "invalid-recorded-time", "Recorded time does not parse.");
  if (typeof receivedMs !== "number" || !Number.isFinite(receivedMs) || receivedMs <= 0) {
    return refuse(id, "missing-receipt-time", "Row has no real receipt time.");
  }
  if (recordedMs > receivedMs + FUTURE_SKEW_MS) {
    return refuse(id, "future-recorded-time", "Recorded time is later than this receipt.");
  }

  let built: Built | Refusal;
  const kind = s.evidence.kind;
  if (s.event_type === "CHAIR_WAIT_MILESTONE" && s.speaker === "SATOSHI" && kind === "chair-wait" && s.source_type === "window") {
    const w = windowOf(s, recordedMs, (t, c) => `${t}:${c}`);
    built = isRefusal(w) ? w : chairWait(s, w);
  } else if (s.event_type === "CHAIR_DIRECTIONAL" && s.speaker === "SATOSHI" && kind === "chair-directional" && s.source_type === "window") {
    const w = windowOf(s, recordedMs, (t, c) => `${t}:${c}`);
    built = isRefusal(w) ? w : bookCall(s, w);
  } else if ((s.event_type === "SYSTEM_HEALTH_ALERT" || s.event_type === "SYSTEM_HEALTH_RECOVERED") && s.speaker === "WARDEN" && kind === "system-health" && s.source_type === "health") {
    const w = windowOf(s, recordedMs, (t, c) => `kalshi:${t}:${c}`);
    built = isRefusal(w) ? w : integrity(s, w);
  } else if ((s.event_type === "EXPERIMENT_STARTED" || s.event_type === "EXPERIMENT_EVIDENCE_MILESTONE") && s.speaker === "ALCHEMIST" && kind === "experiment" && s.source_type === "experiment") {
    built = research(s);
  } else if (s.event_type === "DESK_UPDATE" && s.speaker === "SWEEP" && kind === "seat-audit" && s.source_type === "desk_update") {
    built = conditions(s);
  } else {
    return refuse(id, "unknown-record", "Event type, speaker, source and evidence kind are not a supported combination.");
  }
  if ("reason" in built) return { ok: false, refusal: built };

  return {
    ok: true,
    event: {
      schema_version: COUNCIL_ROOM_SCHEMA_VERSION,
      event_id: id,
      event_type: s.event_type,
      speaker: s.speaker,
      ...built,
      archival_text: s.original_text ?? s.text,
      recorded_at: new Date(recordedMs).toISOString(),
      recorded_ms: recordedMs,
      received_at: new Date(receivedMs).toISOString(),
      source: { table: COUNCIL_ROOM_SOURCE, event_key: id, source_type: s.source_type, source_id: s.source_id },
      build: null,
      statement: s,
    },
  };
}

/** Plain-language label for each layer, shown beside every line. */
export const LAYER_LABEL: Record<NarrationLayer, string> = {
  research: "Research · no authority",
  chair: "Chair decision",
  book: "Paper book",
  integrity: "Feed integrity",
  conditions: "Seat conditions · observation",
};

export const REFUSAL_LABEL: Record<RefusalReason, string> = {
  "malformed-identity": "missing or inconsistent identity",
  "unknown-record": "unsupported record kind",
  "invalid-recorded-time": "unreadable recorded time",
  "missing-receipt-time": "no receipt time",
  "future-recorded-time": "recorded time after receipt",
  "window-identity": "unusable window identity",
  "rollover-mismatch": "window rollover mismatch",
  "book-identity": "no canonical book call id",
  "missing-fields": "required fields missing",
};
