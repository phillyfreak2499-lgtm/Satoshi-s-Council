/** Lazy, fail-open event wiring. No configuration => no module/DB/provider work. */
import type { ChairResult, Snapshot, Vote, SeatKnobs } from "./types";
export function publishDiscordPaper(side: "UP" | "DOWN", cents: number, ticker: string, close: number | undefined, source?: string) {
  if (!process.env.DISCORD_PAPER_CALLS_WEBHOOK) return;
  void import("./discord-posts.server").then((m) => m.publishDiscordPaper(side, cents, ticker, close, source))
    .catch(() => console.error("Discord delivery: module_failure"));
}
export function publishDiscordLeans(snap: Snapshot, votes: Vote[], chair: ChairResult, knobs: Record<string, SeatKnobs>) {
  if (!process.env.DISCORD_DIRECTIONAL_READS_WEBHOOK && !process.env.DISCORD_PAPER_CALLS_WEBHOOK) return;
  void import("./discord-posts.server").then((m) => m.publishDiscordLeans(snap, votes, chair, knobs))
    .catch(() => console.error("Discord delivery: module_failure"));
}
