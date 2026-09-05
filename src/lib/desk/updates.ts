/**
 * Desk changelog, written for the floor — not commit messages.
 * Each entry becomes a pinned "update" post on the Board (upserted by slug
 * at server boot, so editing a body here edits nothing already posted —
 * add a NEW slug for a new update). Keep bodies under 400 chars, one thought
 * per entry, plain language. Newest last; the board shows newest first.
 */
export type DeskUpdate = { slug: string; body: string };

export const DESK_UPDATES: DeskUpdate[] = [
  {
    slug: "2026-09-05-grading",
    body:
      "The desk finally learns from live windows. A window that ended 99¢ decided used to be thrown away as chalk, so the graded count sat at zero forever. Now every finished window teaches the seats — watch the graded counter climb.",
  },
  {
    slug: "2026-09-05-time-gates",
    body:
      "Early and late minutes no longer block a call — they size it down instead. A setup strong enough to fill mid-window can now fill at 14m or 2m, at size 1, and only when the price still has real edge after fees. Weak whispers under 52 conf also stopped raising the bar against the seats that did speak.",
  },
  {
    slug: "2026-09-05-shared-brain",
    body:
      "One shared brain. The council now runs on the server around the clock — it ticks, calls, and learns even with every tab closed, and every visitor sees the same desk. Refresh no longer resets anything. Desk controls (bar, mutes, beast) are admin-key only; Demo stays your own private sandbox.",
  },
  {
    slug: "2026-09-05-ledger",
    body:
      "The desk keeps receipts now. Every graded window lands in a permanent ledger — chair call, entry and settle, cents after fees, and how each seat voted — so the record no longer scrolls away after 80 calls. Each morning DESK posts yesterday's recap right here: windows graded, calls, net cents, best and worst seat. The little brain pulse on the strip shows the shared desk ticking on the server.",
  },
  {
    slug: "2026-09-05-every-window",
    body:
      "Grading now catches every window on the roll. Settling used to need a tick landing inside the final half-second of a window — pure luck at a 4-second poll — so most windows slipped by ungraded. The desk now settles the moment the market rolls to the next window. The graded counter should climb every 15 minutes, around the clock.",
  },
];
