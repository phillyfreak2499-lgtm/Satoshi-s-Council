/** Outbound presentation only. Never calls a decider, booker, or learner. */
import { createHash } from "node:crypto";
import type { SeatLean } from "./seat-lean";
export type DiscordKind = "paper" | "read" | "settle";
export type DiscordEvent = {
  key: string; kind: DiscordKind; ticker: string; close: number; observed: number;
  seat: string; side: "UP" | "DOWN"; source: string | null; build: string;
  target: string; payload: DiscordPayload; expires: number; parent?: string;
};
export type DiscordPayload = {
  username: string; allowed_mentions: { parse: string[] };
  embeds: { title: string; description: string; color: number; timestamp: string;
    fields: { name: string; value: string; inline?: boolean }[]; footer: { text: string } }[];
};
export function webhookTarget(input: string | undefined): { url: string; hash: string } | null {
  if (!input) return null;
  try {
    const u = new URL(input.trim());
    if (u.protocol !== "https:" || u.hostname !== "discord.com" || u.port || u.username || u.password || u.search || u.hash
      || !/^\/api(?:\/v10)?\/webhooks\/\d{17,20}\/[\w-]{20,}$/.test(u.pathname)) return null;
    u.searchParams.set("wait", "true");
    return { url: u.toString(), hash: createHash("sha256").update(u.pathname).digest("hex") };
  } catch { return null; }
}
const stamp = (ms: number) => new Date(ms).toISOString();
function embed(title: string, description: string, color: number, observed: number,
  fields: DiscordPayload["embeds"][number]["fields"]): DiscordPayload {
  return { username: "Satoshi's Council", allowed_mentions: { parse: [] },
    embeds: [{ title, description, color, timestamp: stamp(observed), fields,
      footer: { text: "Paper-only Bitcoin research · satoshiscouncil.com" } }] };
}
export function paperEvent(side: "UP" | "DOWN", cents: number, close: number, observed: number,
  ticker: string, source: string | null, build: string, target: string): DiscordEvent {
  const key = `paper|${ticker}|${close}|${source ?? "chair"}|${side}`;
  const seat = source ? "RECOVERY_FAV85_V1" : "SATOSHI";
  return { key, kind: "paper", ticker, close, observed, seat, side, source, build, target,
    expires: close + 86400000,
    payload: embed(`■ PAPER POSITION BOOKED · ${side}`, "Recorded paper fill. No live trade: paper only, no real order or money.", 0x16a34a, observed,
      [{ name: "Seat", value: seat, inline: true }, { name: "Direction", value: side, inline: true },
        { name: "Decision", value: source ? `${seat} paper pilot, not a SATOSHI Chair decision` : "SATOSHI decision (the Chair's call), booked as a paper position", inline: true },
        { name: "Entry", value: `${cents.toFixed(1)}¢`, inline: true },
        { name: "Window closes (UTC)", value: stamp(close) }, { name: "Window", value: ticker }]) };
}
/** Directional reads post at most once per 15-minute Kalshi window: one research-outlook
 * summary of every seat's lean, taken on the first frame with at most this much time left
 * that carries at least one directional lean. Event key = window, so the outbox primary key
 * enforces one row per window across ticks, restarts and workers. */
export const READ_SUMMARY_MS_LEFT = 10 * 60000;
export const READ_SUMMARY_PREFIX = "readwin|";
const directional = (l: SeatLean) => l.score != null && (l.direction === "BULLISH" || l.direction === "BEARISH");
export function readSummaryDue(window: { close_time: number; as_of: number }, leans: readonly SeatLean[]): boolean {
  const left = window.close_time - window.as_of;
  return left > 0 && left <= READ_SUMMARY_MS_LEFT && leans.some(directional);
}
const word = (l: SeatLean) => (l.direction === "BULLISH" ? "Bullish" : l.direction === "BEARISH" ? "Bearish" : l.direction === "NEUTRAL" ? "Neutral" : "No read");
/** Three layers, each in its own labelled field: research outlook (seat leans), SATOSHI
 * decision (the Chair's lean on this same frame) and paper position (never in this post). */
export function readSummaryEvent(leans: readonly SeatLean[], chairLean: string,
  window: { ticker: string; close_time: number; as_of: number }, build: string, target: string): DiscordEvent | null {
  if (!readSummaryDue(window, leans)) return null;
  const ranked = [...leans].sort((a, b) => Math.abs((b.score ?? 50) - 50) - Math.abs((a.score ?? 50) - 50) || (a.seat < b.seat ? -1 : a.seat > b.seat ? 1 : 0));
  const bull = leans.filter((l) => directional(l) && l.direction === "BULLISH").length;
  const bear = leans.filter((l) => directional(l) && l.direction === "BEARISH").length;
  const lines = ranked.filter(directional).map((l) => `${l.seat} ${l.score} · ${word(l)}${l.stale ? " (stale feed)" : ""}`);
  let outlook = lines.join("\n");
  if (outlook.length > 1000) outlook = outlook.slice(0, 997) + "...";
  const decision = chairLean === "UP" || chairLean === "DOWN"
    ? `${chairLean} — the Chair's call on this frame. It is a paper position only if booked.`
    : "WAIT — SATOSHI is not making a call on this frame.";
  const top = ranked.find(directional)!;
  return { key: `${READ_SUMMARY_PREFIX}${window.ticker}|${window.close_time}`, kind: "read", ticker: window.ticker,
    close: window.close_time, observed: window.as_of, seat: "SEAT_LEANS", side: top.direction === "BULLISH" ? "UP" : "DOWN",
    source: null, build, target, expires: window.close_time,
    payload: embed("◇ RESEARCH OUTLOOK · SEAT LEANS",
      "Research only, one summary per 15-minute window. Seat leans are direction and intensity (0–100), not probabilities. Not a SATOSHI call and not a paper position. Paper-only desk: no real trades.",
      0xa855f7, window.as_of,
      [{ name: "Research outlook · seat leans", value: outlook },
        { name: "Seat count", value: `${bull} bullish · ${bear} bearish · ${leans.length - bull - bear} neutral or no read`, inline: true },
        { name: "SATOSHI decision · Chair", value: decision },
        { name: "Paper position", value: "None in this post. Booked paper calls post separately in the paper-calls channel, one post per booked call." },
        { name: "Snapshot (UTC)", value: stamp(window.as_of), inline: true },
        { name: "Window closes (UTC)", value: stamp(window.close_time), inline: true }, { name: "Window", value: window.ticker }]) };
}
export type PaperScoreboard = { wins: number; losses: number; net: number };
export function settlementEvent(parent: DiscordEvent, winner: "UP" | "DOWN", net: number,
  graded: number, build: string, scoreboard?: PaperScoreboard): DiscordEvent {
  const won = parent.side === winner;
  return { ...parent, key: `settle|${parent.key}`, kind: "settle", parent: parent.key,
    build, observed: graded, expires: graded + 86400000,
    payload: embed(`■ PAPER POSITION SETTLED · ${won ? "WIN" : "LOSS"}`,
      "Follow-up to the recorded paper fill. Net P&L includes the book's actual fee.", won ? 0x16a34a : 0xdc2626, graded,
      [{ name: "Seat", value: parent.seat, inline: true }, { name: "Booked direction", value: parent.side, inline: true },
        { name: "Outcome", value: winner, inline: true }, { name: "Net after fees", value: `${net >= 0 ? "+" : ""}${net.toFixed(1)}¢`, inline: true },
        ...(scoreboard ? [{ name: "Paper scoreboard · all-time", value: `${scoreboard.wins}W–${scoreboard.losses}L · ${scoreboard.net >= 0 ? "+" : ""}${scoreboard.net.toFixed(1)}¢ net after fees` }] : []),
        { name: "Window closes (UTC)", value: stamp(parent.close) }, { name: "Window", value: parent.ticker }]) };
}
export type PostResult = { ok: boolean; status: number | null; retryMs: number; terminal: boolean; message: string | null; code: string };
const seconds = (value: unknown): number => {
  const n = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? n * 1000 : 0;
};
export async function postDiscord(url: string, payload: DiscordPayload, attempt: number,
  request: typeof fetch = fetch): Promise<PostResult> {
  const backoff = Math.min(300000, 1000 * 2 ** Math.min(attempt, 8));
  try {
    const r = await request(url, { method: "POST", redirect: "error", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(8000) });
    // Never log response bodies, exception text or URLs: each can contain the webhook token.
    let body: { id?: unknown; retry_after?: unknown } = {};
    try { body = await r.json(); } catch { /* safe status-only result */ }
    const reset = seconds(r.headers.get("X-RateLimit-Reset-After"));
    const cooldown = r.headers.get("X-RateLimit-Remaining") === "0" ? reset : 0;
    if (r.ok && typeof body.id === "string") return { ok: true, status: r.status, retryMs: cooldown, terminal: false, message: body.id, code: "accepted" };
    const limited = r.status === 429;
    const terminal = r.status >= 400 && r.status < 500 && !limited;
    return { ok: false, status: r.status, retryMs: Math.max(backoff, cooldown,
      limited ? seconds(body.retry_after) : 0, seconds(r.headers.get("Retry-After"))), terminal,
      message: null, code: limited ? "rate_limited" : terminal ? "rejected" : "provider_or_receipt_failure" };
  } catch { return { ok: false, status: null, retryMs: backoff, terminal: false, message: null, code: "transport_failure" }; }
}
