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
  {
    slug: "2026-09-05-realtime",
    body:
      "The floor moves in real time now. Spot, the book, dist-to-strike, the window clock, and the two headline charts ride a 1.5-second pulse with smooth motion between prints — no more freeze, wait, jump. Honesty is built in: if the feed actually stalls, the motion stops and the ages count up, so a dead tape can never look alive.",
  },
  {
    slug: "2026-09-05-chair-v2",
    body:
      "A second chair is on the floor, in shadow. Chair v2 turns every seat's honest read — before the whisper filter — plus the market price into one probability learned from the desk's own ledger, and only calls where it beats the ask by more than the fee. It trades on paper beside the chair you know, on identical windows, and the nightly recap keeps score in cents. It earns promotion by winning, not by decree. WICK's uncalibrated cap now matches the speaking bar, so a strong pin can finally be heard.",
  },
  {
    slug: "2026-09-06-honest-ledger",
    body:
      "Four honesty fixes. One paper position per window, held to settlement: the flip autopsy showed 40 of the last 42 calls were flips, sold low and bought high for -83¢. Late fair value now carries settlement-basis noise, so no chair claims edge inside the band where the index can land, and the ledger logs spot at every close so that band gets measured. Unproven seats' sits stop raising the bar. Chair v2's promotion gate is written down: 300 graded samples, 40 calls net positive, a better Brier than the market.",
  },
  {
    slug: "2026-09-06-lab",
    body:
      "The lab is open. The desk now listens to Kalshi's own settlement index (BRTI) and order book over a live feed, records every tick and book change for replay, and prices each window on the actual rule: the 60-second index average in the final minute. It checks that rule against every official result, measures the gap between our price feeds and the index, and tests whether a stale quote can really be hit at our speed. Nothing trades on it yet. This week the desk measures instead of guessing.",
  },
  {
    slug: "2026-09-06-lab-rule",
    body:
      "Confirmed from Kalshi's own rules: a window settles on the average of the 60 index prints in its final minute, and the strike is the previous window's average. The lab now reads that running average straight from Kalshi's feed as it accumulates, and checks its own arithmetic against Kalshi's official settlement value on every window. Fees are now booked to the hundredth of a cent, as Kalshi charges them.",
  },
  {
    slug: "2026-09-06-floor-unmuted",
    body:
      "The floor was mostly mute by accident. The rulebook writes a seat's confidence as an edge like 0.55, but a formula turned 0.55 into 50, under the 52 needed to speak, so most seats could only be heard in the last minutes. Confidence now means what the rulebook says. WICK's confirmed patterns no longer get capped as if the candle were still forming. And every seat now earns its record from what it saw, gagged or not, so a quiet seat can calibrate its way to a voice instead of waiting forever.",
  },
  {
    slug: "2026-09-07-pit-crew",
    body:
      "Meet the Pit Crew, a new tab. Three helpers work on the seats, never on the market. SWEEP grades every seat from receipts once a day and raises flags: dead, mute, deadlocked, anti-signal, gold. COACH owns each seat's knobs, the speaking bar, an edge multiplier and a bench, and turns them only on evidence from windows it did not tune on, one small step a week, reverting what proves worse. WRENCH is a scheduled mechanic that opens pull requests for real bugs. No human control writes the knobs.",
  },
  {
    slug: "2026-09-07-arena",
    body:
      "Step onto the floor. The new ARENA tab lets you make your own paper call on the live window, UP or DOWN, booked at the ask plus Kalshi's fee exactly like the chair, one call per window, held to settlement. No login, just a callsign. The leaderboard scores humans against SATOSHI and Chair v2 in cents after fees, this week and all-time, and shows you how your confidence compares with your record.",
  },
  {
    slug: "2026-09-07-books",
    body:
      "Open the books. The new BOOKS tab reads the ledger and shows the chair's money after fees: today, this week and all-time, a running cents curve with each day's bars, a calibration chart that asks whether the price the chair paid told the truth, an hour-by-weekday heat map of where the cents come from, and the last forty windows with Kalshi's official settlement value, the chair's call, how many seats were right and what the Arena did.",
  },
  {
    slug: "2026-09-07-replay",
    body:
      "Rewind a window. Click any window in the BOOKS tab that has a play mark and scrub back through it: BTC against the strike, the yes ask against the lab's fair value, the chair's lean as a coloured band with the moment it booked, and every seat's lean as a lane, solid when it spoke and faint when it whispered under the gag. The desk records a sample every four seconds and writes the window once it grades; windows before today have no replay.",
  },
];
