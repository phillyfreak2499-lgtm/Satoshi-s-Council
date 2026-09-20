/**
 * OPENAI_SHADOW_V1 prospective observer.
 *
 * The observer is booted beside the desk engine, never imported by it. It freezes
 * one same-time packet at T-7:30, asks OpenAI for a structured PAPER-RESEARCH
 * forecast, and writes only desk_openai_shadow. There is no return path into the
 * Chair, learner, entry policy, paper book, promotion, wallet, or execution.
 */
import { createHash } from "node:crypto";
import { getSql } from "@/lib/db";
import {
  OPENAI_SHADOW_DEFAULT_MODEL,
  OPENAI_SHADOW_LOCK_GRACE_SECS,
  OPENAI_SHADOW_LOCK_SECS,
  OPENAI_SHADOW_PROMPT_VERSION,
  OPENAI_SHADOW_SCHEMA,
  OPENAI_SHADOW_STUDY,
  OPENAI_SHADOW_VERSION,
  buildOpenAIShadowPacket,
  inOpenAIShadowLock,
  openAIShadowBrier,
  openAIShadowHit,
  parseOpenAIShadowDecision,
  type OpenAIShadowDecision,
  type OpenAIShadowSide,
} from "./openai-shadow";
import {
  claimOpenAICaptureJob,
  completeOpenAICaptureJob,
  freezeOpenAICaptureJob,
  nextRecoverableOpenAIJob,
  noteOpenAICaptureError,
  saveOpenAICaptureResult,
  type OpenAICaptureJob,
} from "./openai-capture-job.server";
import { tickerAgrees } from "./window-identity";

export const OPENAI_SHADOW_PROSPECTIVE_SINCE = Date.parse("2026-09-19T11:00:00.000Z");
const OBSERVER_MS = 2_000;
const REQUEST_TIMEOUT_MS = 10_000;

const INSTRUCTIONS = `You are OPENAI_SHADOW_V1, a paper-only research analyst for a Bitcoin 15-minute forecasting experiment.

Authority and safety:
- You have no execution authority.
- Do not recommend or discuss real-money betting, wagering, order placement, position sizing, wallets, transfers, or financial advice.
- Do not call tools, browse the web, request more data, or use information outside the frozen packet.
- Never claim a fill or a trade occurred.

Research task:
- Estimate P(UP) for the official settlement of this one frozen 15-minute window.
- Use only fields present in the packet. Do not invent unavailable observations.
- p_up is a calibrated probability target, not a confidence score.
- side MUST be UP when p_up >= 0.5 and DOWN when p_up < 0.5.
- conviction is a separate 0-100 self-rated evidence-strength label and is not treated as calibrated.
- strongest_evidence and contradictions must be concise labels grounded in supplied fields.
- would_abstain may be true when evidence is weak or conflicting, but p_up and side remain mandatory so the paper research can score every captured window.
- Output only the required structured object.`;

type ApiUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
};

type ApiResponse = {
  id?: string;
  status?: string;
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string; refusal?: string }>;
  }>;
  error?: { message?: string };
  usage?: ApiUsage;
};

type StoredRow = {
  ticker: string;
  close_ms: number | string;
  taken_ms: number | string;
  market_p: number | null;
  p_up: number;
  side: OpenAIShadowSide;
  conviction: number;
  would_abstain: boolean;
  chair_lean: "UP" | "DOWN" | "WAIT";
  entry_cents: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  winner: string | null;
};

type Observer = {
  timer: ReturnType<typeof setInterval> | null;
  inFlight: boolean;
  sampled: Set<string>;
  lastError: string | null;
  lastCapturedAt: number;
  lastLatencyMs: number | null;
  recoveryComplete: boolean;
};

const g = globalThis as typeof globalThis & { __openAIShadowObserver__?: Observer };

function observer(): Observer {
  return (g.__openAIShadowObserver__ ??= {
    timer: null,
    inFlight: false,
    sampled: new Set(),
    lastError: null,
    lastCapturedAt: 0,
    lastLatencyMs: null,
    recoveryComplete: false,
  });
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const probFromCents = (v: unknown): number | null => {
  const n = num(v);
  return n != null && n >= 0 && n <= 100 ? n / 100 : null;
};

const validAsk = (v: unknown): number | null => {
  const n = num(v);
  return n != null && n > 0 && n < 100 ? n : null;
};

function responseText(body: ApiResponse): string | null {
  if (typeof body.output_text === "string" && body.output_text.trim()) return body.output_text;
  for (const item of body.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string" && content.text.trim()) {
        return content.text;
      }
      if (content.type === "refusal" && typeof content.refusal === "string") {
        throw new Error(`OpenAI refused the paper-research forecast: ${content.refusal.slice(0, 240)}`);
      }
    }
  }
  return null;
}

async function requestForecast(
  packet: ReturnType<typeof buildOpenAIShadowPacket>,
  model: string,
  promptVersion: string,
  apiKey: string,
): Promise<{ decision: OpenAIShadowDecision; responseId: string; usage: ApiUsage; latencyMs: number }> {
  const started = Date.now();
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: "low" },
      max_output_tokens: 700,
      instructions: INSTRUCTIONS,
      input: `Frozen same-time research packet:\n${JSON.stringify(packet)}`,
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "openai_shadow_v1",
          strict: true,
          schema: OPENAI_SHADOW_SCHEMA,
        },
      },
      metadata: {
        study: OPENAI_SHADOW_STUDY,
        prompt_version: promptVersion,
      },
    }),
  });

  const body = (await res.json().catch(() => ({}))) as ApiResponse;
  if (!res.ok) {
    const message = body.error?.message ? String(body.error.message).slice(0, 320) : `HTTP ${res.status}`;
    throw new Error(`OpenAI Responses API: ${message}`);
  }
  if (body.status && body.status !== "completed") {
    throw new Error(`OpenAI response not completed: ${body.status}`);
  }
  const text = responseText(body);
  if (!text) throw new Error("OpenAI response contained no structured output text");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("OpenAI structured output was not valid JSON");
  }
  const decision = parseOpenAIShadowDecision(parsed);
  if (!decision) throw new Error("OpenAI structured output failed local invariant checks");
  return {
    decision,
    responseId: typeof body.id === "string" ? body.id : "",
    usage: body.usage ?? {},
    latencyMs: Math.max(0, Date.now() - started),
  };
}

async function alreadyCaptured(ticker: string, closeTime: number): Promise<boolean> {
  const db = await getSql();
  const rows = await db<{ present: boolean }>`
    select exists(
      select 1 from desk_openai_shadow
      where ticker = ${ticker}
        and close_time = ${new Date(closeTime).toISOString()}::timestamptz
    ) as present
  `;
  return rows[0]?.present === true;
}

async function finalizeJob(job: OpenAICaptureJob, st: Observer): Promise<void> {
  const key = `${job.ticker}|${job.close_ms}`;
  const pred = parseOpenAIShadowDecision(job.result);
  if (!pred || job.result_ms == null) throw new Error("durable OpenAI Shadow result failed invariant checks");

  const packetJson = JSON.stringify(job.input_packet);
  const actualHash = createHash("sha256").update(packetJson).digest("hex");
  if (actualHash !== job.input_hash) throw new Error("durable OpenAI Shadow packet hash mismatch");

  const entry = pred.side === "UP" ? job.yes_ask : job.no_ask;
  const db = await getSql();
  await db`
    insert into desk_openai_shadow (
      ticker, close_time, taken_at, secs_left, study, version, prompt_version,
      model, response_id, input_hash, input_packet, market_p, fair_p, p_up, side,
      conviction, regime, strongest_evidence, contradictions, data_quality,
      would_abstain, chair_lean, yes_ask, no_ask, entry_cents,
      input_tokens, output_tokens, total_tokens, latency_ms, build_sha
    )
    select
      ${job.ticker},
      ${new Date(job.close_ms).toISOString()}::timestamptz,
      ${new Date(job.frozen_ms).toISOString()}::timestamptz,
      ${job.secs_left},
      ${job.study},
      ${job.version},
      ${job.prompt_version},
      ${job.model},
      ${job.response_id},
      ${job.input_hash},
      ${packetJson}::jsonb,
      ${job.market_p},
      ${job.fair_p},
      ${pred.p_up},
      ${pred.side},
      ${pred.conviction},
      ${pred.regime},
      ${JSON.stringify(pred.strongest_evidence)}::jsonb,
      ${JSON.stringify(pred.contradictions)}::jsonb,
      ${pred.data_quality},
      ${pred.would_abstain},
      ${job.chair_lean},
      ${job.yes_ask},
      ${job.no_ask},
      ${entry},
      ${job.input_tokens},
      ${job.output_tokens},
      ${job.total_tokens},
      ${job.latency_ms ?? 0},
      ${job.build_sha}
    where ${new Date(job.result_ms).toISOString()}::timestamptz
          < ${new Date(job.close_ms).toISOString()}::timestamptz
    on conflict (ticker, close_time) do nothing
  `;
  await completeOpenAICaptureJob(job);

  st.sampled.add(key);
  st.lastCapturedAt = Date.now();
  st.lastLatencyMs = job.latency_ms;
  st.lastError = null;
}

async function runDurableJob(
  job: OpenAICaptureJob,
  apiKey: string,
  st: Observer,
  fromRecovery: boolean,
): Promise<void> {
  if (job.status === "result_ready") {
    await finalizeJob(job, st);
    return;
  }
  if (job.status !== "pending") return;
  if (job.prompt_version !== OPENAI_SHADOW_PROMPT_VERSION) {
    throw new Error(`refusing pending Shadow job with prompt ${job.prompt_version}`);
  }

  const claimed = await claimOpenAICaptureJob(job);
  if (!claimed) {
    // Another overlapping process owns the short lease. Recovery will check again.
    st.recoveryComplete = false;
    return;
  }

  try {
    const packet = claimed.input_packet as ReturnType<typeof buildOpenAIShadowPacket>;
    const packetJson = JSON.stringify(packet);
    const actualHash = createHash("sha256").update(packetJson).digest("hex");
    if (actualHash !== claimed.input_hash) throw new Error("durable OpenAI Shadow packet hash mismatch");

    const forecast = await requestForecast(packet, claimed.model, claimed.prompt_version, apiKey);
    const saved = await saveOpenAICaptureResult(claimed, {
      result: forecast.decision,
      response_id: forecast.responseId,
      input_tokens: num(forecast.usage.input_tokens),
      output_tokens: num(forecast.usage.output_tokens),
      total_tokens: num(forecast.usage.total_tokens),
      latency_ms: forecast.latencyMs,
    });
    if (!saved) throw new Error("OpenAI Shadow answer arrived after close; result was not admitted");

    const ready = await nextRecoverableOpenAIJob(OPENAI_SHADOW_STUDY, OPENAI_SHADOW_VERSION);
    if (!ready || ready.ticker !== claimed.ticker || ready.close_ms !== claimed.close_ms || ready.status !== "result_ready") {
      throw new Error("durable OpenAI Shadow result missing after save");
    }
    await finalizeJob(ready, st);
  } catch (err) {
    await noteOpenAICaptureError(claimed, err).catch(() => {});
    st.recoveryComplete = false;
    throw err;
  } finally {
    if (fromRecovery) st.recoveryComplete = false;
  }
}

async function captureOnce(): Promise<void> {
  const st = observer();
  if (st.inFlight || Date.now() < OPENAI_SHADOW_PROSPECTIVE_SINCE) return;

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    st.lastError = null;
    return;
  }
  const model = process.env.OPENAI_SHADOW_MODEL?.trim() || OPENAI_SHADOW_DEFAULT_MODEL;

  st.inFlight = true;
  try {
    // On a fresh process, drain any durable pre-close request or pre-close answer
    // before consulting a new live frame. This is the restart-safety path.
    if (!st.recoveryComplete) {
      const recoverable = await nextRecoverableOpenAIJob(OPENAI_SHADOW_STUDY, OPENAI_SHADOW_VERSION);
      if (recoverable) {
        await runDurableJob(recoverable, apiKey, st, true);
        return;
      }
      st.recoveryComplete = true;
    }

    // One-way dynamic read. server-engine never imports this observer.
    const { getServerFrame } = await import("./server-engine");
    const frame = await getServerFrame();
    const frozen = structuredClone({ snap: frame.snap, chair: frame.chair, votes: frame.votes });
    const { snap, chair, votes } = frozen;

    if (!snap || snap.demo || snap.as_of < OPENAI_SHADOW_PROSPECTIVE_SINCE) return;
    if (!snap.ticker || tickerAgrees(snap.ticker, snap.close_time) !== true) return;
    if (!inOpenAIShadowLock(Number(snap.secs_left))) return;

    const key = `${snap.ticker}|${snap.close_time}`;
    if (st.sampled.has(key)) return;
    if (await alreadyCaptured(snap.ticker, snap.close_time)) {
      st.sampled.add(key);
      return;
    }

    // Freeze the exact model packet and same-time comparators durably BEFORE the
    // request. Blind/Luna will adopt the same handoff only after this pilot proves.
    const packet = buildOpenAIShadowPacket(snap, votes);
    const packetJson = JSON.stringify(packet);
    const inputHash = createHash("sha256").update(packetJson).digest("hex");
    const chairLean =
      chair?.lean === "UP" || chair?.lean === "DOWN" || chair?.lean === "WAIT"
        ? chair.lean
        : "WAIT";

    const job = await freezeOpenAICaptureJob({
      study: OPENAI_SHADOW_STUDY,
      version: OPENAI_SHADOW_VERSION,
      ticker: snap.ticker,
      close_ms: snap.close_time,
      frozen_ms: snap.as_of,
      secs_left: Number(snap.secs_left),
      prompt_version: OPENAI_SHADOW_PROMPT_VERSION,
      model,
      input_hash: inputHash,
      input_packet: packet,
      market_p: probFromCents(snap.yes_mid),
      fair_p: probFromCents(snap.fair_yes),
      chair_lean: chairLean,
      yes_ask: validAsk(snap.yes_ask),
      no_ask: validAsk(snap.no_ask),
      build_sha: process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? "",
    });

    await runDurableJob(job, apiKey, st, false);
  } catch (err) {
    st.lastError = err instanceof Error ? err.message : String(err);
  } finally {
    st.inFlight = false;
  }
}

export function ensureOpenAIShadowObserver(): void {
  const st = observer();
  if (st.timer) return;
  st.timer = setInterval(() => void captureOnce(), OBSERVER_MS);
  void captureOnce();
}

export function openAIShadowHealth() {
  const st = observer();
  return {
    started: Boolean(st.timer),
    configured: Boolean(process.env.OPENAI_API_KEY?.trim()),
    model: process.env.OPENAI_SHADOW_MODEL?.trim() || OPENAI_SHADOW_DEFAULT_MODEL,
    last_captured_at: st.lastCapturedAt ? new Date(st.lastCapturedAt).toISOString() : null,
    last_latency_ms: st.lastLatencyMs,
    last_error: st.lastError,
  };
}

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export type OpenAIShadowSnapshot = {
  study: typeof OPENAI_SHADOW_STUDY;
  since: string;
  prompt_version: string;
  model: string;
  lock: { seconds_before_close: number; grace_seconds: number };
  authority: {
    live_chair: false;
    paper_book: false;
    learner: false;
    promotion: false;
    execution: false;
  };
  captured: number;
  graded: number;
  hits: number;
  accuracy: number | null;
  brier: number | null;
  market_brier: number | null;
  market_accuracy: number | null;
  abstain_n: number;
  non_abstain: { n: number; hits: number; accuracy: number | null };
  when_chair_wait: { n: number; hits: number; accuracy: number | null };
  usage: { input_tokens: number; output_tokens: number; total_tokens: number };
  coverage: { expected_since_first: number; captured_since_first: number; missing: number };
  first_capture: string | null;
  health: ReturnType<typeof openAIShadowHealth>;
  recent: Array<{
    ticker: string;
    close_time: string;
    side: OpenAIShadowSide;
    p_up: number;
    would_abstain: boolean;
    winner: string | null;
  }>;
};

export async function openAIShadowSnapshot(): Promise<OpenAIShadowSnapshot> {
  const db = await getSql();
  const rows = await db<StoredRow>`
    select
      a.ticker,
      (extract(epoch from a.close_time) * 1000)::bigint as close_ms,
      (extract(epoch from a.taken_at) * 1000)::bigint as taken_ms,
      a.market_p, a.p_up, a.side, a.conviction, a.would_abstain,
      a.chair_lean, a.entry_cents, a.input_tokens, a.output_tokens, a.total_tokens,
      l.winner
    from desk_openai_shadow a
    left join desk_ledger_research l
      on l.ticker = a.ticker
      and l.close_time = a.close_time
      and l.source = 'kalshi-result'
    where a.study = ${OPENAI_SHADOW_STUDY}
      and a.version = ${OPENAI_SHADOW_VERSION}
      and a.prompt_version = ${OPENAI_SHADOW_PROMPT_VERSION}
      and a.taken_at >= ${new Date(OPENAI_SHADOW_PROSPECTIVE_SINCE).toISOString()}::timestamptz
      and a.taken_at < a.close_time
    order by a.close_time asc
  `;

  const graded = rows.filter(
    (r): r is StoredRow & { winner: OpenAIShadowSide } => r.winner === "UP" || r.winner === "DOWN",
  );
  const hits = graded.reduce((n, r) => n + openAIShadowHit(r.side, r.winner), 0);
  const marketRows = graded.filter((r) => r.market_p != null);
  const marketHits = marketRows.reduce(
    (n, r) => n + openAIShadowHit((r.market_p ?? 0.5) >= 0.5 ? "UP" : "DOWN", r.winner),
    0,
  );
  const nonAbstain = graded.filter((r) => !r.would_abstain);
  const nonAbstainHits = nonAbstain.reduce((n, r) => n + openAIShadowHit(r.side, r.winner), 0);
  const chairWait = graded.filter((r) => r.chair_lean === "WAIT");
  const chairWaitHits = chairWait.reduce((n, r) => n + openAIShadowHit(r.side, r.winner), 0);

  const first = rows[0] ?? null;
  let expected = 0;
  if (first) {
    const firstClose = Number(first.close_ms);
    const latestDueClose = Math.floor((Date.now() + OPENAI_SHADOW_LOCK_SECS * 1000) / 900_000) * 900_000;
    expected = latestDueClose >= firstClose ? Math.floor((latestDueClose - firstClose) / 900_000) + 1 : 0;
  }

  const tokenSum = (key: "input_tokens" | "output_tokens" | "total_tokens") =>
    rows.reduce((n, r) => n + Math.max(0, Number(r[key] ?? 0) || 0), 0);

  return {
    study: OPENAI_SHADOW_STUDY,
    since: new Date(OPENAI_SHADOW_PROSPECTIVE_SINCE).toISOString(),
    prompt_version: OPENAI_SHADOW_PROMPT_VERSION,
    model: openAIShadowHealth().model,
    lock: {
      seconds_before_close: OPENAI_SHADOW_LOCK_SECS,
      grace_seconds: OPENAI_SHADOW_LOCK_GRACE_SECS,
    },
    authority: {
      live_chair: false,
      paper_book: false,
      learner: false,
      promotion: false,
      execution: false,
    },
    captured: rows.length,
    graded: graded.length,
    hits,
    accuracy: graded.length ? round(hits / graded.length) : null,
    brier: graded.length ? round(avg(graded.map((r) => openAIShadowBrier(r.p_up, r.winner))) ?? 0, 6) : null,
    market_brier: marketRows.length
      ? round(avg(marketRows.map((r) => openAIShadowBrier(r.market_p ?? 0.5, r.winner))) ?? 0, 6)
      : null,
    market_accuracy: marketRows.length ? round(marketHits / marketRows.length) : null,
    abstain_n: rows.filter((r) => r.would_abstain).length,
    non_abstain: {
      n: nonAbstain.length,
      hits: nonAbstainHits,
      accuracy: nonAbstain.length ? round(nonAbstainHits / nonAbstain.length) : null,
    },
    when_chair_wait: {
      n: chairWait.length,
      hits: chairWaitHits,
      accuracy: chairWait.length ? round(chairWaitHits / chairWait.length) : null,
    },
    usage: {
      input_tokens: tokenSum("input_tokens"),
      output_tokens: tokenSum("output_tokens"),
      total_tokens: tokenSum("total_tokens"),
    },
    coverage: {
      expected_since_first: expected,
      captured_since_first: rows.length,
      missing: Math.max(0, expected - rows.length),
    },
    first_capture: first ? new Date(Number(first.taken_ms)).toISOString() : null,
    health: openAIShadowHealth(),
    recent: rows.slice(-16).reverse().map((r) => ({
      ticker: r.ticker,
      close_time: new Date(Number(r.close_ms)).toISOString(),
      side: r.side,
      p_up: r.p_up,
      would_abstain: r.would_abstain,
      winner: r.winner,
    })),
  };
}
