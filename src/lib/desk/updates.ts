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
];
