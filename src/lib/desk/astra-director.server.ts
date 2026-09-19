/**
 * ASTRA_RESEARCH_DIRECTOR_V1 periodic report-only observer.
 *
 * Trigger: every 384 new research-valid graded 15-minute windows.
 * Input: frozen aggregate research evidence + deterministic promotion gates.
 * Output: a structured research report and nominations only.
 *
 * No actuator exists here. This module never imports or calls Chair/booking/
 * learner mutation functions and writes only desk_astra_director.
 */
import { createHash } from "node:crypto";
import { getSql } from "@/lib/db";
import {
  ASTRA_DIRECTOR_MODEL,
  ASTRA_DIRECTOR_PROMPT_VERSION,
  ASTRA_DIRECTOR_SCHEMA,
  ASTRA_DIRECTOR_STUDY,
  ASTRA_DIRECTOR_VERSION,
  ASTRA_DIRECTOR_WINDOW_BATCH,
  parseAstraDirectorReport,
  type AstraDirectorReport,
} from "./astra-director";
import { callQualitySnapshot } from "./call-quality.server";
import { cubeStudy } from "./cube.server";
import { forcedV4Snapshot } from "./forced-v4.server";
import { labRegistrySnapshot } from "./lab-registry.server";
import { openAIShadowSnapshot } from "./openai-shadow.server";
import { openAIBlindSnapshot } from "./openai-blind.server";
import { openAILunaSnapshot } from "./openai-luna.server";
import { labStanding } from "./policy-lab.server";
import { evaluateComponentGates, type Pair } from "./promotion-gates";
import { redundancyStudy } from "./redundancy.server";
import { signalStudy } from "./seat-signal.server";

const OBSERVER_MS = 60_000;
const API_REQUEST_TIMEOUT_MS = 30_000;
const RETRY_AFTER_MS = 15 * 60_000;

const INSTRUCTIONS = `You are ASTRA_RESEARCH_DIRECTOR_V1 for Satoshi's Council, a paper-only Bitcoin research system.

Your job is periodic research governance, not trading.

Hard authority limits:
- You cannot place or recommend real-money orders, positions, wallets, transfers, sizing, or financial advice.
- You cannot change SATOSHI, any seat, any threshold, learned weight, paper-book rule, or promotion gate.
- You cannot promote or demote anything. You may only nominate PROMOTION_REVIEW or RETIRE_REVIEW.
- Deterministic promotion gate results in the packet are authoritative. Never call a candidate ELIGIBLE when code says BLOCKED or INSUFFICIENT.
- A PROMOTION_REVIEW nomination is allowed only when that candidate's deterministic gate_status is ELIGIBLE.
- Seat changes must remain SHADOW tests or investigation. Never recommend an immediate live gag/reweight.
- Do not use outside knowledge, browse, call tools, or request more data.

Research task:
- Compare the newest 384-window block with the preceding block.
- Look for regime changes, degradation, improvement, redundant seats, stale research, candidate strength/weakness, and disagreement among market-aware Terra, market-blind Terra, low-cost Luna, forced-direction research and the live Floor.
- When Terra and Luna use the same packet, explicitly assess whether Terra's higher cost is buying enough measurable value to justify keeping it at high frequency.
- Distinguish in-sample descriptive patterns from prospective evidence.
- Prefer fewer, stronger findings over a long speculative list.
- Use LOW/MEDIUM/HIGH confidence conservatively.
- Propose specific next shadow tests when evidence is interesting but not promotion-grade.
- Output only the required structured object.`;

type Usage = { input_tokens?: number; output_tokens?: number; total_tokens?: number };
type ApiResponse = {
  id?: string;
  status?: string;
  output_text?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string; refusal?: string }> }>;
  error?: { message?: string };
  incomplete_details?: { reason?: string };
  usage?: Usage;
};

type Observer = {
  timer: ReturnType<typeof setInterval> | null;
  inFlight: boolean;
  lastError: string | null;
  lastRunAt: number;
  lastLatencyMs: number | null;
};

const g = globalThis as typeof globalThis & { __astraDirectorObserver__?: Observer };
function observer(): Observer {
  return (g.__astraDirectorObserver__ ??= {
    timer: null,
    inFlight: false,
    lastError: null,
    lastRunAt: 0,
    lastLatencyMs: null,
  });
}

const finite = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const iso = (v: Date | string): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());

function responseText(body: ApiResponse): string | null {
  if (typeof body.output_text === "string" && body.output_text.trim()) return body.output_text;
  for (const item of body.output ?? []) {
    for (const part of item.content ?? []) {
      if (part.type === "output_text" && typeof part.text === "string" && part.text.trim()) return part.text;
      if (part.type === "refusal" && typeof part.refusal === "string") {
        throw new Error(`Astra refused the paper-research review: ${part.refusal.slice(0, 240)}`);
      }
    }
  }
  return null;
}

type LedgerRow = {
  close_time: Date | string;
  winner: string;
  chair_lean: string;
  entry_lean: string | null;
  entry_cents: number | null;
  ev_cents: number | null;
  entry_regime: string | null;
};

function summarizeBlock(rows: LedgerRow[]) {
  const n = rows.length;
  const entries = rows.filter((r) => r.entry_cents != null && (r.entry_lean === "UP" || r.entry_lean === "DOWN"));
  const hits = entries.filter((r) => r.entry_lean === r.winner).length;
  const net = entries.reduce((sum, r) => sum + (finite(r.ev_cents) ?? 0), 0);
  const waits = rows.filter((r) => r.chair_lean === "WAIT").length;
  const regimes = new Map<string, number>();
  for (const r of rows) {
    const key = r.entry_regime || "unknown";
    regimes.set(key, (regimes.get(key) ?? 0) + 1);
  }
  return {
    windows: n,
    paper_entries: entries.length,
    entry_rate: n ? entries.length / n : null,
    hits,
    accuracy: entries.length ? hits / entries.length : null,
    net_cents: Math.round(net * 10) / 10,
    avg_net_cents: entries.length ? Math.round((net / entries.length) * 100) / 100 : null,
    chair_wait_rate: n ? waits / n : null,
    regimes: [...regimes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([regime, count]) => ({ regime, count })),
  };
}

type PairRow = {
  candidate_id: string;
  close_time: Date | string;
  candidate_net: number | null;
  champion_net: number | null;
  regime: string | null;
};

async function promotionGatePacket() {
  const db = await getSql();
  const rows = await db<PairRow>`
    select c.candidate_id, c.close_time,
           c.net_cents as candidate_net,
           h.net_cents as champion_net,
           l.entry_regime as regime
      from desk_policy_observations_research c
      join desk_policy_observations_research h
        on h.fill_key = c.fill_key and h.candidate_id = 'HOLD_V1'
      join desk_ledger_research l
        on l.ticker = c.ticker and l.close_time = c.close_time
     where c.candidate_id <> 'HOLD_V1'
       and c.net_cents is not null
       and h.net_cents is not null
     order by c.close_time
  `;
  const ids = [...new Set(rows.map((r) => r.candidate_id))];
  const competitors = Math.max(1, ids.length);
  return ids.map((candidateId) => {
    const own = rows.filter((r) => r.candidate_id === candidateId);
    const pairs: Pair[] = own.map((r) => ({
      day: iso(r.close_time).slice(0, 10),
      candidate_net: Number(r.candidate_net),
      champion_net: Number(r.champion_net),
      regime: r.regime ?? undefined,
    }));
    const evaluation = evaluateComponentGates({
      candidate_id: candidateId,
      pairs,
      candidate_nets: pairs.map((p) => p.candidate_net),
      champion_nets: pairs.map((p) => p.champion_net),
      days: new Set(pairs.map((p) => p.day)).size,
      paired_control_losses: pairs.filter((p) => p.champion_net < 0).length,
      competitors,
    });
    const hasFail = evaluation.gates.some((gate) => gate.state === "fail");
    const gate_status = evaluation.all_required_passed ? "ELIGIBLE" : hasFail ? "BLOCKED" : "INSUFFICIENT";
    return {
      candidate_id: candidateId,
      gate_status,
      passed: evaluation.passed,
      total: evaluation.total,
      blocked_by: evaluation.blocked_by,
      gates: evaluation.gates.map((gate) => ({
        id: gate.id,
        state: gate.state,
        detail: gate.detail,
      })),
    };
  });
}

async function buildPacket(gradedTotal: number, throughClose: string) {
  const db = await getSql();
  const raw = await db<LedgerRow>`
    select close_time, winner, chair_lean, entry_lean, entry_cents, ev_cents, entry_regime
      from desk_ledger_research
     where winner in ('UP','DOWN')
     order by close_time desc
     limit ${ASTRA_DIRECTOR_WINDOW_BATCH * 2}
  `;
  const newest = raw.slice(0, ASTRA_DIRECTOR_WINDOW_BATCH).reverse();
  const prior = raw.slice(ASTRA_DIRECTOR_WINDOW_BATCH, ASTRA_DIRECTOR_WINDOW_BATCH * 2).reverse();

  const [standing, registry, callQuality, forcedV4, openai, blind, luna, cube, redundancy, signal, promotion] = await Promise.all([
    labStanding().catch(() => null),
    labRegistrySnapshot().catch(() => null),
    callQualitySnapshot().catch(() => null),
    forcedV4Snapshot().catch(() => null),
    openAIShadowSnapshot().catch(() => null),
    openAIBlindSnapshot().catch(() => null),
    openAILunaSnapshot().catch(() => null),
    cubeStudy().catch(() => null),
    redundancyStudy().catch(() => null),
    signalStudy().catch(() => null),
    promotionGatePacket().catch(() => []),
  ]);

  return {
    protocol: ASTRA_DIRECTOR_STUDY,
    prompt_version: ASTRA_DIRECTOR_PROMPT_VERSION,
    model: ASTRA_DIRECTOR_MODEL,
    window_batch: ASTRA_DIRECTOR_WINDOW_BATCH,
    through_close_time: throughClose,
    graded_total: gradedTotal,
    authority: {
      model_can_promote: false,
      model_can_demote: false,
      model_can_reweight: false,
      model_can_trade: false,
      deterministic_gates_control_eligibility: true,
    },
    floor_blocks: {
      newest: summarizeBlock(newest),
      prior: summarizeBlock(prior),
    },
    lab: {
      standing,
      deterministic_promotion_gates: promotion,
      registry,
      call_quality: callQuality,
      forced_direction_v4: forcedV4,
      openai_market_aware: openai,
      openai_market_blind: blind,
      openai_luna_low_cost: luna,
    },
    pattern_studies: {
      performance_cube: cube,
      redundancy,
      seat_signal: signal,
    },
  };
}

type BackgroundJobRow = {
  id: number;
  through_close_time: Date | string;
  graded_total: number;
  packet: Awaited<ReturnType<typeof buildPacket>>;
  response_id: string;
  status: string;
  attempt: number;
  started_at: Date | string;
  last_polled_at: Date | string | null;
};

const pendingStatuses = new Set(["queued", "in_progress"]);
const terminalFailureStatuses = new Set(["failed", "incomplete", "expired", "cancelled"]);

function normalizeStatus(value: unknown): string {
  const status = String(value ?? "in_progress");
  if (status === "queued" || status === "in_progress" || status === "completed" || terminalFailureStatuses.has(status)) {
    return status;
  }
  return "in_progress";
}

function validateReport(
  body: ApiResponse,
  packet: Awaited<ReturnType<typeof buildPacket>>,
): { report: AstraDirectorReport; usage: Usage } {
  const text = responseText(body);
  if (!text) throw new Error("Astra response contained no structured output");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Astra structured output was not valid JSON");
  }
  const report = parseAstraDirectorReport(parsed);
  if (!report) throw new Error("Astra structured output failed local invariant checks");

  const gateStatus = new Map(packet.lab.deterministic_promotion_gates.map((g) => [g.candidate_id, g.gate_status]));
  for (const action of report.lab_actions) {
    if (action.action === "PROMOTION_REVIEW" && gateStatus.get(action.candidate_id) !== "ELIGIBLE") {
      throw new Error(`Astra nominated ${action.candidate_id} for promotion review without deterministic eligibility`);
    }
  }
  return { report, usage: body.usage ?? {} };
}

async function createBackgroundReport(
  packet: Awaited<ReturnType<typeof buildPacket>>,
  apiKey: string,
): Promise<{ body: ApiResponse; latencyMs: number }> {
  const started = Date.now();
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    signal: AbortSignal.timeout(API_REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      model: ASTRA_DIRECTOR_MODEL,
      background: true,
      store: false,
      reasoning: { effort: "high" },
      max_output_tokens: 3600,
      instructions: INSTRUCTIONS,
      input: `Frozen periodic research packet:\n${JSON.stringify(packet)}`,
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "astra_research_director_v1",
          strict: true,
          schema: ASTRA_DIRECTOR_SCHEMA,
        },
      },
      metadata: {
        study: ASTRA_DIRECTOR_STUDY,
        prompt_version: ASTRA_DIRECTOR_PROMPT_VERSION,
      },
    }),
  });
  const body = (await res.json().catch(() => ({}))) as ApiResponse;
  if (!res.ok) {
    throw new Error(`OpenAI Responses API: ${body.error?.message?.slice(0, 320) || `HTTP ${res.status}`}`);
  }
  if (!body.id) throw new Error("Astra background response did not return an id");
  return { body, latencyMs: Math.max(0, Date.now() - started) };
}

async function pollBackgroundReport(responseId: string, apiKey: string): Promise<ApiResponse> {
  const res = await fetch(`https://api.openai.com/v1/responses/${encodeURIComponent(responseId)}`, {
    method: "GET",
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(API_REQUEST_TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => ({}))) as ApiResponse;
  if (!res.ok) {
    throw new Error(`OpenAI Responses API poll: ${body.error?.message?.slice(0, 320) || `HTTP ${res.status}`}`);
  }
  return body;
}

async function pendingJob(): Promise<BackgroundJobRow | null> {
  const db = await getSql();
  const [row] = await db<BackgroundJobRow>`
    select id, through_close_time, graded_total, packet, response_id, status,
           attempt, started_at, last_polled_at
      from desk_astra_director_jobs
     where study = ${ASTRA_DIRECTOR_STUDY}
       and version = ${ASTRA_DIRECTOR_VERSION}
       and status in ('queued','in_progress')
     order by started_at desc
     limit 1
  `;
  return row ?? null;
}

async function latestJobForWindow(throughClose: string): Promise<BackgroundJobRow | null> {
  const db = await getSql();
  const [row] = await db<BackgroundJobRow>`
    select id, through_close_time, graded_total, packet, response_id, status,
           attempt, started_at, last_polled_at
      from desk_astra_director_jobs
     where study = ${ASTRA_DIRECTOR_STUDY}
       and version = ${ASTRA_DIRECTOR_VERSION}
       and through_close_time = ${throughClose}::timestamptz
     order by attempt desc, started_at desc
     limit 1
  `;
  return row ?? null;
}

async function finalizeJob(job: BackgroundJobRow, body: ApiResponse): Promise<void> {
  const parsed = validateReport(body, job.packet);
  const db = await getSql();
  const latencyMs = Math.max(0, Date.now() - new Date(job.started_at).getTime());
  await db`
    insert into desk_astra_director (
      study, version, prompt_version, model, window_batch, through_close_time,
      graded_total, packet_hash, packet, report, response_id,
      input_tokens, output_tokens, total_tokens, latency_ms, build_sha
    )
    select
      ${ASTRA_DIRECTOR_STUDY}, ${ASTRA_DIRECTOR_VERSION}, ${ASTRA_DIRECTOR_PROMPT_VERSION},
      ${ASTRA_DIRECTOR_MODEL}, ${ASTRA_DIRECTOR_WINDOW_BATCH}, j.through_close_time,
      j.graded_total, j.packet_hash, j.packet, ${JSON.stringify(parsed.report)}::jsonb,
      j.response_id, ${finite(parsed.usage.input_tokens)}, ${finite(parsed.usage.output_tokens)},
      ${finite(parsed.usage.total_tokens)}, ${latencyMs}, j.build_sha
      from desk_astra_director_jobs j
     where j.id = ${job.id}
    on conflict (study, version, through_close_time) do nothing
  `;
  await db`
    update desk_astra_director_jobs
       set status = 'completed',
           completed_at = now(),
           last_polled_at = now(),
           last_error = null
     where id = ${job.id}
  `;
  const st = observer();
  st.lastRunAt = Date.now();
  st.lastLatencyMs = latencyMs;
  st.lastError = null;
}

async function processPendingJob(apiKey: string): Promise<boolean> {
  const job = await pendingJob();
  if (!job) return false;
  const body = await pollBackgroundReport(job.response_id, apiKey);
  const status = normalizeStatus(body.status);
  const db = await getSql();

  if (status === "completed") {
    try {
      await finalizeJob(job, body);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db`
        update desk_astra_director_jobs
           set status = 'failed', last_polled_at = now(), completed_at = now(),
               last_error = ${msg.slice(0, 1000)}
         where id = ${job.id}
      `;
      observer().lastError = msg;
    }
    return true;
  }

  if (terminalFailureStatuses.has(status)) {
    const msg = body.error?.message || body.incomplete_details?.reason || `Astra background response ended as ${status}`;
    await db`
      update desk_astra_director_jobs
         set status = ${status}, last_polled_at = now(), completed_at = now(),
             last_error = ${msg.slice(0, 1000)}
       where id = ${job.id}
    `;
    observer().lastError = msg;
    return true;
  }

  await db`
    update desk_astra_director_jobs
       set status = ${status}, last_polled_at = now(), last_error = null
     where id = ${job.id}
  `;
  observer().lastError = null;
  return true;
}

async function dueState(): Promise<{ due: boolean; gradedTotal: number; throughClose: string | null; lastTotal: number }> {
  const db = await getSql();
  const [totals] = await db<{ n: number; through_close: Date | string | null }>`
    select count(*)::int as n, max(close_time) as through_close
      from desk_ledger_research
     where winner in ('UP','DOWN')
  `;
  const [last] = await db<{ graded_total: number }>`
    select graded_total from desk_astra_director
     where study = ${ASTRA_DIRECTOR_STUDY} and version = ${ASTRA_DIRECTOR_VERSION}
     order by id desc limit 1
  `;
  const gradedTotal = Number(totals?.n ?? 0);
  const lastTotal = Number(last?.graded_total ?? 0);
  const throughClose = totals?.through_close ? iso(totals.through_close) : null;
  return {
    due: Boolean(throughClose) && gradedTotal >= Math.max(ASTRA_DIRECTOR_WINDOW_BATCH, lastTotal + ASTRA_DIRECTOR_WINDOW_BATCH),
    gradedTotal,
    throughClose,
    lastTotal,
  };
}

async function captureIfDue(): Promise<void> {
  const st = observer();
  if (st.inFlight) return;
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    st.lastError = null;
    return;
  }
  st.inFlight = true;
  try {
    if (await processPendingJob(apiKey)) return;

    const due = await dueState();
    if (!due.due || !due.throughClose) return;

    const latest = await latestJobForWindow(due.throughClose);
    if (latest && !pendingStatuses.has(latest.status)) {
      const age = Date.now() - new Date(latest.started_at).getTime();
      if (age < RETRY_AFTER_MS) return;
    }

    const packet = await buildPacket(due.gradedTotal, due.throughClose);
    const packetJson = JSON.stringify(packet);
    const packetHash = createHash("sha256").update(packetJson).digest("hex");
    const started = await createBackgroundReport(packet, apiKey);
    const status = normalizeStatus(started.body.status);
    const responseId = started.body.id ?? "";
    const attempt = Math.max(1, Number(latest?.attempt ?? 0) + 1);
    const db = await getSql();
    const [job] = await db<BackgroundJobRow>`
      insert into desk_astra_director_jobs (
        study, version, through_close_time, graded_total, packet_hash, packet,
        response_id, status, attempt, build_sha
      ) values (
        ${ASTRA_DIRECTOR_STUDY}, ${ASTRA_DIRECTOR_VERSION}, ${due.throughClose}::timestamptz,
        ${due.gradedTotal}, ${packetHash}, ${packetJson}::jsonb, ${responseId},
        ${status}, ${attempt}, ${process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? ""}
      )
      returning id, through_close_time, graded_total, packet, response_id, status,
                attempt, started_at, last_polled_at
    `;

    st.lastLatencyMs = started.latencyMs;
    st.lastError = null;
    if (job && status === "completed") await finalizeJob(job, started.body);
  } catch (err) {
    st.lastError = err instanceof Error ? err.message : String(err);
  } finally {
    st.inFlight = false;
  }
}

export function ensureAstraDirectorObserver(): void {
  const st = observer();
  if (st.timer) return;
  st.timer = setInterval(() => void captureIfDue(), OBSERVER_MS);
  void captureIfDue();
}

export function astraDirectorHealth() {
  const st = observer();
  return {
    started: Boolean(st.timer),
    configured: Boolean(process.env.OPENAI_API_KEY?.trim()),
    model: ASTRA_DIRECTOR_MODEL,
    batch_windows: ASTRA_DIRECTOR_WINDOW_BATCH,
    last_run_at: st.lastRunAt ? new Date(st.lastRunAt).toISOString() : null,
    last_latency_ms: st.lastLatencyMs,
    last_error: st.lastError,
  };
}

export type AstraDirectorSnapshot = {
  study: typeof ASTRA_DIRECTOR_STUDY;
  model: string;
  batch_windows: number;
  authority: { report_only: true; changes_floor: false };
  due_in_windows: number;
  graded_total: number;
  latest: null | {
    created_at: string;
    through_close_time: string;
    graded_total: number;
    report: AstraDirectorReport;
    token_usage: { input: number; output: number; total: number };
  };
  health: ReturnType<typeof astraDirectorHealth>;
};

export async function astraDirectorSnapshot(): Promise<AstraDirectorSnapshot> {
  const db = await getSql();
  const due = await dueState();
  const [row] = await db<{
    created_at: Date | string;
    through_close_time: Date | string;
    graded_total: number;
    report: AstraDirectorReport;
    input_tokens: number | null;
    output_tokens: number | null;
    total_tokens: number | null;
  }>`
    select created_at, through_close_time, graded_total, report,
           input_tokens, output_tokens, total_tokens
      from desk_astra_director
     where study = ${ASTRA_DIRECTOR_STUDY} and version = ${ASTRA_DIRECTOR_VERSION}
     order by id desc limit 1
  `;
  return {
    study: ASTRA_DIRECTOR_STUDY,
    model: ASTRA_DIRECTOR_MODEL,
    batch_windows: ASTRA_DIRECTOR_WINDOW_BATCH,
    authority: { report_only: true, changes_floor: false },
    due_in_windows: Math.max(0, ASTRA_DIRECTOR_WINDOW_BATCH - (due.gradedTotal - due.lastTotal)),
    graded_total: due.gradedTotal,
    latest: row ? {
      created_at: iso(row.created_at),
      through_close_time: iso(row.through_close_time),
      graded_total: Number(row.graded_total),
      report: row.report,
      token_usage: {
        input: Number(row.input_tokens ?? 0),
        output: Number(row.output_tokens ?? 0),
        total: Number(row.total_tokens ?? 0),
      },
    } : null,
    health: astraDirectorHealth(),
  };
}
