/**
 * Durable handoff for prospective OpenAI research observers.
 *
 * The live observer freezes a packet before its API request. After that moment
 * recovery reads only this job row: never a later live frame, Replay, settlement,
 * or another research table. Pending model requests are claimable only before
 * close. A pre-close answer can be finalized later because the answer itself is
 * durably timestamped before close.
 */
import { createHash } from "node:crypto";
import { getSql } from "@/lib/db";

export type OpenAICaptureStudy =
  | "OPENAI_SHADOW_V1"
  | "OPENAI_BLIND_V1"
  | "OPENAI_LUNA_V1";

export type OpenAICaptureStatus = "pending" | "result_ready" | "completed" | "expired";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(input)
        .sort()
        .map((key) => [key, canonicalize(input[key])]),
    );
  }
  return value;
}

/**
 * jsonb may reorder object keys on round-trip. Hash the semantic JSON shape,
 * not its incidental property insertion order, so restart verification is stable.
 */
export function openAICaptureHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

export type OpenAICaptureJob = {
  study: OpenAICaptureStudy;
  version: number;
  ticker: string;
  close_ms: number;
  frozen_ms: number;
  secs_left: number;
  prompt_version: string;
  model: string;
  input_packet: unknown;
  market_p: number | null;
  fair_p: number | null;
  chair_lean: "UP" | "DOWN" | "WAIT";
  yes_ask: number | null;
  no_ask: number | null;
  status: OpenAICaptureStatus;
  attempts: number;
  last_attempt_ms: number | null;
  lease_until_ms: number | null;
  last_error: string | null;
  result: unknown | null;
  response_id: string;
  result_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  latency_ms: number | null;
  build_sha: string;
};

type JobRow = {
  study: OpenAICaptureStudy;
  version: number;
  ticker: string;
  close_time: Date | string;
  frozen_at: Date | string;
  secs_left: number;
  prompt_version: string;
  model: string;
  input_hash: string;
  input_packet: unknown;
  market_p: number | null;
  fair_p: number | null;
  chair_lean: "UP" | "DOWN" | "WAIT";
  yes_ask: number | null;
  no_ask: number | null;
  status: OpenAICaptureStatus;
  attempts: number;
  last_attempt_at: Date | string | null;
  lease_until: Date | string | null;
  last_error: string | null;
  result: unknown | null;
  response_id: string;
  result_at: Date | string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  latency_ms: number | null;
  build_sha: string;
};

export type FreezeOpenAIJob = {
  study: OpenAICaptureStudy;
  version: number;
  ticker: string;
  close_ms: number;
  frozen_ms: number;
  secs_left: number;
  prompt_version: string;
  model: string;
  input_hash: string;
  input_packet: unknown;
  market_p: number | null;
  fair_p: number | null;
  chair_lean: "UP" | "DOWN" | "WAIT";
  yes_ask: number | null;
  no_ask: number | null;
  build_sha: string;
};

export type OpenAIJobResult = {
  result: unknown;
  response_id: string;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  latency_ms: number;
};

const ms = (v: Date | string | null): number | null =>
  v == null ? null : new Date(v).getTime();

function fromRow(r: JobRow): OpenAICaptureJob {
  return {
    study: r.study,
    version: Number(r.version),
    ticker: r.ticker,
    close_ms: new Date(r.close_time).getTime(),
    frozen_ms: new Date(r.frozen_at).getTime(),
    secs_left: Number(r.secs_left),
    prompt_version: r.prompt_version,
    model: r.model,
    input_hash: r.input_hash,
    input_packet: r.input_packet,
    market_p: r.market_p == null ? null : Number(r.market_p),
    fair_p: r.fair_p == null ? null : Number(r.fair_p),
    chair_lean: r.chair_lean,
    yes_ask: r.yes_ask == null ? null : Number(r.yes_ask),
    no_ask: r.no_ask == null ? null : Number(r.no_ask),
    status: r.status,
    attempts: Number(r.attempts),
    last_attempt_ms: ms(r.last_attempt_at),
    lease_until_ms: ms(r.lease_until),
    last_error: r.last_error,
    result: r.result,
    response_id: r.response_id,
    result_ms: ms(r.result_at),
    input_tokens: r.input_tokens == null ? null : Number(r.input_tokens),
    output_tokens: r.output_tokens == null ? null : Number(r.output_tokens),
    total_tokens: r.total_tokens == null ? null : Number(r.total_tokens),
    latency_ms: r.latency_ms == null ? null : Number(r.latency_ms),
    build_sha: r.build_sha,
  };
}

export async function readOpenAICaptureJob(
  study: OpenAICaptureStudy,
  version: number,
  ticker: string,
  closeMs: number,
): Promise<OpenAICaptureJob | null> {
  const db = await getSql();
  const closeIso = new Date(closeMs).toISOString();
  const rows = await db<JobRow>`
    select study, version, ticker, close_time, frozen_at, secs_left, prompt_version,
           model, input_hash, input_packet, market_p, fair_p, chair_lean, yes_ask,
           no_ask, status, attempts, last_attempt_at, lease_until, last_error,
           result, response_id, result_at, input_tokens, output_tokens, total_tokens,
           latency_ms, build_sha
      from desk_openai_capture_jobs
     where study = ${study} and version = ${version}
       and ticker = ${ticker} and close_time = ${closeIso}
     limit 1
  `;
  return rows[0] ? fromRow(rows[0]) : null;
}

/**
 * First writer wins. A second process arriving later in the 12-second lock
 * receives the original frozen packet instead of replacing it with a later frame.
 */
export async function freezeOpenAICaptureJob(input: FreezeOpenAIJob): Promise<OpenAICaptureJob> {
  const db = await getSql();
  await db`
    insert into desk_openai_capture_jobs (
      study, version, ticker, close_time, frozen_at, secs_left, prompt_version,
      model, input_hash, input_packet, market_p, fair_p, chair_lean, yes_ask,
      no_ask, build_sha
    ) values (
      ${input.study}, ${input.version}, ${input.ticker},
      ${new Date(input.close_ms).toISOString()},
      ${new Date(input.frozen_ms).toISOString()}, ${input.secs_left},
      ${input.prompt_version}, ${input.model}, ${openAICaptureHash(input.input_packet)},
      ${JSON.stringify(input.input_packet)}::jsonb,
      ${input.market_p}, ${input.fair_p}, ${input.chair_lean},
      ${input.yes_ask}, ${input.no_ask}, ${input.build_sha}
    )
    on conflict (study, version, ticker, close_time) do nothing
  `;
  const job = await readOpenAICaptureJob(input.study, input.version, input.ticker, input.close_ms);
  if (!job) throw new Error("capture job missing after freeze");
  return job;
}

/**
 * Boot-time recovery scan. Expired pending jobs are made explicit. result_ready
 * jobs remain recoverable after close because their model answer was already
 * persisted before close.
 */
export async function nextRecoverableOpenAIJob(
  study: OpenAICaptureStudy,
  version: number,
): Promise<OpenAICaptureJob | null> {
  const db = await getSql();
  await db`
    update desk_openai_capture_jobs
       set status = 'expired', lease_until = null
     where study = ${study} and version = ${version}
       and status = 'pending' and close_time <= clock_timestamp()
  `;
  const rows = await db<JobRow>`
    select study, version, ticker, close_time, frozen_at, secs_left, prompt_version,
           model, input_hash, input_packet, market_p, fair_p, chair_lean, yes_ask,
           no_ask, status, attempts, last_attempt_at, lease_until, last_error,
           result, response_id, result_at, input_tokens, output_tokens, total_tokens,
           latency_ms, build_sha
      from desk_openai_capture_jobs
     where study = ${study} and version = ${version}
       and (
         status = 'result_ready'
         or (status = 'pending' and close_time > clock_timestamp())
       )
     order by case when status = 'result_ready' then 0 else 1 end, close_time asc
     limit 1
  `;
  return rows[0] ? fromRow(rows[0]) : null;
}

/**
 * A short DB lease prevents old/new Render instances from issuing the same model
 * request during a deploy overlap. If the holder dies, another process can retry
 * the exact frozen packet once the lease expires.
 */
export async function claimOpenAICaptureJob(job: OpenAICaptureJob): Promise<OpenAICaptureJob | null> {
  const db = await getSql();
  const rows = await db<JobRow>`
    update desk_openai_capture_jobs
       set attempts = attempts + 1,
           last_attempt_at = clock_timestamp(),
           lease_until = clock_timestamp() + interval '20 seconds',
           last_error = null
     where study = ${job.study} and version = ${job.version}
       and ticker = ${job.ticker}
       and close_time = ${new Date(job.close_ms).toISOString()}
       and status = 'pending'
       and close_time > clock_timestamp()
       and (lease_until is null or lease_until <= clock_timestamp())
     returning study, version, ticker, close_time, frozen_at, secs_left, prompt_version,
               model, input_hash, input_packet, market_p, fair_p, chair_lean, yes_ask,
               no_ask, status, attempts, last_attempt_at, lease_until, last_error,
               result, response_id, result_at, input_tokens, output_tokens, total_tokens,
               latency_ms, build_sha
  `;
  return rows[0] ? fromRow(rows[0]) : null;
}

/** Persist an answer only if it arrived prospectively, before the window closed. */
export async function saveOpenAICaptureResult(
  job: OpenAICaptureJob,
  answer: OpenAIJobResult,
): Promise<boolean> {
  const db = await getSql();
  const rows = await db<{ ok: number }>`
    update desk_openai_capture_jobs
       set status = 'result_ready',
           result = ${JSON.stringify(answer.result)}::jsonb,
           response_id = ${answer.response_id},
           result_at = clock_timestamp(),
           input_tokens = ${answer.input_tokens},
           output_tokens = ${answer.output_tokens},
           total_tokens = ${answer.total_tokens},
           latency_ms = ${answer.latency_ms},
           lease_until = null,
           last_error = null
     where study = ${job.study} and version = ${job.version}
       and ticker = ${job.ticker}
       and close_time = ${new Date(job.close_ms).toISOString()}
       and status = 'pending'
       and close_time > clock_timestamp()
     returning 1::int as ok
  `;
  return rows.length === 1;
}

export async function noteOpenAICaptureError(job: OpenAICaptureJob, error: unknown): Promise<void> {
  const db = await getSql();
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 600);
  await db`
    update desk_openai_capture_jobs
       set last_error = ${message},
           lease_until = least(close_time, clock_timestamp() + interval '15 seconds')
     where study = ${job.study} and version = ${job.version}
       and ticker = ${job.ticker}
       and close_time = ${new Date(job.close_ms).toISOString()}
       and status = 'pending'
  `;
}

export async function completeOpenAICaptureJob(job: OpenAICaptureJob): Promise<void> {
  const db = await getSql();
  await db`
    update desk_openai_capture_jobs
       set status = 'completed', completed_at = clock_timestamp(), lease_until = null
     where study = ${job.study} and version = ${job.version}
       and ticker = ${job.ticker}
       and close_time = ${new Date(job.close_ms).toISOString()}
       and status = 'result_ready'
  `;
}
