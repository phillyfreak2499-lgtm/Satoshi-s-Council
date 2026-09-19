/**
 * OPENAI_BLIND_V1 prospective market-blind observer.
 *
 * One same-time paper-research forecast at T-7:30. The model sees no Kalshi
 * prices/fair, Council votes, SATOSHI, or entry economics. Those comparators are
 * recorded only after the blind forecast is frozen. No decision path imports it.
 */
import { createHash } from "node:crypto";
import { getSql } from "@/lib/db";
import {
  OPENAI_BLIND_DEFAULT_MODEL,
  OPENAI_BLIND_LOCK_GRACE_SECS,
  OPENAI_BLIND_LOCK_SECS,
  OPENAI_BLIND_PROMPT_VERSION,
  OPENAI_BLIND_SCHEMA,
  OPENAI_BLIND_STUDY,
  OPENAI_BLIND_VERSION,
  buildOpenAIBlindPacket,
  inOpenAIBlindLock,
  openAIBlindBrier,
  openAIBlindHit,
  parseOpenAIBlindDecision,
  type OpenAIBlindDecision,
  type OpenAIBlindSide,
} from "./openai-blind";
import { tickerAgrees } from "./window-identity";

export const OPENAI_BLIND_PROSPECTIVE_SINCE = Date.parse("2026-09-19T14:00:00.000Z");
const OBSERVER_MS = 2_000;
const REQUEST_TIMEOUT_MS = 10_000;

const INSTRUCTIONS = `You are OPENAI_BLIND_V1, a paper-only research analyst for a Bitcoin 15-minute forecasting experiment.

Authority and safety:
- You have no execution authority.
- Do not recommend or discuss real-money betting, wagering, order placement, position sizing, wallets, transfers, or financial advice.
- Do not call tools, browse the web, request more data, or use information outside the frozen packet.
- Never claim a fill or trade occurred.

Blindness:
- Kalshi prices, market-implied probability, desk fair value, Council votes and SATOSHI are intentionally absent.
- Do not guess, reconstruct or assume omitted market/Council fields.
- Treat the supplied packet as the complete evidence available.

Research task:
- Estimate P(UP) for the official settlement of this one frozen 15-minute window using only the supplied Bitcoin, derivatives and context fields.
- p_up is a calibrated probability target, not a confidence score.
- side MUST be UP when p_up >= 0.5 and DOWN when p_up < 0.5.
- conviction is a separate 0-100 self-rated evidence-strength label.
- strongest_evidence and contradictions must name supplied evidence only.
- would_abstain may be true when evidence is weak, but p_up and side remain mandatory so every capture can be scored.
- Output only the required structured object.`;

type ApiUsage = { input_tokens?: number; output_tokens?: number; total_tokens?: number };
type ApiResponse = {
  id?: string;
  status?: string;
  output_text?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string; refusal?: string }> }>;
  error?: { message?: string };
  usage?: ApiUsage;
};

type StoredRow = {
  ticker: string;
  close_ms: number | string;
  taken_ms: number | string;
  market_p: number | null;
  p_up: number;
  side: OpenAIBlindSide;
  would_abstain: boolean;
  chair_lean: "UP" | "DOWN" | "WAIT";
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  winner: string | null;
  aware_p: number | null;
  aware_side: string | null;
};

type Observer = {
  timer: ReturnType<typeof setInterval> | null;
  inFlight: boolean;
  sampled: Set<string>;
  lastError: string | null;
  lastCapturedAt: number;
  lastLatencyMs: number | null;
};

const g = globalThis as typeof globalThis & { __openAIBlindObserver__?: Observer };
function observer(): Observer {
  return (g.__openAIBlindObserver__ ??= {
    timer: null,
    inFlight: false,
    sampled: new Set(),
    lastError: null,
    lastCapturedAt: 0,
    lastLatencyMs: null,
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
      if (content.type === "output_text" && typeof content.text === "string" && content.text.trim()) return content.text;
      if (content.type === "refusal" && typeof content.refusal === "string") {
        throw new Error(`OpenAI refused the blind paper-research forecast: ${content.refusal.slice(0, 240)}`);
      }
    }
  }
  return null;
}

async function requestForecast(
  packet: ReturnType<typeof buildOpenAIBlindPacket>,
  model: string,
  apiKey: string,
): Promise<{ decision: OpenAIBlindDecision; responseId: string; usage: ApiUsage; latencyMs: number }> {
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
      input: `Frozen market-blind same-time research packet:\n${JSON.stringify(packet)}`,
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "openai_blind_v1",
          strict: true,
          schema: OPENAI_BLIND_SCHEMA,
        },
      },
      metadata: {
        study: OPENAI_BLIND_STUDY,
        prompt_version: OPENAI_BLIND_PROMPT_VERSION,
      },
    }),
  });

  const body = (await res.json().catch(() => ({}))) as ApiResponse;
  if (!res.ok) {
    throw new Error(`OpenAI Responses API: ${body.error?.message?.slice(0, 320) || `HTTP ${res.status}`}`);
  }
  if (body.status && body.status !== "completed") throw new Error(`OpenAI blind response not completed: ${body.status}`);
  const text = responseText(body);
  if (!text) throw new Error("OpenAI blind response contained no structured output");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("OpenAI blind structured output was not valid JSON");
  }
  const decision = parseOpenAIBlindDecision(parsed);
  if (!decision) throw new Error("OpenAI blind structured output failed local invariant checks");
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
      select 1 from desk_openai_blind
       where ticker = ${ticker}
         and close_time = ${new Date(closeTime).toISOString()}::timestamptz
    ) as present
  `;
  return rows[0]?.present === true;
}

async function captureOnce(): Promise<void> {
  const st = observer();
  if (st.inFlight || Date.now() < OPENAI_BLIND_PROSPECTIVE_SINCE) return;

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    st.lastError = null;
    return;
  }
  const model = process.env.OPENAI_BLIND_MODEL?.trim() || OPENAI_BLIND_DEFAULT_MODEL;

  st.inFlight = true;
  try {
    const { getServerFrame } = await import("./server-engine");
    const frame = await getServerFrame();
    const frozen = structuredClone({ snap: frame.snap, chair: frame.chair });
    const { snap, chair } = frozen;

    if (!snap || snap.demo || snap.as_of < OPENAI_BLIND_PROSPECTIVE_SINCE) return;
    if (!snap.ticker || tickerAgrees(snap.ticker, snap.close_time) !== true) return;
    if (!inOpenAIBlindLock(Number(snap.secs_left))) return;

    const key = `${snap.ticker}|${snap.close_time}`;
    if (st.sampled.has(key)) return;
    if (await alreadyCaptured(snap.ticker, snap.close_time)) {
      st.sampled.add(key);
      return;
    }

    // Only snap enters the blind builder. Market/Council/Chair comparators below
    // are read AFTER the model result is frozen.
    const packet = buildOpenAIBlindPacket(snap);
    const packetJson = JSON.stringify(packet);
    const inputHash = createHash("sha256").update(packetJson).digest("hex");
    const forecast = await requestForecast(packet, model, apiKey);
    const pred = forecast.decision;

    const chairLean =
      chair?.lean === "UP" || chair?.lean === "DOWN" || chair?.lean === "WAIT"
        ? chair.lean
        : "WAIT";
    const yesAsk = validAsk(snap.yes_ask);
    const noAsk = validAsk(snap.no_ask);
    const entry = pred.side === "UP" ? yesAsk : noAsk;
    const marketP = probFromCents(snap.yes_mid);
    const fairP = probFromCents(snap.fair_yes);

    const db = await getSql();
    await db`
      insert into desk_openai_blind (
        ticker, close_time, taken_at, secs_left, study, version, prompt_version,
        model, response_id, input_hash, input_packet, market_p, fair_p, p_up, side,
        conviction, regime, strongest_evidence, contradictions, data_quality,
        would_abstain, chair_lean, yes_ask, no_ask, entry_cents,
        input_tokens, output_tokens, total_tokens, latency_ms, build_sha
      )
      select
        ${snap.ticker},
        ${new Date(snap.close_time).toISOString()}::timestamptz,
        ${new Date(snap.as_of).toISOString()}::timestamptz,
        ${Number(snap.secs_left)},
        ${OPENAI_BLIND_STUDY},
        ${OPENAI_BLIND_VERSION},
        ${OPENAI_BLIND_PROMPT_VERSION},
        ${model},
        ${forecast.responseId},
        ${inputHash},
        ${packetJson}::jsonb,
        ${marketP},
        ${fairP},
        ${pred.p_up},
        ${pred.side},
        ${pred.conviction},
        ${pred.regime},
        ${JSON.stringify(pred.strongest_evidence)}::jsonb,
        ${JSON.stringify(pred.contradictions)}::jsonb,
        ${pred.data_quality},
        ${pred.would_abstain},
        ${chairLean},
        ${yesAsk},
        ${noAsk},
        ${entry},
        ${num(forecast.usage.input_tokens)},
        ${num(forecast.usage.output_tokens)},
        ${num(forecast.usage.total_tokens)},
        ${forecast.latencyMs},
        ${process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? ""}
      where clock_timestamp() < ${new Date(snap.close_time).toISOString()}::timestamptz
      on conflict (ticker, close_time) do nothing
    `;

    st.sampled.add(key);
    st.lastCapturedAt = Date.now();
    st.lastLatencyMs = forecast.latencyMs;
    st.lastError = null;
  } catch (err) {
    st.lastError = err instanceof Error ? err.message : String(err);
  } finally {
    st.inFlight = false;
  }
}

export function ensureOpenAIBlindObserver(): void {
  const st = observer();
  if (st.timer) return;
  st.timer = setInterval(() => void captureOnce(), OBSERVER_MS);
  void captureOnce();
}

export function openAIBlindHealth() {
  const st = observer();
  return {
    started: Boolean(st.timer),
    configured: Boolean(process.env.OPENAI_API_KEY?.trim()),
    model: process.env.OPENAI_BLIND_MODEL?.trim() || OPENAI_BLIND_DEFAULT_MODEL,
    last_captured_at: st.lastCapturedAt ? new Date(st.lastCapturedAt).toISOString() : null,
    last_latency_ms: st.lastLatencyMs,
    last_error: st.lastError,
  };
}

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export type OpenAIBlindSnapshot = {
  study: typeof OPENAI_BLIND_STUDY;
  since: string;
  prompt_version: string;
  model: string;
  lock: { seconds_before_close: number; grace_seconds: number };
  authority: { live_chair: false; paper_book: false; learner: false; promotion: false; execution: false };
  blindness: {
    kalshi_prices: false;
    desk_fair: false;
    council_votes: false;
    chair: false;
  };
  captured: number;
  graded: number;
  hits: number;
  accuracy: number | null;
  brier: number | null;
  market_brier: number | null;
  market_aware_brier: number | null;
  paired_with_market_aware: number;
  agreement_with_market_aware: number | null;
  disagreement: { n: number; blind_hits: number; aware_hits: number };
  abstain_n: number;
  usage: { input_tokens: number; output_tokens: number; total_tokens: number };
  coverage: { expected_since_first: number; captured_since_first: number; missing: number };
  health: ReturnType<typeof openAIBlindHealth>;
};

export async function openAIBlindSnapshot(): Promise<OpenAIBlindSnapshot> {
  const db = await getSql();
  const rows = await db<StoredRow>`
    select
      b.ticker,
      (extract(epoch from b.close_time) * 1000)::bigint as close_ms,
      (extract(epoch from b.taken_at) * 1000)::bigint as taken_ms,
      b.market_p, b.p_up, b.side, b.would_abstain, b.chair_lean,
      b.input_tokens, b.output_tokens, b.total_tokens,
      l.winner,
      a.p_up as aware_p,
      a.side as aware_side
    from desk_openai_blind b
    left join desk_ledger_research l
      on l.ticker = b.ticker and l.close_time = b.close_time and l.source = 'kalshi-result'
    left join desk_openai_shadow a
      on a.ticker = b.ticker and a.close_time = b.close_time
    where b.study = ${OPENAI_BLIND_STUDY}
      and b.version = ${OPENAI_BLIND_VERSION}
      and b.prompt_version = ${OPENAI_BLIND_PROMPT_VERSION}
      and b.taken_at >= ${new Date(OPENAI_BLIND_PROSPECTIVE_SINCE).toISOString()}::timestamptz
      and b.taken_at < b.close_time
    order by b.close_time asc
  `;

  const graded = rows.filter(
    (r): r is StoredRow & { winner: OpenAIBlindSide } => r.winner === "UP" || r.winner === "DOWN",
  );
  const hits = graded.reduce((n, r) => n + openAIBlindHit(r.side, r.winner), 0);
  const marketRows = graded.filter((r) => r.market_p != null);
  const paired = graded.filter(
    (r): r is StoredRow & { winner: OpenAIBlindSide; aware_p: number; aware_side: OpenAIBlindSide } =>
      r.aware_p != null && (r.aware_side === "UP" || r.aware_side === "DOWN"),
  );
  const disagreements = paired.filter((r) => r.side !== r.aware_side);
  const blindDisagreeHits = disagreements.reduce((n, r) => n + openAIBlindHit(r.side, r.winner), 0);
  const awareDisagreeHits = disagreements.reduce((n, r) => n + openAIBlindHit(r.aware_side, r.winner), 0);

  const first = rows[0] ?? null;
  let expected = 0;
  if (first) {
    const firstClose = Number(first.close_ms);
    const latestDueClose = Math.floor((Date.now() + OPENAI_BLIND_LOCK_SECS * 1000) / 900_000) * 900_000;
    expected = latestDueClose >= firstClose ? Math.floor((latestDueClose - firstClose) / 900_000) + 1 : 0;
  }

  const tokenSum = (key: "input_tokens" | "output_tokens" | "total_tokens") =>
    rows.reduce((n, r) => n + Math.max(0, Number(r[key] ?? 0) || 0), 0);

  return {
    study: OPENAI_BLIND_STUDY,
    since: new Date(OPENAI_BLIND_PROSPECTIVE_SINCE).toISOString(),
    prompt_version: OPENAI_BLIND_PROMPT_VERSION,
    model: openAIBlindHealth().model,
    lock: { seconds_before_close: OPENAI_BLIND_LOCK_SECS, grace_seconds: OPENAI_BLIND_LOCK_GRACE_SECS },
    authority: { live_chair: false, paper_book: false, learner: false, promotion: false, execution: false },
    blindness: { kalshi_prices: false, desk_fair: false, council_votes: false, chair: false },
    captured: rows.length,
    graded: graded.length,
    hits,
    accuracy: graded.length ? round(hits / graded.length) : null,
    brier: graded.length ? round(avg(graded.map((r) => openAIBlindBrier(r.p_up, r.winner))) ?? 0, 6) : null,
    market_brier: marketRows.length
      ? round(avg(marketRows.map((r) => openAIBlindBrier(r.market_p ?? 0.5, r.winner))) ?? 0, 6)
      : null,
    market_aware_brier: paired.length
      ? round(avg(paired.map((r) => openAIBlindBrier(r.aware_p, r.winner))) ?? 0, 6)
      : null,
    paired_with_market_aware: paired.length,
    agreement_with_market_aware: paired.length
      ? round(paired.filter((r) => r.side === r.aware_side).length / paired.length)
      : null,
    disagreement: {
      n: disagreements.length,
      blind_hits: blindDisagreeHits,
      aware_hits: awareDisagreeHits,
    },
    abstain_n: rows.filter((r) => r.would_abstain).length,
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
    health: openAIBlindHealth(),
  };
}
