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
  {
    slug: "2026-09-07-alerts",
    body:
      "Get a tap on the shoulder. SETTINGS now has Alerts: a push notification to your phone or browser when the chair books a call, and if you want, when the window settles, with your own Arena result on the line. Per browser, opt in only, and the browser asks permission once. On iPhone and iPad, add the site to your Home Screen first. Press send a test to see one land.",
  },
  {
    slug: "2026-09-07-floor-polish",
    body:
      "The floor learned to introduce itself. A first visit now opens with one card that says what this is (a paper-only Bitcoin 15-minute research desk, twenty seats, SATOSHI chairs) and what it is not, with one button to start the 60-second tour. The tabs are grouped (SATOSHI, FLOOR for the five seat desks, ARENA, BOOKS, BOARD, and MORE), every button is thumb-sized on a phone, ⌘K opens a search for any tab, seat or word on the floor, the chair's call explains itself, the seat list can be filtered to the seats that are speaking, the wait for the first frame shows what is coming and offers the demo tape, and there are three reading pages: How it works, FAQ and Paper only.",
  },
  {
    slug: "2026-09-07-the-pit",
    body:
      "THE PIT is open at /arena: a one-page room for the Arena that works on a phone without opening the desk. See the live window and its clock, pick a callsign, lock UP or DOWN once at the ask, and see YOU LOCKED on a ticket. Everyone sees how many have locked; the split and the average paper lock show only after you have locked the window yourself. Your record and the week board sit underneath. Paper calls only, not advice, not Kalshi orders.",
  },
  {
    slug: "2026-09-07-pit-followups",
    body:
      "THE PIT learned to follow through. A locked ticket now has Tell me when it settles, one tap that turns on the push alert for that browser with your result on the line, and a share button that hands your lock to the phone's share sheet as plain text, paper and all. A settled ticket shows Kalshi's official value beside the strike. Your last ten locks sit under your line. The week board ranks a callsign only after three settled locks; before that it says warming up, so one lucky lock cannot top it. And PIT CREW gained a TRAFFIC table: first-party counts of views, locks, tours, glossary opens, searches, shares and alerts, with no scripts, no cookies and nothing about who.",
  },
  {
    slug: "2026-09-08-pit-walkthrough",
    body:
      "THE PIT explains itself on a first visit: four short stops over the window, the lock, the room and the settle, skippable, and replayable any time from how it works in the room's header. It says the same things the room's copy says, in order: one window at a time, lock once at the ask plus fee on paper, the room shows itself after you lock, come back when it settles.",
  },
  {
    slug: "2026-09-08-pit-house-rules",
    body:
      "House rules for THE PIT. The test locks from the build are cleared. A callsign now belongs to the first browser that takes it, so nobody can wear someone else's name; a network can create three new callsigns a day, so a bad week cannot be shrugged off with a fresh name every hour; a name is ranked only after three settled locks; and every board row shows the day the callsign joined, so a fresh name looks fresh. No accounts, no addresses stored. SETTINGS gained a Clear the Arena control for the desk's owner.",
  },
  {
    slug: "2026-09-08-quiet-alerts",
    body:
      "Alerts learned when to keep quiet. A settle push now arrives only for a window that mattered to you: one you locked in the Arena, with your result on the line, or one the chair called. Windows where the chair sat out send nothing. The site also has a proper Home Screen and notification icon at last, and the previous Council's old API addresses answer with a calm gone instead of an error, for any old tab still polling them.",
  },
  {
    slug: "2026-09-08-seat-review",
    body:
      "A seat review, with numbers. EXHAUST had every pattern behind a hard 1% hourly run and this week never saw one; all six patterns now use one tunable run threshold that starts at 0.7% and the learner can move. CHEAP is retired to shadow: a side only gets cheap when the price has run away from the strike, which is when STRIKE already owns the window, and its record was 0 for 8; its reads are still graded. WIRE now tags a Fear & Greed extreme instead of pretending to vote with a confidence that could never clear the bar. Chair v2 buys no more longshots: it was 2 for 43 under 30¢. It now needs six cents of edge, never buys under 35¢, and may only disagree with the market as far as its calibration record has earned, which today is not at all. It leaves the public boards until it does.",
  },
  {
    slug: "2026-09-08-price-floor",
    body:
      "The chair's paper book now has a price floor: it only fills at 70¢ or better. The record made the case — of 52 graded calls, the 20 booked under 70¢ won 4 and lost 280¢; the 32 at 70¢ or better won 28 and made +202¢ after fees. Under the floor the chair still shows its read and the seats still grade on it; the book just waits. Old calls stay in the ledger as they were.",
  },
  {
    slug: "2026-09-08-index-seat",
    body:
      "A twenty-first seat, from the lab. INDEX (BRTI) prices each window on the settlement rule itself: the average of the final minute's sixty index prints against the strike, with the prints already locked counted as known. It votes the side whose ask sits under that fair by more than the fee, loudest in the final minute. It starts in shadow with a small voice and earns rank like every seat.",
  },
  {
    slug: "2026-09-08-watchdog",
    body:
      "The desk now watches itself. If no window grades for twenty minutes, the owner gets a push naming the quiet spell, the last error the brain logged and the state of the feeds, a reminder each hour it lasts, and a note when grading resumes. It is turned on from SETTINGS → Alerts with the admin key; nobody else can receive it. A public desk that has stopped grading should not be quiet about it.",
  },
  {
    slug: "2026-09-08-lab-pane",
    body:
      "BOOKS now shows the lab's stale-quote study, counted honestly: one paper trade per window at the first stale ask the settlement index left behind, held to settlement after the fee, and the same for the final minute. A measurement of the market, not a strategy the chair can run: that edge lives at 200 milliseconds on the cheap side; the chair ticks every four seconds and books at 70¢ or better.",
  },
  {
    slug: "2026-09-08-window-page",
    body:
      "Every graded window now has its own page you can share. satoshiscouncil.com/window/ followed by the window's ticker replays what the seats saw and said, the chair's read and Kalshi's official settlement value. From BOOKS, pick a window marked ▶ and use \"open as a page\". Paper only, as always; nothing on a replay was a live order.",
  },
  {
    slug: "2026-09-08-site-edges",
    body:
      "The desk now has a sitemap and a feed. /sitemap.xml lists the pages and every window replay; /feed.xml carries the board's updates for a feed reader. And on Sunday mornings DESK posts the week's recap here: windows graded, the chair's calls and cents, reads held under the floor, the sharpest and roughest seats, the Arena's week and the lab's one-trade-per-window count.",
  },
  {
    slug: "2026-09-08-phone-diet",
    body:
      "The floor got lighter on a phone: one quiet line of what this is and is not, no banner, a shorter strip, and seats that are sitting fold into one row each until you tap them (or expand all). Under the chair's call, one plain sentence now says why: who leans which way, whether the ask clears the 70¢ floor, and what is booked. Prices read the same everywhere, and the replay lanes have a legend.",
  },
  {
    slug: "2026-09-09-share",
    body:
      "Every tab and desk now has an address you can share or bookmark, such as /?tab=books or /?seat=INDEX, and every seat has its own page at /seat/ followed by its name, with its live card, graded record and skills. Links to window and seat pages carry their own preview: a small pixel-drawn card of the window's price against the strike, or the seat's record, drawn on the server itself.",
  },
  {
    slug: "2026-09-09-one-system",
    body:
      "One visual system, from the favicon to a phone. The desk now has one palette (ink, ivory, a single gold), two typefaces (Geist for words, IBM Plex Mono for numbers), one corner radius, one sticky header on every page with the new crest, and one family of buttons and inputs. Nothing about the research, grading or calls changed — only how the same information looks.",
  },
  {
    slug: "2026-09-09-one-system-tables",
    body:
      "Every table on the desk now reads the same way — the leaderboard, the crew scorecards, the books' recent windows and lab — mono figures, hairline rows, headers in small caps, and the amber caution flag finally shows. One slider accent, one gold focus ring you can see, and the vote colours always carry the word UP, DOWN or WAIT beside them. Presentation only; the numbers are the same.",
  },
  {
    slug: "2026-09-09-ledger-clerk",
    body:
      "Meet LEDGER, a fourth PIT CREW clerk — a reader, never a voter. It mines the ledger's vote matrix for coalitions and pairs of seats that call better together than alone, with a hit rate, sample and Wilson floor. A card is cited only once its edge holds on windows after the ones it was found on; one that resolves against its members is inverted, not deleted. The chair may cite it, never obey it.",
  },
  {
    slug: "2026-09-09-keeper",
    body:
      "A scorecard for how the desk plays, not just whether it won. BOOKS now shows the process: how often the chair sits, how hard the calls that filled cleared the bar, whether they kept the 70¢ floor, and the worst drawdown the paper book has run — the risk number a win rate hides. All from the ledger, after fees, all-time and this week.",
  },
  {
    slug: "2026-09-09-guards",
    body:
      "Two quiet guardrails. STALE: if the spot feed prints the same price for four minutes it is stuck, not calm — the warden now silences the candle seats instead of letting them read a frozen tape, the way it already does for frozen open interest. LOCK: when the regime breaks, the desk holds its seat weights steady for a few windows so one rough patch cannot rewrite what the last regime earned.",
  },
  {
    slug: "2026-09-09-gavel",
    body:
      "Two lists, never mixed. GAVEL is the chair's decisions — every window, WAIT included; a WAIT settles as a dash, since the chair held no position. SEATS is each specialist's own paper scalps, collapsed, never a chair call. A new overnight ribbon shows the chair's last 12 hours and where BTC went. WARDEN, ORBIT and WIRE moved to the pit crew: they inform, they no longer vote.",
  },
  {
    slug: "2026-09-09-one-board",
    body:
      "One Board, one row. The header had two ways in — a stray Board button on the left and the BOARD tab — so the duplicate is gone; the count of new posts now rides on the tab itself. FLOOR, DESKS, ARENA, BOOKS and BOARD all sit at one size in one row. Housekeeping at the top of the page — nothing about the desk or its calls changed.",
  },
  {
    slug: "2026-09-09-readiness",
    body:
      "The desk knows when it is ready to be judged. A new owner-only gate in SETTINGS counts what has built up since the TAKER shadow seat was frozen — graded windows, TAKER's own calls, the chair's WAIT windows, regime breadth, a clean ledger — and says so only when there is enough to grade the experiment fairly. It decides nothing and changes no call; TAKER and the chair stay exactly as frozen.",
  },
];
