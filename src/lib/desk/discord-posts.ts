/** Outbound presentation only. Never calls a decider, booker, or learner. */
import { createHash } from "node:crypto";
import type { SeatLean } from "./seat-lean";
export type DiscordKind = "paper" | "read" | "settle";
export type DiscordEvent = {
  key: string; kind: DiscordKind; ticker: string; close: number; observed: number;
  seat: string; side: "UP" | "DOWN"; source: string | null; build: string;
  target: string; payload: DiscordPayload; expires: number; parent?: string; signature?: string; quiet?: boolean;
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
    payload: embed(`■ PAPER POSITION BOOKED · ${side}`, "Recorded paper fill. No live trade.", 0x16a34a, observed,
      [{ name: "Seat", value: seat, inline: true }, { name: "Direction", value: side, inline: true },
        { name: "Entry", value: `${cents.toFixed(1)}¢`, inline: true },
        { name: "Window closes (UTC)", value: stamp(close) }, { name: "Window", value: ticker }]) };
}
export function readEvent(l: SeatLean, build: string, target: string): DiscordEvent | null {
  if (l.score == null || (l.direction !== "BULLISH" && l.direction !== "BEARISH")) return null;
  const side = l.direction === "BULLISH" ? "UP" : "DOWN";
  return { key: `read|${l.window.ticker}|${l.window.close_time}|${l.seat}|${l.window.as_of}|${side}|${l.score}`,
    signature: `${l.direction}|${l.score}`, kind: "read", ticker: l.window.ticker, close: l.window.close_time, observed: l.window.as_of,
    seat: l.seat, side, source: null, build, target, expires: l.window.close_time,
    payload: embed(`◇ RESEARCH LEAN · ${l.seat} · ${side}`,
      "Research only. Not a SATOSHI call or a paper position. Lean is direction and intensity, not a probability.",
      0xa855f7, l.window.as_of,
      [{ name: "Seat", value: l.seat, inline: true }, { name: "Directional Lean", value: `${l.score} · ${l.direction === "BULLISH" ? "Bullish" : "Bearish"}`, inline: true },
        { name: "Observed (UTC)", value: stamp(l.window.as_of) }, { name: "Status", value: l.statusPlain },
        { name: "Window", value: l.window.ticker }]) };
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
