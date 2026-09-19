/**
 * Server-only OpenAI text-to-speech adapter for fictional Council characters.
 *
 * Safety / cost boundary:
 * - no public request may supply arbitrary speech text
 * - intro text is fixed here
 * - live text is derived from the current server frame
 * - Chamber text is read from an already-persisted public event
 * - audio has no path back into the Chair, seats, learner, Lab, or paper book
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  isCouncilVoiceSource,
  isCouncilVoiceSpeaker,
  type CouncilVoiceSource,
  type CouncilVoiceSpeaker,
} from "./council-voice";
import { statementFromEvent } from "./chamber-reactions";
import { listPublicChamberEvents } from "./system-events.server";

const MODEL = "gpt-4o-mini-tts";
const MAX_TEXT = 900;
const REQUEST_TIMEOUT_MS = 20_000;

type VoiceProfile = {
  voice: string;
  instructions: string;
};

const PROFILES: Record<CouncilVoiceSpeaker, VoiceProfile> = {
  SATOSHI: {
    voice: "cedar",
    instructions:
      "Speak as a fictional research-desk chair: measured, restrained, calm, deliberate, low-key, and authoritative without sounding theatrical. Keep UP, DOWN, and WAIT crisp. Never sound like a real public figure.",
  },
  WICK: {
    voice: "ash",
    instructions:
      "Speak as a fictional candle-structure analyst: alert, crisp, observant, slightly quick, but never excited or promotional. Sound like a coach pointing at a chart.",
  },
  DRIFT: {
    voice: "verse",
    instructions:
      "Speak as a fictional momentum analyst: calm, analytical, fluid, patient, and understated. Use a steady pace and emphasize conflicting time horizons clearly.",
  },
  TAPE: {
    voice: "coral",
    instructions:
      "Speak as a fictional order-book analyst: concise, clipped, quick, precise, and skeptical. Keep numbers and the words resting quotes especially clear.",
  },
  WARDEN: {
    voice: "onyx",
    instructions:
      "Speak as a fictional systems-integrity officer: terse, controlled, operational, and serious. No drama; make status changes unmistakable.",
  },
  ALCHEMIST: {
    voice: "marin",
    instructions:
      "Speak as a fictional research scientist: curious, thoughtful, careful, and evidence-first. Sound interested in the experiment, not impressed by it.",
  },
  SWEEP: {
    voice: "sage",
    instructions:
      "Speak as a fictional evidence auditor: methodical, dry, clear, and matter-of-fact. Emphasize observed counts and conditions without judgment.",
  },
};

const INTROS: Partial<Record<CouncilVoiceSpeaker, string>> = {
  SATOSHI:
    "I am SATOSHI, the Chair. I listen to the Council, but I do not force a call. UP, DOWN, or WAIT stays a paper research decision.",
  WICK:
    "I am WICK. Close first, then a read. I study candle structure, location, and confirmation. A pattern is evidence, not a promise.",
  DRIFT:
    "I am DRIFT. I compare five, fifteen, and thirty minute momentum. Alignment matters, and disagreement is information too.",
  TAPE:
    "I am TAPE. A quote is not a trade. I study resting book pressure, persistence, and the spread before I trust the tape.",
};

type VoiceRequest = {
  source: CouncilVoiceSource;
  speaker: CouncilVoiceSpeaker;
  eventKey?: string | null;
};

export type CouncilVoiceResult = {
  bytes: Uint8Array;
  speaker: CouncilVoiceSpeaker;
  cache: "hit" | "miss";
  source: CouncilVoiceSource;
  stable: boolean;
};

export class CouncilVoiceError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const g = globalThis as typeof globalThis & {
  __councilVoiceInflight__?: Map<string, Promise<Uint8Array>>;
};

function inflight() {
  return (g.__councilVoiceInflight__ ??= new Map());
}

function cleanText(input: unknown): string {
  const text = String(input ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT);
  if (!text) throw new CouncilVoiceError(404, "voice text unavailable");
  return text;
}

function cacheRoot(): string {
  return (
    process.env.COUNCIL_VOICE_CACHE_DIR?.trim() ||
    join(process.cwd(), "data", "voice-cache")
  );
}

function cacheKey(speaker: CouncilVoiceSpeaker, text: string): string {
  const p = PROFILES[speaker];
  return createHash("sha256")
    .update(JSON.stringify({ model: MODEL, speaker, voice: p.voice, instructions: p.instructions, text }))
    .digest("hex");
}

async function readCached(hash: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(join(cacheRoot(), `${hash}.mp3`)));
  } catch {
    return null;
  }
}

async function writeCached(hash: string, bytes: Uint8Array): Promise<void> {
  const dir = cacheRoot();
  await mkdir(dir, { recursive: true });
  const target = join(dir, `${hash}.mp3`);
  const staged = join(dir, `.${hash}.${process.pid}.tmp`);
  await writeFile(staged, bytes);
  try {
    await rename(staged, target);
  } catch (error) {
    await unlink(staged).catch(() => {});
    const existing = await readCached(hash);
    if (!existing) throw error;
  }
}

async function textFromChamber(
  eventKey: string,
  expectedSpeaker: CouncilVoiceSpeaker,
): Promise<{ text: string; speaker: CouncilVoiceSpeaker }> {
  if (!eventKey || eventKey.length > 180) throw new CouncilVoiceError(404, "event not found");
  const events = await listPublicChamberEvents(5);
  const event = events.find((row) => row.event_key === eventKey);
  if (!event) throw new CouncilVoiceError(404, "event not found");
  const statement = statementFromEvent(event);
  if (!statement) throw new CouncilVoiceError(404, "event has no public speech");
  if (statement.speaker !== expectedSpeaker) throw new CouncilVoiceError(404, "speaker mismatch");
  if (!isCouncilVoiceSpeaker(statement.speaker)) throw new CouncilVoiceError(404, "speaker unavailable");
  return { text: cleanText(statement.text), speaker: statement.speaker };
}

function liveSeatText(
  speaker: "WICK" | "DRIFT" | "TAPE",
  vote: {
    lean?: unknown;
    reasoning?: unknown;
    hypothesis?: unknown;
    evidence?: unknown;
    health?: unknown;
  },
): string {
  if (vote.health === "DOWN" || vote.health === "STALE") {
    throw new CouncilVoiceError(409, "seat evidence is stale");
  }
  const lean = vote.lean === "UP" || vote.lean === "DOWN" || vote.lean === "WAIT" ? vote.lean : "WAIT";
  const reason = cleanText(
    vote.reasoning ||
      vote.hypothesis ||
      (Array.isArray(vote.evidence) ? vote.evidence.find((x) => typeof x === "string") : "") ||
      "No fresh explanation was recorded.",
  );
  return cleanText(`${speaker}. ${lean}. ${reason}`);
}

async function textFromLive(
  speaker: CouncilVoiceSpeaker,
): Promise<{ text: string; speaker: CouncilVoiceSpeaker }> {
  if (speaker !== "SATOSHI" && speaker !== "WICK" && speaker !== "DRIFT" && speaker !== "TAPE") {
    throw new CouncilVoiceError(404, "live voice unavailable for this character");
  }
  const engine = await import("./server-engine");
  engine.ensureServerEngine();
  const frame = await engine.getServerFrame();
  const snap = frame.snap;
  const now = Date.now();
  if (
    !snap ||
    snap.demo ||
    !Number.isFinite(snap.as_of) ||
    snap.as_of > now + 5_000 ||
    now - snap.as_of > 20_000 ||
    !snap.ticker ||
    snap.close_time < now - 5_000
  ) {
    throw new CouncilVoiceError(409, "live voice requires a fresh live frame");
  }

  if (speaker === "SATOSHI") {
    const chair = frame.chair;
    if (!chair) throw new CouncilVoiceError(409, "Chair is unavailable");
    const lean = chair.lean === "UP" || chair.lean === "DOWN" || chair.lean === "WAIT" ? chair.lean : "WAIT";
    const reason =
      cleanText(
        chair.decision ||
          (lean === "WAIT" ? chair.wait_note : chair.hypothesis) ||
          chair.counter ||
          "No fresh Chair explanation was recorded.",
      );
    return {
      speaker,
      text: cleanText(`Paper desk. ${lean}. ${reason}`),
    };
  }

  const vote = frame.votes.find((row) => row.seat === speaker);
  if (!vote) throw new CouncilVoiceError(409, "seat is unavailable");
  return { speaker, text: liveSeatText(speaker, vote) };
}

async function resolveMaterial(request: VoiceRequest): Promise<{
  text: string;
  speaker: CouncilVoiceSpeaker;
  stable: boolean;
}> {
  if (!isCouncilVoiceSource(request.source) || !isCouncilVoiceSpeaker(request.speaker)) {
    throw new CouncilVoiceError(404, "voice not found");
  }
  if (request.source === "intro") {
    const text = INTROS[request.speaker];
    if (!text) throw new CouncilVoiceError(404, "intro unavailable");
    return { text: cleanText(text), speaker: request.speaker, stable: true };
  }
  if (request.source === "chamber") {
    const material = await textFromChamber(request.eventKey ?? "", request.speaker);
    return { ...material, stable: true };
  }
  const material = await textFromLive(request.speaker);
  return { ...material, stable: false };
}

async function generate(
  speaker: CouncilVoiceSpeaker,
  text: string,
): Promise<Uint8Array> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new CouncilVoiceError(503, "AI voice is not configured");
  const profile = PROFILES[speaker];
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      model: MODEL,
      voice: profile.voice,
      input: text,
      instructions: profile.instructions,
      response_format: "mp3",
    }),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 240);
    const status = response.status === 429 ? 429 : 503;
    throw new CouncilVoiceError(status, detail ? "AI voice generation failed" : "AI voice unavailable");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < 256) throw new CouncilVoiceError(503, "AI voice returned empty audio");
  return bytes;
}

export async function councilVoice(request: VoiceRequest): Promise<CouncilVoiceResult> {
  const material = await resolveMaterial(request);
  const hash = cacheKey(material.speaker, material.text);
  const cached = await readCached(hash);
  if (cached) {
    return {
      bytes: cached,
      speaker: material.speaker,
      cache: "hit",
      source: request.source,
      stable: material.stable,
    };
  }

  const pending = inflight();
  let task = pending.get(hash);
  if (!task) {
    task = (async () => {
      const bytes = await generate(material.speaker, material.text);
      await writeCached(hash, bytes).catch(() => {});
      return bytes;
    })().finally(() => pending.delete(hash));
    pending.set(hash, task);
  }
  const bytes = await task;
  return {
    bytes,
    speaker: material.speaker,
    cache: "miss",
    source: request.source,
    stable: material.stable,
  };
}
