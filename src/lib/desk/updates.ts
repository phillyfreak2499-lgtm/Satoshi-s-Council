/**
 * Desk changelog, written for the floor — not commit messages.
 * Each entry becomes a pinned "update" post on the Board (upserted by slug
 * at server boot). A posted note is never rewritten — editing a body here
 * changes nothing already on the Board, so add a NEW slug for a new update;
 * the one exception is a note that was clipped on the way in, which is
 * completed in place. Keep bodies short, one thought per entry, plain
 * language, at most BOARD_UPDATE_MAX characters (a test holds the line).
 * Newest last; the board shows newest first.
 */
export type DeskUpdate = { slug: string; body: string };

/** Most characters the Board takes for one note. The digest and the lab recap
 *  post at the same size; a test refuses any note longer than this, so a note
 *  can never be clipped mid-word on the way in. */
export const BOARD_UPDATE_MAX = 900;

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
  {
    slug: "2026-09-10-replay-side",
    body:
      "The window replay now says which side the chair booked. It always recorded the entry, the settle and the cents after fees, but not the side — so a losing UP call, drawn in red beside the window's DOWN result, could read as if the desk had bet DOWN. The replay now marks the booked side, UP or DOWN, in the header and on the chart, so a held call reads correctly even when it lost. Display only; nothing about the calls or grading changed.",
  },
  {
    slug: "2026-09-10-display-truth",
    body:
      "The pit crew's mechanic got a new beat. WRENCH now also hunts display bugs — checking that every screen matches the record behind it — so a held call always shows the side it was booked on, not a lean that later went quiet. In the same pass, GAVEL and the shareable window card were aligned to name that side, matching the books and the replay; one helper decides it everywhere so they can't drift apart. Display only, nothing about the calls changed.",
  },
  {
    slug: "2026-09-10-digest-fits",
    body:
      "The desk's nightly recap stopped cutting itself off. The daily digest was capped at 400 characters and clipped its last line mid-word — usually LEDGER's read on the day's vote patterns. The cap now leaves room for the whole recap, the way the lab's post already does. Display only; the numbers were always right, they just weren't all showing.",
  },
  {
    slug: "2026-09-10-settled-mark",
    body:
      "The replay stopped looking broken on a near-the-line finish. BTC's last tick can sit above the strike while the window still settles DOWN — it grades on the average of the final minute, not the last print. The chart now marks where the window actually settled, in the result's colour, so a DOWN window visibly settles below the line even when spot ended above. Same mark on the shareable window card. Display only; grading is unchanged.",
  },
  {
    slug: "2026-09-10-breakeven-lens",
    body:
      "BOOKS now shows the number a win rate has to beat. Each card carries needs — the win rate those calls had to reach to break even after Kalshi's fee (for a call held to settlement, the price paid plus the fee) — and colours the real win rate by the net, so 80¢ favourites winning 80% read red, as the net already said. The calibration chart marks breakeven on every price shelf, and a new card splits the record at the 70¢ floor, marked on the curve. Display only; no call changed.",
  },
  {
    slug: "2026-09-10-board-whole",
    body:
      "The Board stopped clipping the desk's own notes. Update posts were cut at 400 characters on the way in, so eighteen notes since Sep 5 ended early, several mid-word. The Board now takes a note whole, completes each clipped one in place at boot, and a test refuses any note too long to post. Display only; nothing about the desk or its calls changed.",
  },
  {
    slug: "2026-09-10-gavel-size",
    body:
      "GAVEL can be read at size. A view-at picker on the Chair's decisions shows the same fills as if each had been 10, 25, 50, 100 or up to 1,000 contracts: cents become dollars and Kalshi's fee is worked at size the way the exchange rounds it, so 100 contracts at 70¢ pay 147¢, not 200¢. The ask is assumed to hold, which real size would not always get. Display only; the desk still books one paper contract.",
  },
  {
    slug: "2026-09-10-sits-truth",
    body:
      "The desk stopped counting its own trades as sits. A held position's lean usually goes quiet again before the window closes, and five places read that quiet lean as the decision — so a window the chair traded was tallied as one it passed on. The process scorecard said it sat 99% of windows while also reporting fills, which could not both be true; it now reads 82%, and sits plus fills cover every window. The same correction reaches the overnight ribbon, LEDGER's pattern cards, the TAKER read-out's when-the-chair-sat cut, and the owner's readiness gate, which was running 36 windows ahead of itself. One helper now answers what the chair did, so these cannot drift apart again. No call, bar, floor or grading rule changed.",
  },
  {
    slug: "2026-09-10-feed-integrity",
    body:
      "The desk reads Kalshi's trade tape by the current field, not the deprecated one. A public trade says which way it went in taker_outcome_side; the older taker_side is on its way out, and the lab was reading only that one while the REST path preferred it over the current field. Both now read the canonical field first, an unreadable trade counts as unknown rather than as a buyer, and the exchange's own clock is kept apart from ours so feed lag still reads as lag. The rebuilt order book also stops trusting itself after a dropped message: a gap in the sequence quarantines the book until a fresh snapshot re-anchors it, so no study prices off levels that may already be gone. Measurement only — no call, bar, floor or grading rule changed.",
  },
  {
    slug: "2026-09-10-floor-trial-80",
    body:
      "The paper book is trying a higher price floor: it now fills only at 80¢ or better instead of 70¢. That is a price floor, not a confidence level — 80¢ is what the contract costs, not how sure the desk is. The books made the case: the 70–79¢ shelf won about 65% of 29 calls against the 74% it needed, while 80¢ and up was the only part of the book in profit. Thin evidence, so this is a trial, reviewed after three to seven days or 25 fills at the new floor and not touched before then. It wins more often for a smaller prize, which also lifts breakeven from about 72% to about 82% — read the net, not the win rate. Under 80¢ the chair still calls and every seat is still graded; the book just does not pay. The old floor runs beside it as a shadow book on the same windows, shown as research. Old fills are untouched, and going back is one number.",
  },
  {
    slug: "2026-09-11-scorecard-honest",
    body:
      "The Process Scorecard is back, and it can no longer lie when it breaks. Yesterday's floor-trial change made its query compare a price against an untyped value, so the query failed every time — and the card answered that failure with zeros. The page then said the chair had sat 0% of 0 windows and booked nothing, directly beside totals showing a hundred fills. The query is fixed and counts every graded window again, in both eras: a fill is judged against the floor that applied when it closed, so older fills are not marked down by the newer floor. And a scorecard that cannot be computed is now simply absent, with the reason shown, instead of inventing a perfect record. Zeros from here on mean an empty ledger and nothing else. No call, floor, grading rule or past number changed.",
  },
  {
    slug: "2026-09-11-floor-copy",
    body:
      "The page now says 80¢ everywhere it means 80¢. When the floor moved, the constant moved but a dozen labels and tooltips still described the old 70¢ rule in the present tense — the scorecard, the fills and sits explanations, the call chip, the lab aside and the owner's evaluation prompt. Those now read the floor from the same constant the book fills at, so they cannot drift apart again, and a test fails the build if any of them claims a floor the book does not pay. The cumulative curve marks both boundaries instead of only the older one, and the old era's card is labelled as an era rather than as the current rule. Dated notes below are left exactly as written: they were true when posted. No call, floor, grading rule or past number changed.",
  },
  {
    slug: "2026-09-11-tape-2",
    body:
      "The desk started measuring the order book properly. TAPE has always read the size at the best bid and ask, but the lab already rebuilds Kalshi's whole book from its live feed, so far more was on the table. Thirty-odd measurements now run every second: how lopsided the book is three and five levels deep, where the size-weighted price sits against the midpoint, whether resting size is being posted or pulled, whether a drained level comes back, how long any of it holds, and how thick the book gets away from the touch. One rule governs all of it — a cancelled order is not a trade. A quote vanishing because someone pulled it means something different from one vanishing because someone bought it, so book pressure and real executions are counted separately. None of it votes: no seat reads it and no skill exists for it yet.",
  },
  {
    slug: "2026-09-11-vel-2",
    body:
      "VEL stopped assuming one exchange rate between Bitcoin and cents. Its production read converts a BTC move into expected contract cents using a single fixed multiplier, the same one in every window — but a fifty-dollar move is nearly meaningless with ten minutes left and the strike four hundred away, and close to decisive with forty seconds left and the strike five away. A new shadow measurement works out what the move should have been worth from the contract's own sensitivity, which depends on distance to the strike, time remaining and volatility, with no fitted parameters. What is left over after subtracting that is the part of the move the underlying does not explain. It also stops assuming Bitcoin leads: it measures which market actually moved first at four horizons and reports honestly when neither did. Research only; the production read is unchanged and nothing votes on this.",
  },
  {
    slug: "2026-09-11-strike-2",
    body:
      "The desk checked whether its own odds beat the market's, and the answer was no. STRIKE fires when the strike is more than 0.7 standard deviations away, which is a threshold, not a probability: it cannot say whether a setup is a 70% proposition or a 95% one, so it cannot be graded for calibration. A shadow study now turns the desk's fair value into a real probability, corrects it against what actually happened in each distance bucket, and scores the result against the price Kalshi was charging at the same moment. Over 468 settled windows the market scored 0.157, the desk's raw fair value 0.158, and the corrected version 0.158 — lower is better, and those gaps are noise. So the desk is about as well calibrated as the market and no better, which means the edge is not in guessing direction; it is in price and fees. Nothing votes on this, and a study cannot promote itself.",
  },
  {
    slug: "2026-09-11-call-costs",
    body:
      "The floor now shows what a call actually costs, in one row under the chair's read: side, fair value, ask, fee, edge after the fee, the win rate that price needs to stand still, the leftover on the two legs, the size resting at the touch, and the 80¢ floor — with a plain line saying whether the book pays and, if not, what is in the way. Every number is carried from the same frame the desk decided on rather than worked out a second time, and a test holds that line. It also fixed a mislabel: the chair line read \"leftover\" beside a number that was the edge, while the real leftover was not shown at all. Those are now two cells with their own names. And one case the page never admitted — an ask that clears the floor with nothing resting behind it — now says both things: the book would pay, and the touch is empty. No call, floor, grading rule or past number changed.",
  },
  {
    slug: "2026-09-11-performance-cube",
    body:
      "The books were cut every way that might matter, and the biggest line in them is a rule the desk already retired. Until Sep 6 a call could add legs and be sold at a mid price; since then it is one contract held to settlement. Split there: the retired style booked 24 calls, won 37.5% against the 68.8% those prices needed, and lost 118¢. The current style has booked 80, won 80.0% against 79.7% needed, and is down 15¢ — about a fifth of a cent a call. Nearly all of the all-time loss belongs to a mechanism that no longer runs. The cut also refuses to guess: a position sold at 68¢ says nothing about which side won, so those calls keep their cents and lose their side. Every cell now shows the range around its win rate, the breakeven its own prices demanded, and how many cells that many cuts would make look good by luck alone. Reporting only — nothing changed.",
  },
  {
    slug: "2026-09-11-replay-microstructure",
    body:
      "Window replay now records what the order book was doing, not just what it was quoting. Scrub back through any window from here on and beside spot, the book and the chair's read you get seven more traces: how lopsided the book was five levels deep, where the size-weighted price sat against the midpoint, order-flow imbalance, how much of the churn was orders being pulled rather than filled, net executed size, the part of the last thirty seconds of price move Bitcoin does not explain, and which of the two markets moved first. The point is to be able to lose an argument: on a window that went wrong you can now ask whether the book was already saying so, and be told no. Where the feed was dark the trace is blank rather than zero — a zero would read as a calm book instead of a missing one. Windows recorded before today simply do not have these. Nothing votes on any of it.",
  },
  {
    slug: "2026-09-11-mae-mfe",
    body:
      "The books now know what a call was worth while it was still open, not just what it cost and what it settled at. Walking the stored replay of 69 held calls: the 55 winners were up 18¢ at their best on average — and were down 17¢ at their worst. The 14 losers were up 11¢ at their best, and 64% of them were up at least 5¢ at some point. Read carelessly that says cut the losers early. Read properly it says the opposite is just as likely: a rule that cut a loser at its best mark would have cut most of the winners first, because the winners fell further than the losers ever rose. Both numbers are printed together for exactly that reason, and a peak found after the fact is not a level anything can trade at. Fourteen losers is a direction to look, not a finding. Nothing votes on this and no exit rule exists.",
  },
  {
    slug: "2026-09-11-seat-redundancy",
    body:
      "The desk asked whether twenty seats are twenty pieces of evidence or the same few counted several times. For each seat: drop it from the tally, and on the windows where that changes the answer, is the room more right with it or without it? Over 534 graded windows, five seats change the answer often enough to read. Four earn it clearly — STREAK, CHAIN, CASCADE and STRIKE. One does not: TAPE speaks on 72 windows, is right 40% of the time, and on the 34 windows where it moves the room the room was right 16 times without it against 9 with it. That is not a verdict and TAPE has not been touched. Five seats were tested, so one looking that bad is close to what luck supplies, and the figure is measured on windows that already happened. If TAPE is to lose its voice it has to be run gagged in shadow first and be shown not to be missed. Nothing here changed a seat, a weight or a call.",
  },
  {
    slug: "2026-09-11-seat-signal",
    body:
      "A seat's hit rate turned out to measure almost nothing. Kalshi's own price is right about four times in five on these windows, so a seat that mostly nods along scores 75-90% without having contributed a thought. The real question is what happens when a seat objects: the price stated a probability, so did it come true? Across 467 graded windows, two seats pass. When DRIFT objects the price is worth about 9 points less than it claims; when CASCADE objects, about 8 points less. Both are worth something even though both lose most of those bets — on a desk that pays the ask, knowing a favourite is overpriced is the edge, and picking the upset is not required. Four seats run backwards: when CHAIN, TAPE, WICK or FADE object, the price turns out MORE right than it said. That is worse than silence. Nothing was reweighted, and these have to hold up on windows recorded from here on.",
  },
  {
    slug: "2026-09-11-phantom-levels",
    body:
      "Verifying yesterday's replay change turned up a real bug in the desk's copy of the order book, and it had been there a while. A price level's size is kept by adding and subtracting quantities as orders arrive and cancel. Kalshi's quantities are decimals, and decimals do not add up exactly in binary — so a level cancelled down to nothing lands on a millionth of a millionth rather than on zero, and the book kept it as a real level at a real price with nothing behind it. Of the 22,402 resting sizes the lab had recorded, 20,028 were that kind of residue. It could be reported as the best quote, and the new order-flow reading divided by it and returned numbers around a hundred quadrillion. Levels below a millionth are now dropped — five orders of magnitude under the smallest real order ever seen here, so nothing genuine goes with them. No call, floor, grading rule or past number changed.",
  },
  {
    slug: "2026-09-11-whale-real-prints",
    body:
      "WHALE now watches real trades instead of guessing from candle volume. The old seat infers a big player from a bar that traded above its median — which cannot tell one large order from fifty small ones, cannot say who crossed the spread, and never sees the trade itself. Kalshi's feed carries the executions with an aggressor side, so a separate lab reads them: where each print ranks against recent sizes, orders sliced into pieces counted as the one decision they are, which side was aggressive, how far the midpoint moved and how far per contract, whether it kept going or came back — and the one a volume count can never see: size crossing with the price refusing to move, meaning someone is quietly taking the other side. The old seat is untouched and keeps its own record. The two are never merged. Nothing votes on any of it.",
  },
  {
    slug: "2026-09-11-absorption-study",
    body:
      "The desk is done adding instruments for now and has started collecting evidence on the ones it has. Absorption is the one worth watching: aggressive size crosses the spread and the price refuses to move, which means somebody is quietly taking the other side. Every real trade is now written down with what happened next — over five, fifteen, thirty and sixty seconds, what Bitcoin did in the same moments, how big the order was against the book, and where the price and the clock stood. Buying and selling are kept apart, one big order is kept apart from a burst of them, and nothing is labelled large or absorbed when it is recorded; those lines were fixed in advance and are applied only when reading. The question is not whether the desk would have won. It is whether the result came in more or less often than Kalshi's own price said it would. No answer before thirty clean cases.",
  },
  {
    slug: "2026-09-11-site-analytics",
    body:
      "The site now loads Google Analytics on every page. That is worth stating plainly, because the desk has said the opposite until today. The TRAFFIC table in PIT CREW counts visits on the desk's own server, with no scripts and no cookies, and its caption said so as if it described the whole site. The table itself has not changed and still knows nothing about who, but the site around it is no longer script-free, so that caption and the glossary entry behind it were narrowed to describe the table rather than the site. The older board note that made the same claim stands as written: it was true on the day it was posted, and this desk does not edit its own record. The tag is the standard measurement snippet, one per page, no tag manager. No seat, vote, floor or grading rule changed, and nothing it collects reaches the ledger.",
  },
  {
    slug: "2026-09-11-window-identity",
    body:
      "Eight windows are out of the desk's research numbers, and the fault behind them is closed. On 2026-09-10 the Kalshi feed stopped advancing the market ticker, and the code matching a settlement to a window checked one half of its identity at a time: the ticker while ignoring the clock, then the clock while ignoring the ticker. So one market's result was handed to nine consecutive quarter-hours — 07:15 through 09:00 all carry the 07:00 market's settlement. A result must now agree on the ticker, on the close time, and on the close time the ticker itself encodes. This was bad research data rather than lost learning: those rows came in on the path that skips teaching credit, so no seat or threshold was trained on them. They stay exactly as recorded, but they no longer count in any hit rate, calibration or seat study. A pending window now also survives a restart.",
  },
  {
    slug: "2026-09-11-the-lab",
    body:
      "The desk's own answer now has a name and a challenger bench. Until today the Floor was an accidental combination: the Council picked a side, the 80¢ floor decided whether to pay, and the position was held to settlement because nothing else had ever been written. None of those three was a choice anything could argue with. They are now named as FLOOR_V1 — Council Chair, 80¢ floor, HOLD — and FLOOR_V1 is the Champion, which is to say nothing about the desk changed. Beside it four frozen alternatives start at zero: cut the position if it has not gained 10¢ within two, three or four minutes, or bank it if the bid ever reaches 90¢. Each is measured on the very same fill the Council actually took, priced only where the held side could genuinely have been sold, fees both ways. None of them can win anything yet, and the bar they must clear is written down before the evidence arrives.",
  },
  {
    slug: "2026-09-11-path-horizons",
    body:
      "A number the desk calls one minute of movement is usually five. Four seats read the recent price path by counting back a fixed number of slots and call the results d30, d60 and d120 as if a slot were seconds. It is not: the path is normally built from Kalshi's one-minute candles, so the offset named d60 really spans five minutes and d30 three. On the tick-by-tick feed the same offsets span twenty and twelve seconds \u2014 one named quantity, fifteenfold apart, decided only by which feed arrived. Nothing changed today. Every point now carries the timestamp Kalshi gave it, and every reading is written down with three facts kept apart: the span it covered, how old its newest point was when the desk decided, and so whether it describes the last minute or a minute that ended a minute ago. Those are not the same thing, and an exact-looking span can still be the wrong interval.",
  },
  {
    slug: "2026-09-11-floor-clarity",
    body:
      "The floor now says which number is which. A locked paper entry and a live quote looked alike, so each price now carries its kind and the moment it belongs to, and an entry is never redrawn to match a later quote. The reason for the call moved up next to the call instead of sitting four panes down, and when the desk waits it says which kind of waiting \u2014 a gate that failed, a vote that fell short, or nothing worth paying for. Two public pages still said the book fills at 70\u00a2; it has been 80\u00a2 since the trial began. The decisions table showed confidence as a percentage, which read as a chance of winning; it is a margin over a gate and is now shown as one. Tests fail if either drifts back. Nothing about how the desk decides changed."
  },
];
