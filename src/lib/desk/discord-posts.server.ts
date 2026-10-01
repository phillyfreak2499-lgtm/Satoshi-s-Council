import { join } from "node:path";
import { getSql } from "@/lib/db";
import { RegretJournal } from "./regret-journal.server";
import { discordReleased } from "./discord-release.server";
import { DiscordOutbox, type DiscordConfig } from "./discord-outbox.server";
import { paperEvent, readSummaryEvent, webhookTarget, type DiscordEvent } from "./discord-posts";
import { seatFacts } from "./pro-floor";
import { seatDirectionalLeans } from "./seat-lean";
import type { ChairResult, Snapshot, Vote, SeatKnobs } from "./types";
const journal = new RegretJournal<DiscordEvent>(join(process.cwd(), "data", "discord-outbox"));
let append: Promise<void> = Promise.resolve();
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
/** Windows already summarized by this process; the outbox key dedupes across restarts. */
const summarized = new Set<string>();
const configWarnings = new Set<string>();
function warnOnce(code: string) {
  if (!configWarnings.has(code)) { configWarnings.add(code); console.error(`Discord delivery: ${code}`); }
}
function config(): DiscordConfig {
  const paper = webhookTarget(process.env.DISCORD_PAPER_CALLS_WEBHOOK);
  const read = webhookTarget(process.env.DISCORD_DIRECTIONAL_READS_WEBHOOK);
  if (process.env.DISCORD_PAPER_CALLS_WEBHOOK && !paper) warnOnce("invalid_paper_configuration");
  if (process.env.DISCORD_DIRECTIONAL_READS_WEBHOOK && !read) warnOnce("invalid_read_configuration");
  // Two channels must be distinct. A misconfiguration cannot mix their event layers.
  if (paper && read && paper.hash === read.hash) {
    warnOnce("destinations_must_differ");
    return { build: process.env.RENDER_GIT_COMMIT || "", paper: null, read: null };
  }
  return { build: process.env.RENDER_GIT_COMMIT || "", paper, read };
}
function ensureWorker(c: DiscordConfig) {
  if ((!c.paper && !c.read) || timer) return;
  timer = setInterval(() => void flush(), 5000);
  timer.unref?.();
}
async function flush() {
  if (running) return;
  running = true;
  try {
    const c = config();
    if (!c.paper && !c.read) return;
    const db = await getSql();
    const outbox = new DiscordOutbox(db, c, () => discordReleased(db));
    await append;
    await journal.drain((event) => outbox.enqueue(event));
    await outbox.drain();
  } catch { console.error("Discord delivery: journal_or_queue_failure"); }
  finally { running = false; }
}
function record(e: DiscordEvent, c: DiscordConfig) {
  ensureWorker(c);
  append = append.then(() => journal.append(e)).catch(() => { console.error("Discord delivery: journal_append_failure"); });
}
/** Called after the existing paper_call_locked publication; never awaited. */
export function publishDiscordPaper(side: "UP" | "DOWN", cents: number, ticker: string,
  close: number | undefined, source?: string): void {
  try {
    const c = config();
    if (!c.paper || !close || !Number.isFinite(cents) || !Number.isFinite(close)) return;
    record(paperEvent(side, cents, close, Date.now(), ticker, source ?? null, c.build, c.paper.hash), c);
  } catch { console.error("Discord delivery: paper_capture_failure"); }
}
/** Same published SeatFacts/retained-lean mapping as Guided/Pro. No reconstructed read. */
export function publishDiscordLeans(snap: Snapshot, votes: Vote[], chair: ChairResult,
  knobs: Record<string, SeatKnobs>): void {
  try {
    const c = config();
    if ((!c.read && !c.paper) || snap.demo || !snap.ticker || snap.as_of >= snap.close_time) return;
    // Start the worker even when there is no current directional lean: pending settlement delivery still drains.
    ensureWorker(c);
    if (!c.read) return;
    const window = { ticker: snap.ticker, close_time: snap.close_time, as_of: snap.as_of };
    const key = `${snap.ticker}|${snap.close_time}`;
    if (summarized.has(key)) return;
    const leans = seatDirectionalLeans(seatFacts(chair, votes, knobs, snap.as_of), window);
    // At most one research-outlook post per 15-minute window (see READ_SUMMARY_MS_LEFT).
    const e = readSummaryEvent(leans, chair.lean, window, c.build, c.read.hash);
    if (!e) return;
    summarized.add(key);
    if (summarized.size > 64) for (const k of summarized) if (k !== key) summarized.delete(k);
    record(e, c);
  } catch { console.error("Discord delivery: read_capture_failure"); }
}
