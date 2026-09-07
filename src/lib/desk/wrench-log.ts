/**
 * WRENCH's log — the mechanic's receipts, checked into the repo so every
 * action it took is a commit. WRENCH is a scheduled Claude session that
 * audits the desk's tables, and when it finds a bug it opens a pull
 * request with the evidence and adds an entry here in that same PR. It
 * never merges, never touches knobs, never edits the ledger. Synced to
 * desk_crew_log at boot (upsert by slug); newest last.
 */
export type WrenchEntry = {
  slug: string;
  date: string;
  title: string;
  pr: number | null;
  summary: string;
};

export const WRENCH_LOG: WrenchEntry[] = [
  {
    slug: "2026-09-07-floor-audit",
    date: "2026-09-07",
    title: "72-hour seat audit",
    pr: 76,
    summary:
      "Found the floor structurally mute: a confidence formula that turned the rulebook's 0.55 into 50 under a 52 bar, WICK capped at 40 by an open-candle rule that fired every tick, and a calibration deadlock. Fixed all three; gagged reads now grade.",
  },
];
