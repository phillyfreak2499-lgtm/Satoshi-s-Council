import { FLOOR_LIVE_CENTS, FLOOR_SHADOW_CENTS } from "./book-floor";
import type { TabId } from "./types";

/**
 * The live floor appears in a lot of copy, so it is interpolated from the
 * constant rather than typed out. When the trial ends, the one constant moves
 * and every line below follows it — the page cannot go on claiming a floor the
 * book no longer pays. Lines that describe a PAST era, or that use a price as
 * fee arithmetic, keep their literal number on purpose.
 */
const LIVE = `${FLOOR_LIVE_CENTS}¢`;
const SHADOW = `${FLOOR_SHADOW_CENTS}¢`;

export type Gloss = { title: string; body: string };

export const GLOSS: Record<string, Gloss> = {
  "beta.badge": {
    title: "Beta",
    body: "This desk is unfinished. The bots are still learning. Treat every call as practice.",
  },
  "beta.disclaimer": {
    title: "Paper only — not advice",
    body: "No live orders. SATOSHI and the seats grade themselves after each 15-minute window. Friends can watch; nobody should size a real bet off this tape. Not financial advice. Use BOARD to post ideas and leave feedback.",
  },
  "beta.feedback": {
    title: "Board",
    body: "Shared ideas and feedback. Post an idea, reply on it, or leave tape notes. The call you were looking at rides along.",
  },
  "tab.satoshi": {
    title: "FLOOR — the chair's call",
    body: "Weighs the voting seats into one paper call: UP, DOWN, or WAIT. Same-evidence piles count as one voice. The board is the call. The charts are the eyes. The log is every directional fill vs 100¢ at the window end.",
  },
  "tab.atelier": {
    title: "ATELIER — the painting",
    body: "A living color field of SATOSHI's paper call. Down sits high in red, Wait in gold, Up in the green. The ring is the 15-minute window. The chair is the only brush.",
  },
  "tab.structure": {
    title: "STRUCTURE — candles",
    body: "WICK, DRIFT, STREAK, EXHAUST. Patterns, drift, settle streaks, and exhaustion.",
  },
  "tab.tape": {
    title: "TAPE — volume and book",
    body: "PULSE, TAPE, WHALE, VEL. Volume spikes, Kalshi flow, large prints, spot vs YES lag.",
  },
  "tab.derivs": {
    title: "DERIVS — funding and OI",
    body: "CARRY, CHAIN, CASCADE, VOLT. Funding, open interest, real liquidations, volatility regime.",
  },
  "tab.book": {
    title: "BOOK — the contract",
    body: "ODDS, STRIKE, CHEAP, FADE, INDEX. YES path, spot vs strike, cheap/rich bands, fast YES rips, the settlement index fair.",
  },
  "tab.context": {
    title: "CONTEXT — background",
    body: "ORBIT, CLOCK, WIRE, WARDEN. Regime, session clock, Fear & Greed, feed health.",
  },
  "tab.arena": {
    title: "ARENA — THE PIT",
    body: "A one-page room for your own paper call on the live window: UP or DOWN, booked at the ask plus Kalshi's fee exactly like the chair, one lock per window, held to settlement. No login — pick a callsign once. The room shows how many have locked; the split appears after you lock. The week board scores humans against SATOSHI and Chair v2 in cents after fees. The desk can hide a callsign that breaks house rules. Paper results stay on the private record.",
  },
  "arena.call": {
    title: "Your call",
    body: "Buy the side you believe at its current ask. A win pays 100¢ minus the ask minus the fee; a loss costs the ask plus the fee. Calls close 30 seconds before the window ends. The confidence slider is for you: the site will show how your stated confidence compares with your real hit rate.",
  },
  "tab.books": {
    title: "BOOKS — the desk's money, window by window",
    body: "Everything the chair has booked, straight from the ledger and after Kalshi's fee: today, this week and all-time, the cents curve, whether the price the chair paid told the truth, the hours it wins and loses, and the last forty windows with the official settlement value beside each result.",
  },
  "books.last": {
    title: "Last window",
    body: "The most recent graded window: what the market settled at (Kalshi's official value, the average of the final minute's sixty BRTI prints), which way it went, what the chair booked and what it made, how many seats were right, and what the Arena did.",
  },
  "books.curve": {
    title: "The curve",
    body: "Running total of the chair's cents over the last fourteen days, one point per booked window, after fees. The bars underneath are each day's net. Flat stretches are windows the chair sat out.",
  },
  "gavel.list": {
    title: "GAVEL — Chair decisions",
    body: "Every graded 15-minute window the Chair decided, newest first, WAIT included. WAIT is a real decision and prints as a row; it is not a trade, so its settlement shows a dash. UP and DOWN rows show what the position settled at and what it made after the fee. This is the Chair only — never a specialist seat's fill. View at reads the same decisions at 10 to 1,000 contracts.",
  },
  "gavel.size": {
    title: "View at size",
    body: "The desk books one contract on paper. Pick a size to read the same decisions as if each fill had been 10, 25, 50, 100 or more contracts: nothing about the call changes, cents become dollars, and Kalshi's fee is worked at size the way the exchange does it — 7% of price × (1 − price) × contracts, rounded up once per order — so 100 contracts at 70¢ pay 147¢, not a hundred times 2¢. One thing it cannot know is whether the ask had that size; a large order walks the book, so real fills at size would run a little worse than shown. Paper only; nothing is ever ordered.",
  },
  "seats.list": {
    title: "SEATS — specialist paper fills",
    body: "Each specialist seat's own paper scalps in cents — practice for that seat, not the Chair's book. A seat making +2¢ is not the Chair making +2¢: seats do not settle windows and are never Council calls. Collapsed by default; open it to see who has been active.",
  },
  "keeper.pane": {
    title: "Process scorecard",
    body: `Not whether the chair won, but whether it played the way it says it does: how often it sits, how hard the calls that filled cleared the confluence bar, whether the fills honoured the floor that applied when they closed, and the worst run of losses on paper. The live floor is ${LIVE} today; fills from before the trial are measured against the ${SHADOW} that applied then, so an older fill is not marked down by a rule that did not exist yet. All from the ledger, after fees, all-time and over the last seven days. Every call is graded at its own 15-minute close, never against a later price.`,
  },
  "keeper.wait": {
    title: "Sits",
    body: `Share of graded windows the chair took no position on — both the windows it called WAIT and the ones where it had a read but the ask sat under the live ${LIVE} floor. Sitting is the desk's most common outcome on purpose: it acts only when the seats agree hard enough to pay the ask, and a higher floor means sitting more often. Sits and fills cover every graded window between them, so the two add up. A high sits number is discipline, not idleness.`,
  },
  "keeper.booked": {
    title: "Fills",
    body: `Windows where the paper book actually took a side at the ask. The average is the price it paid; the chair buys favourites at or above the live ${LIVE} floor, so entries are usually rich.`,
  },
  "keeper.hit": {
    title: "Win rate",
    body: "Share of the fills that settled in the money. On its own it flatters an expensive-favourite book, so read it next to net and max drawdown.",
  },
  "keeper.net": {
    title: "Net",
    body: "Cents made or lost across the fills, after Kalshi's fee. Paper only.",
  },
  "keeper.dd": {
    title: "Max drawdown",
    body: "The worst peak-to-trough the cumulative paper cents has run in the scope. This is the risk number a win rate hides: a book can win most windows and still bleed if the losses are larger than the wins.",
  },
  "keeper.conf": {
    title: "Confluence",
    body: `Average of the chair's score divided by its bar on the windows that filled — how far past the threshold the call was, not just that it cleared it. Floor kept is the share of fills that honoured the floor in force when they closed: ${LIVE} during the trial, ${SHADOW} before it.`,
  },
  "books.calib": {
    title: "Did the price tell the truth?",
    body: "Booked calls grouped by the price the chair paid. The grey bar is the price; the gold mark just above it is the win rate that price needed once Kalshi's fee is in — a 70¢ contract needs about 72%, not 70%. The coloured bar is how often the chair actually won there: green cleared breakeven, red paid too much for what it won. Mind the count under each shelf; five calls is a hint, not a verdict.",
  },
  "books.trial": {
    title: "The 80¢ floor trial",
    body: "A deliberate, time-boxed experiment, reviewed after three to seven days or 25 live fills at the new floor. The paper book now pays only 80¢ or better. This is a price floor, not a confidence level: 80¢ means the contract costs 80¢, not that the desk is 80% sure. The record that prompted it is that the 70–79¢ shelf won about 65% of 29 calls against the 74% it needed, while 80¢ and up was the only part of the book in profit — a hypothesis on thin evidence, not a proven number, which is why it is a trial with a shadow book beside it and a one-line revert. The trade it makes: win more often for a smaller prize, which also raises the rate needed to break even from about 72% to about 82%. Under 80¢ the chair still reads UP or DOWN and every seat is still graded on it; the book simply does not pay.",
  },
  "books.floor": {
    title: `The ${SHADOW} era`,
    body: `The record from the moment the paper book stopped filling under ${SHADOW}: 3:47 pm Chicago on Sep 8, 2026. That was the rule until the ${LIVE} trial began — so this card is the ${SHADOW} era, not the book as it plays today. For the current rule read the floor trial card, which puts the live ${LIVE} book beside the ${SHADOW} book on the same windows. All-time keeps every call before either change exactly as it was booked.`,
  },
  "chair.economics": {
    title: "What this call actually costs",
    body: `Every number the book weighs before it pays, in one row, and all of them carried from the same frame the engine decided on — nothing here is a second calculation. FAIR is the desk's own odds for this side in cents. ASK is what the side costs right now. FEE is Kalshi's taker fee at that price. EDGE is fair minus ask minus fee: the cents the desk claims, after the fee. NEEDS is ask plus fee, the win rate this price has to clear to stand still. LEFTOVER is 100 minus both legs' asks — what the two sides leave on the table. TOUCH is the resting size a fill would have to take. FLOOR is the ${LIVE} the book pays at. If something is in the way the row says which: under the floor, no real price, or an ask at the floor with an empty touch.`,
  },
  "books.needs": {
    title: "Needs — the breakeven win rate",
    body: "The win rate these calls needed to stand still, worked from what their wins paid and their losses cost after Kalshi's fee. For a contract held to settlement that is simply the price paid plus the fee: bought at 70¢ it pays 28¢ after its 2¢ fee when it wins and loses 72¢ when it doesn't, so that book is flat only at 72 wins in 100; at 80¢ about 82. Won is coloured by the verdict — green cleared it, red fell short — and the verdict is the net itself, so the colour and the cents can never disagree: a high win rate on rich contracts can still read red.",
  },
  "books.heat": {
    title: "Hours",
    body: "Net cents by weekday and hour of the window's close, on Chicago time. Green cells made money, red cells lost it, dark cells had no booked call. Hover a cell for the count.",
  },
  "books.lab": {
    title: "The lab's stale quotes",
    body: `Since Sep 6 the lab has watched Kalshi's book while the settlement index moved. A shock is the index jumping while an ask stayed put; fillable means the stale ask was still there 200 milliseconds later. The numbers count one paper trade per window, bought at that ask and held to settlement after the fee, so a burst of correlated shocks cannot inflate them. A measurement of the market, not a strategy, and not part of the chair's book: the chair ticks every four seconds, cannot reach a 200-millisecond edge, and only fills at the live ${LIVE} floor anyway.`,
  },
  "books.replay": {
    title: "Replay",
    body: "Scrub back through a past window: BTC against the strike, the yes ask against the lab's fair value, the chair's lean as a coloured band, and every seat's lean as a lane (solid when it spoke, faint when it whispered under the gag). Windows graded since the recorder went in have a replay; older ones do not. Every replay also has its own page to share: open as a page.",
  },
  "settings.watchdog": {
    title: "Desk watchdog",
    body: "Owner only. The desk grades a window every fifteen minutes around the clock, so quiet means trouble. If no window grades for twenty minutes, the owner's phone gets a push naming the quiet spell, the last error the brain logged and the state of the feeds, a reminder each hour it lasts, and a note when grading resumes. Turned on with the admin key.",
  },
  "settings.alerts": {
    title: "Alerts",
    body: "A push notification to this browser when the chair books a call, and if you want, when a window that mattered settles: one you locked in the Arena, with your result on the line, or one the chair called. Quiet windows send nothing. Turn it on here; the browser will ask permission once. On iPhone and iPad the site has to be on your Home Screen first. Nothing is ever sent to a browser that did not opt in.",
  },
  "settings.readiness": {
    title: "Evaluation readiness",
    body: "Owner only, read-only. A gate that counts how much out-of-sample data has piled up since the TAKER v1 freeze — graded windows, TAKER directional calls, chair WAIT windows, regime breadth, ledger integrity — and says whether there is enough to run the first serious evaluation (does TAKER add information the Council lacked, and did the chair's bar pass up calibrated edges). It decides nothing; when it flips it hands over an exact prompt to paste back to Claude, and, if the watchdog is on, sends a one-time push.",
  },
  "tab.floor": {
    title: "DESKS — the five desks",
    body: "The specialist seats sit at five desks: STRUCTURE (candles and swings), TAPE (order flow and the Kalshi book), DERIVS (funding, open interest, liquidations), BOOK (the odds themselves) and CONTEXT (clock and regime). Each seat shows its hypothesis, evidence, counter and what would prove it wrong.",
  },
  "pane.seats": {
    title: "The specialist seats",
    body: "One row per seat, ranked by how much SATOSHI is hearing them right now. Speaking means the seat called UP or DOWN; sitting means it said WAIT or was not sure enough to clear the bar. Click a row to read that seat's why.",
  },
  "settings.display": {
    title: "Display",
    body: "Preferences for this browser only. Reduce motion turns off the desk's non-essential animation; the system setting of the same name is respected automatically.",
  },
  "crew.traffic": {
    title: "Traffic",
    body: "How many people are in the room and on the desk, counted first-party: page views, paper locks, tours started and finished, glossary opens, searches, shares and settle alerts. These counts come from the desk's own server rather than the site's Google Analytics tag: no cookies, nothing about who. One row per Chicago day.",
  },
  "settings.arena": {
    title: "Arena",
    body: "The room's house rules and its one admin control. A callsign belongs to the first browser that takes it; a network can create three new callsigns a day; a name is ranked only after three settled locks and shows the day it joined. Clear the Arena wipes every callsign and paper lock so the boards start over.",
  },
  "tab.crew": {
    title: "PIT CREW",
    body: "Staff that work on the seats, not the market. SWEEP grades every seat from receipts once a day and raises flags. COACH turns a seat's knobs, only on evidence from windows it did not tune on, one small step a week. WRENCH is a scheduled mechanic that opens pull requests for real bugs. LEDGER mines cross-seat vote patterns from the ledger and promotes the ones that hold out of sample. Nothing here votes or trades.",
  },
  "crew.ledger": {
    title: "LEDGER — the pattern clerk",
    body: "Reads the ledger's per-window vote matrix and mines patterns across seats: coalitions (a group that, when it agrees, the window resolves its way more often than any member alone) and pairs (two seats that reinforce or cancel). Each card carries a hit rate, a sample and a Wilson lower bound. A card is cited only when its edge holds on windows AFTER the range it was found on — never in-sample. One that resolves against its members is inverted, not deleted. LEDGER never votes; the chair may cite a promoted card as one more labelled, non-binding piece of evidence.",
  },
  "ledger.coalition": {
    title: "Coalition card",
    body: "A group of three or four seats that, on the windows where they all read the same side, resolved that way at a rate and sample whose Wilson lower bound beats every member on its own. Drawn from the seats with the best solo record.",
  },
  "ledger.pair": {
    title: "Pair card",
    body: "Two seats read together. Reinforce: when they agree, the window resolves their way more often than either alone. Cancel/inverted: their agreement tends to resolve the other way, so the card is cited inverted.",
  },
  "ledger.wilson": {
    title: "Wilson lower bound",
    body: "The conservative floor on a card's hit rate given its sample — a small sample pulls it down, so a card needs both a high rate and enough windows to clear the bar. LEDGER promotes on the lower bound, not the raw rate, and compares it to the best member seat's own bound.",
  },
  "ledger.cited": {
    title: "Cited",
    body: "Promoted. A card is cited only after its edge holds on the out-of-sample windows — the ones after the range it was found on — with a Wilson lower bound above the bar and enough test windows. Cited cards are the only ones the chair may reference.",
  },
  "ledger.walkforward": {
    title: "Walk-forward",
    body: "Patterns are found on a training range of windows and judged on the windows that came after — never on the same windows they were found on. A pattern that only looks good in-sample is kept as a candidate, not cited.",
  },
  "ledger.inverted": {
    title: "Inverted",
    body: "A pattern that reliably resolves AGAINST its members — when they agree on a side, it tends to land the other way. Rather than delete it, LEDGER flips it to shadow: the citation points to the opposite side, the same idea a seat's shadow read uses.",
  },
  "crew.sweep": {
    title: "SWEEP — the janitor",
    body: "Once a day, for every seat: how often it had a read, how often it was allowed to speak, its best confidence against the bar, and how right and how profitable its mid-window reads were at the ask. Flags: DEAD (no reads in a week), MUTE (reads but never heard), DEADLOCK (reads but never graded), ANTI (right 35% or less), GOLD (right 65%+ and paying).",
  },
  "crew.coach": {
    title: "COACH — the trainer",
    body: "Owns each seat's knobs: the speaking bar (52 plus an offset), an edge multiplier, and a bench. It judges a change on the week it did not tune on, moves the bar at most two points a week, benches anti-signals for a week, and reverts a move that proves worse. Every action is logged with its evidence. No human control writes these knobs.",
  },
  "crew.wrench": {
    title: "WRENCH — the mechanic",
    body: "A scheduled session that audits the ledger, the samples and SWEEP's flags for real bugs: caps that can never clear the bar, deadlocks, mis-scaled formulas, rules that never fire — and display truth, that every screen matches the record behind it (a booked call shows the side it was actually booked on, not a lean that has since decayed to WAIT, and never the window's result). It opens a pull request with the evidence and logs it here. It never merges and never touches knobs.",
  },
  "tab.settings": {
    title: "SETTINGS",
    body: "Mute seats, demo vs live, skill ledger, huddle. Demo never grades the live book.",
  },
  "tab.board": {
    title: "BOARD — ideas & feedback",
    body: "One live board for the group. Ideas on the left, open feedback on the right. Reply on an idea to talk about it. Paper only.",
  },

  "seat.WICK": {
    title: "WICK (PIN)",
    body: "Reads closed candles: hammers, engulfing, stars, AMD, sweeps. Waits for confirm. Bullish only at LOW, bearish only at HIGH.",
  },
  "seat.DRIFT": {
    title: "DRIFT (VEC)",
    body: "Direction of 5 / 15 / 30-minute returns. Aligned drift is a vote. Chop is a sit.",
  },
  "seat.STREAK": {
    title: "STREAK (RUN)",
    body: "Watches Kalshi’s official YES/NO results, not our spot vs strike. Live agreement is the YES book, not Bitcoin vs the strike. A hot streak can ride. A break ends it.",
  },
  "seat.EXHAUST": {
    title: "EXHAUST (XH)",
    body: "Looks for a move that has run too far in the last hour: climax volume, RSI divergence, failed push, an inside bar. Every pattern waits for a run past a tunable threshold (0.7% to start). Fade, don't chase.",
  },
  "seat.PULSE": {
    title: "PULSE (VOL)",
    body: "1-minute volume in USD notional (quote dollars, not coins). Expansion means the tape is awake. Dead volume means sit.",
  },
  "seat.TAPE": {
    title: "TAPE (FLW)",
    body: "Kalshi book imbalance — more size hitting YES vs NO. Follow persistent flow, fade a one-print spike.",
  },
  "seat.WHALE": {
    title: "WHALE (SZ)",
    body: "Unusually large spot prints. One print is noise. A cluster is a tell.",
  },
  "seat.VEL": {
    title: "VEL (LAG)",
    body: "Spot vs YES mid. If Bitcoin already moved and YES hasn't, the book may still be cheap.",
  },
  "seat.CARRY": {
    title: "CARRY (FR)",
    body: "Perp funding on an 8-hour footing (a 1-hour venue is scaled ×8 so it is comparable). APR is that 8-hour rate × 3 × 365, display only. Basis is perpetual minus spot in bps — a premium with positive funding is crowded longs. History is one print per venue period.",
  },
  "seat.CHAIN": {
    title: "CHAIN (OI)",
    body: "Open interest in both BTC and USD notional, over wall-clock minutes (3m / 10m / 1h). A dump has to show in coin and in dollars — price marking OI up is not new fuel. Timestamped 5-minute prints, not last-N polls.",
  },
  "seat.CASCADE": {
    title: "CASCADE (LQ)",
    body: "Each venue is converted with its contract type and multiplier first (OKX linear 0.01 BTC × 1, Binance/Bybit linear 1 × 1). Then USD notional in the same 15-minute window. Primary = richest book. Backup in the source line is confirmation, not extra dollars. Empty feeds fall back to a volume+OI PROXY.",
  },
  "seat.VOLT": {
    title: "VOLT (ATR)",
    body: "ATR% regime. High vol widens bars and makes single-candle patterns noisier.",
  },
  "seat.ODDS": {
    title: "ODDS (YES)",
    body: "YES path this window, graded on the ask you would actually pay — not the midpoint. A smooth grind is information. A 20¢ rip in 60s is often a fade.",
  },
  "seat.STRIKE": {
    title: "STRIKE (K)",
    body: "Spot vs the contract strike. Owns the clock: far from strike late is a stronger call.",
  },
  "seat.CHEAP": {
    title: "CHEAP (VAL)",
    body: "Retired to shadow. Its idea was a side under 42¢ on the ask; a side only gets that cheap when the price has run away from the strike, which is exactly when STRIKE owns the window, and its record was 0 for 8. Its reads are still graded; it never votes.",
  },
  "seat.FADE": {
    title: "FADE (RIP)",
    body: "60-second YES rip. Needs a real trade in the last 20s and a tight spread. A quote that vanishes is not a rip.",
  },
  "seat.ORBIT": {
    title: "ORBIT (REG)",
    body: "Names the regime: QUIET, CHOP, TREND, EXPAND. Weekend UTC is thinner. Never votes a side — it licenses the others (raise the bar in quiet/weekend, sit fade-traps on a trend-day).",
  },
  "seat.CLOCK": {
    title: "CLOCK (TOD)",
    body: "Hour/weekday Wilson prior from official settles, n ≥ 8. Soft only — cannot flip the chair alone. Last 4 minutes it sits; STRIKE owns the clock then. Also names the US-session window (NY morning, FOMC, London…) in Eastern time.",
  },
  "seat.INDEX": {
    title: "INDEX (BRTI)",
    body: "The lab's seat. Prices the window on the settlement rule itself, from Kalshi's own BRTI index: the average of the final minute's sixty prints against the strike, with the prints already locked counted as known. Votes the side whose ask sits under that fair value by more than the fee, and speaks loudest in the final minute. Started in shadow; graded like every seat.",
  },
  "seat.WIRE": {
    title: "WIRE (FNG)",
    body: "Fear & Greed is a daily index, not a 15-minute timer. WIRE tags a hot extreme (under 20 or over 80 with the 7-day path still going that way) for the record; it does not vote a side.",
  },
  "seat.WARDEN": {
    title: "WARDEN (GATE)",
    body: "Feed health plus whether the print makes sense. Down feeds, sequence gaps, zero strike, a crossed book, a missing 1-minute bar, a frozen spot, or frozen OI all silence the family that is garbage. Never votes a side. Basis WIDE is a warning, not a veto.",
  },

  "lean.UP": {
    title: "UP",
    body: "Buy YES at the ask, shown in cents. Not a percent. Paper lean that Bitcoin finishes this window above the strike.",
  },
  "lean.DOWN": {
    title: "DOWN",
    body: "Buy NO at the ask, shown in cents. Not a percent. Paper lean that Bitcoin finishes this window below the strike.",
  },
  "lean.WAIT": {
    title: "WAIT",
    body: "Not enough edge. Sit this window out. Waiting is a graded skill, not a shrug.",
  },

  "feed.LIVE": { title: "LIVE feed", body: "This data source is fresh." },
  "feed.STALE": { title: "STALE feed", body: "Data is old. Treat the seat as weaker until it catches up." },
  "feed.DOWN": { title: "DOWN feed", body: "No print. The bot is silent this window." },

  "status.LIVE": { title: "LIVE", body: "Seat is in the chair's vote." },
  "status.MUTED": { title: "MUTED", body: "You silenced this seat in SETTINGS. It still paper-trades, it does not vote." },
  "status.FADED": { title: "FADED", body: "Cold lately, so the chair listens to it less. Eight graded calls under about 38% right and a seat is discounted; very wrong and cold for a while and it is benched to no weight at all. It keeps its own side the whole time — being wrong does not make a seat right in reverse — and it is still graded, so it can earn its voice back." },
  "status.INVERT": { title: "INVERT", body: "Retired. The chair no longer flips a seat's side: a bad run makes a seat quieter, never opposite." },
  "status.FOLDED": { title: "FOLDED", body: "Learner parked this seat for poor EV. Watching, not voting." },
  "status.VETO": { title: "VETO", body: "Hard block — usually WARDEN or a failed gate. Desk sits." },
  "status.DOWN": { title: "DOWN", body: "Seat has no feed. Silent." },
  "status.UNCALIBRATED": {
    title: "UNCALIBRATED",
    body: "Fewer than 20 graded UP/DOWN calls — or sent back after a review. Speaks at 35%. Weight stays on the prior. WAIT does not count.",
  },
  "col.calib": {
    title: "Cal",
    body: "Graded directional calls toward 700. 20 takes the chip off. 700 is 100% listen. Every 500 calls after that, avg ¢ must hold 15 or they get sent back and swap the play. WAIT does not count.",
  },
  "field.calls": {
    title: "Calls",
    body: "Lifetime UP or DOWN prints from this bot. A flip counts as another call. WAIT does not. Lives on this machine.",
  },

  "skill.LIVE": { title: "LIVE skill", body: "Graded enough times. Allowed to vote for real." },
  "skill.SHADOW": {
    title: "SHADOW skill",
    body: "Paper-traded in the background — and can take the wheel when UCB says it is hotter than the LIVE play. That is how a new idea gets a real call.",
  },
  "skill.BENCH": { title: "BENCH skill", body: "Folded. The learner stopped using it until it earns a way back." },
  "skill.CANDIDATE": { title: "CANDIDATE skill", body: "A proposed new play. Accept to start it in SHADOW, or dismiss it." },
  "skill.SIT": { title: "SIT", body: "This seat has no fire this window. It votes WAIT." },

  "chip.CFM": {
    title: "CFM — confirmed",
    body: "The next candle closed in the pattern's favor. Actionable. Never act on a live, unclosed bar.",
  },
  "chip.PEND": {
    title: "PEND — waiting",
    body: "Pattern printed. The next candle has not closed. Do not act yet — it can vanish.",
  },
  "chip.CTX": {
    title: "CTX — wrong place",
    body: "Pattern printed in the wrong location (bullish mid-range, bearish at the lows). Printed, not tradeable.",
  },
  "chip.AMD": {
    title: "AMD",
    body: "Accumulation → manipulation (the wick) → distribution (the displacement). Self-confirmed on the displacement close.",
  },
  "chip.ALIGNED": { title: "ALIGNED", body: "5 / 15 / 30-minute returns point the same way." },
  "chip.ACCEL": { title: "ACCEL", body: "Short-term return is speeding up in the trend's direction." },
  "chip.DECAY": { title: "DECAY", body: "The move is slowing. Drift is tired." },
  "chip.PULLBACK": { title: "PULLBACK", body: "A dip against the 15-minute trend — possible continuation, not a flip." },
  "chip.STACK": { title: "STACK", body: "EMAs stacked with the trend." },
  "chip.CHOP": { title: "CHOP", body: "Returns disagree. Structure is ranging. Sit." },
  "chip.RUN": { title: "RUN", body: "A stretched move in one direction." },
  "chip.EXTREME": { title: "EXTREME", body: "Price is extended versus its recent range." },
  "chip.FLIP": { title: "FLIP", body: "Fast timeframe flipped against the hour." },
  "chip.CLIMAX": { title: "CLIMAX", body: "Volume spike at the end of a run — often exhaustion." },
  "chip.RSI DIV": { title: "RSI DIV", body: "Price made a new extreme; RSI did not. Classic exhaustion tell." },
  "chip.FAIL PUSH": { title: "FAIL PUSH", body: "Tried to break and got stuffed back. Failed auction." },
  "chip.EMA X": { title: "EMA X", body: "Fast EMA crossed against the run." },
  "chip.INSIDE": { title: "INSIDE", body: "Inside bar — range is contracting after the run." },

  "mark.PIN": { title: "PIN", body: "Long wick, small body. Rejection of that price. Needs location + confirm." },
  "mark.HAM": { title: "HAMMER", body: "Long lower wick, small body up top. Bullish only at a LOW." },
  "mark.HANG": { title: "HANGING MAN", body: "Looks like a hammer, at a HIGH. Bearish only after confirm." },
  "mark.INVH": { title: "INVERTED HAMMER", body: "Long upper wick at a LOW. Bullish only with confirm." },
  "mark.SHOOT": { title: "SHOOTING STAR", body: "Long upper wick at a HIGH. Bearish rejection." },
  "mark.DOJI": { title: "DOJI", body: "Open ≈ close. Indecision. Meaningless mid-range." },
  "mark.DRAG": { title: "DRAGONFLY", body: "Doji with a long lower wick. Bullish at a LOW." },
  "mark.GRAV": { title: "GRAVESTONE", body: "Doji with a long upper wick. Bearish at a HIGH." },
  "mark.LLDOJ": { title: "LONG-LEGGED DOJI", body: "Long wicks both sides. Volatility, not a direction." },
  "mark.MARU": { title: "MARUBOZU", body: "Almost no wicks. Strong conviction that way." },
  "mark.SPIN": { title: "SPINNING TOP", body: "Small body, wicks both sides. Pause, not a reversal by itself." },
  "mark.WAVE": { title: "HIGH WAVE", body: "Very long wicks. Uncertainty / stop hunt. Wait." },
  "mark.ENG UL": { title: "BULL ENGULF", body: "Green body swallows the prior red. Reversal at a LOW, after confirm." },
  "mark.ENG DN": { title: "BEAR ENGULF", body: "Red body swallows the prior green. Reversal at a HIGH, after confirm." },
  "mark.PIERCE": { title: "PIERCING LINE", body: "Green close back through the midpoint of the prior red. Bullish at a LOW." },
  "mark.DARK": { title: "DARK CLOUD", body: "Red close back through the midpoint of the prior green. Bearish at a HIGH." },
  "mark.TWZ HI": { title: "TWEEZER TOP", body: "Matching highs. Two-bar rejection of a HIGH." },
  "mark.TWZ LO": { title: "TWEEZER BOTTOM", body: "Matching lows. Two-bar rejection of a LOW." },
  "mark.HAR UL": { title: "BULL HARAMI", body: "Small green inside a prior red. Pause that can turn up at a LOW." },
  "mark.HAR DN": { title: "BEAR HARAMI", body: "Small red inside a prior green. Pause that can turn down at a HIGH." },
  "mark.MORN": { title: "MORNING STAR", body: "Three-bar bullish reversal. Self-confirmed on the third close." },
  "mark.EVEN": { title: "EVENING STAR", body: "Three-bar bearish reversal. Self-confirmed on the third close." },
  "mark.3SOL": { title: "THREE WHITE SOLDIERS", body: "Three advancing greens. Continuation — not a bottom call." },
  "mark.3CRW": { title: "THREE BLACK CROWS", body: "Three declining reds. Continuation — not a top call by itself." },
  "mark.SWP UL": { title: "SWEEP UP", body: "Took the highs (stops), closed back through. Bullish only if it reclaims." },
  "mark.SWP DN": { title: "SWEEP DOWN", body: "Took the lows (stops), closed back through. Bearish only if it rejects." },
  "mark.BOS UL": { title: "BOS UP", body: "Break of structure up — close through the last swing high." },
  "mark.BOS DN": { title: "BOS DOWN", body: "Break of structure down — close through the last swing low." },
  "mark.AMD": {
    title: "AMD",
    body: "ICT-style: accumulate, wick the other way (manipulation), then displace. Act on the displacement close.",
  },

  "strip.conf": {
    title: "conf — confidence",
    body: "How sure the chair is, 0–92. WAIT uses a lower gate number. Not a probability you can bet raw.",
  },
  "strip.size": {
    title: "size",
    body: "Paper size 1 / 2 / 3. Uncalibrated, taxed, or LAW-dimmed calls get smaller. Never a live order.",
  },
  "strip.score": {
    title: "score vs bar",
    body: "Chair score must clear the confluence bar to call UP or DOWN. Short of the bar → WAIT.",
  },
  "strip.clock": {
    title: "clock",
    body: "Time left in this 15-minute Kalshi window. FINAL changes who the chair listens to.",
  },
  "strip.phase": {
    title: "phase",
    body: "ENTRY ≈ first 5m, MID the middle, FINAL the last ~3m. Same pattern does not mean the same thing in FINAL.",
  },
  "strip.learn": {
    title: "learn phase",
    body: "EXPLORE tries more. CALIBRATE grades harder. EXPLOIT trusts the book. Huddle interval stretches with it.",
  },
  "strip.ev": {
    title: "desk EV",
    body: "SATOSHI’s rolling avg ¢ — last 20 closed scalps. Buy at the ask, sell at the next price or 100/0 at the window end. Not hit rate.",
  },
  "strip.huddle": {
    title: "huddle",
    body: "Recalibrate skills and seat weights from recent settles. Not a new vote — a bookkeeping pass.",
  },
  "strip.spot": {
    title: "BTC spot",
    body: "Cash Bitcoin (Binance/Coinbase). Perp is a different price — the subline is perp minus spot in bps. Kalshi 15m settles vs spot/index, not the perpetual.",
  },
  "strip.ticker": { title: "ticker", body: "This Kalshi 15-minute contract id." },
  "strip.strike": {
    title: "floor strike",
    body: "The Bitcoin price this window settles against. Close above = YES wins. Close below = NO wins. Paper grades wait for Kalshi’s official result, not this number.",
  },
  "strip.dist": {
    title: "dist to strike",
    body: "Spot minus strike. CLOCK and STRIKE live here. Far away late in the window is a stronger own.",
  },
  "strip.yes": { title: "YES bid / ask", body: "Price to sell / buy YES — that Bitcoin finishes above the strike." },
  "strip.no": { title: "NO bid / ask", body: "Price to sell / buy NO — that Bitcoin finishes below the strike." },
  "strip.leftover": {
    title: "leftover / comb / spr",
    body: "Leftover cents if you bought both sides · combined ask (YES+NO) · bid/ask spread. Fat spread eats edge.",
  },
  "strip.feeds": {
    title: "feeds",
    body: "SPOT (Binance/Coinbase cash), PERP (OKX/Binance perpetual), KALSHI (the book), DERIVS (funding/OI). Spot and perp are never mixed — basis is perp minus spot in bps. Kalshi 15m is vs spot/index, not the perp. Green live, amber stale, red down.",
  },
  "source.demo": {
    title: "DEMO",
    body: "Fake tape, fake $109k-era Bitcoin. Skills grade into the demo book only. Tap it to switch this PC to the live Kalshi/spot feed.",
  },
  "source.live": {
    title: "LIVE",
    body: "Real Coinbase/Binance spot, Kalshi 15-minute book, funding and liquidations. Paper still — no orders.",
  },

  "col.rank": {
    title: "Rank",
    body: "Who is pulling the chair hardest this window. W# is Wilson when it disagrees. Avg ¢ still moves how loud SATOSHI hears them.",
  },
  "col.scalp": {
    title: "Avg ¢",
    body: "Rolling average of cents between calls after the Kalshi taker fee. Bought UP at 55¢, sold at 70¢ is 15 minus two fees. Held to the end right at 70¢ is 30 minus the entry fee. Last 20 prints.",
  },
  "col.seat": { title: "Seat", body: "The specialist. Click the row to open its card." },
  "col.callsign": { title: "Callsign", body: "Short handle for the seat. Floor shorthand, not a second bot." },
  "col.lean": { title: "Lean", body: "This seat's paper call: UP, DOWN, or WAIT." },
  "col.conf": { title: "Conf", body: "This seat's confidence in its own lean. Under 52 it sits (WAIT) instead of printing UP/DOWN. WAIT is shown at 70+ because sitting is the call." },
  "col.skill": { title: "Skill used", body: "Which playbook line fired, or SIT if it has nothing." },
  "col.base": { title: "Base w", body: "Prior weight before the learner moves it. Frozen until n ≥ 8." },
  "col.listen": {
    title: "Listen",
    body: "How much SATOSHI is actually hearing this seat after health, fade, mute, and LAW.",
  },
  "col.health": { title: "Health", body: "Is this seat's feed live, stale, or down." },
  "col.signed": { title: "Signed", body: "Lean × confidence, signed + for UP and − for DOWN." },
  "col.contrib": { title: "Contribution", body: "How much this row moved the chair score this window." },
  "col.shadow": { title: "Shadow", body: "What a shadow skill would have said. Not in the live vote." },
  "col.why": { title: "Why", body: "One-line reason from the seat." },
  "col.status": { title: "Status", body: "LIVE, MUTED, FOLDED, UNCALIBRATED, and the rest. Hover the chip." },

  "field.avg ¢": {
    title: "avg ¢",
    body: "This seat’s rolling average of cents between calls. A factor in how loud SATOSHI hears them — not the rank itself.",
  },
  "field.phase": { title: "phase", body: "ENTRY / MID / FINAL of this 15-minute window." },
  "field.directional lean": {
    title: "Directional Lean",
    body: "A seat's own research read on one 0–100 scale: 0 strongly bearish, 50 neutral, 100 strongly bullish. It is not a probability and not a SATOSHI call. A read the Chair never heard still shows here as research context.",
  },
  "term.directional-lean": {
    title: "Directional Lean",
    body: "Directional Lean shows research direction and intensity. It is not a probability and not a SATOSHI call.",
  },
  "field.hypothesis": { title: "hypothesis", body: "What this seat (or the chair) believes will happen, in one line." },
  "field.evidence": { title: "evidence", body: "The facts it used. Not the conclusion — the inputs." },
  "field.counter": { title: "counter", body: "The best argument against this read. If you can't name one, the read is sloppy." },
  "field.decision": { title: "decision", body: "The actual call plus the one-line why." },
  "field.invalidate if": {
    title: "invalidate if",
    body: "What would kill this read. If that prints, the hypothesis is wrong — don't nurse it.",
  },
  "field.skill used": {
    title: "skill used",
    body: "Playbook id · status · n samples · hits · Wilson lower-bound hit rate.",
  },
  "field.thresh": {
    title: "thresh",
    body: "Live threshold this skill compared against. Adaptive — huddle retunes it.",
  },
  "field.shadow / paper": {
    title: "shadow / paper",
    body: "What shadow or paper skills would have said. Graded, not voted.",
  },
  "field.calc": { title: "calc", body: "The chair's arithmetic this window, in one string." },
  "field.skill / huddle": { title: "skill / huddle", body: "Last settle grade, and when the next huddle runs." },

  "pane.market": {
    title: "Market window",
    body: "Where you are in the Bitcoin day, in your timezone. 🥇 NY morning and macro prints (CPI/NFP/claims, FOMC) are the best vol. 🥈 lunch and the equity close. 🥉 London and Tokyo. 💤 late US, pre-London, and weekends. Weekend rule: the desk never pauses — every 15-minute window ticks, calls, and grades around the clock; the confluence bar rises +0.04 and thin books are tolerated in grading. 💤 is a quality label, not a schedule. ⏱ turn is the minute a 15-minute candle/Kalshi window opens or closes. Windows are defined in Eastern time so they stay put through daylight saving.",
  },
  "pane.board": {
    title: "Chair call",
    body: `The chair's read this window, at the ask in cents. UP 55¢ means YES was 55 cents. WAIT is not a fill, and neither is a read under the live ${LIVE} floor. Score must clear the bar.`,
  },
  "book.floor": {
    title: "80¢ floor (on trial)",
    body: `The chair's paper book only fills at ${LIVE} or better, a deliberate time-boxed trial of a higher floor reviewed after three to seven days or 25 fills at the new price. This is a price floor, not a confidence level: ${LIVE} is what the contract costs, not how sure the desk is. The read still shows and still grades every seat; under the floor nothing is booked and the ledger keeps the read with no entry. Why it moved: the old ${SHADOW} floor still let through the 70–79¢ shelf, which won about 65% of 29 calls against the 74% it needed, while ${LIVE} and up was the only part of the book in profit. The old floor keeps running beside it as a shadow book so the trial can be judged on the same windows, and reverting is one constant.`,
  },
  "pane.spot-chart": {
    title: "BTC 15m",
    body: "Last forty 1-minute candles of Bitcoin, strike marked gold. Same window the contract settles.",
  },
  "pane.yes-chart": {
    title: "YES path",
    body: "YES midpoint this window. The call log uses the ask you would actually pay, not this midpoint.",
  },
  "pane.call-log": {
    title: "Call log",
    body: `Each row is a paper buy at that side’s ask, one position per window, held to settlement: 100 if that side won, 0 if it lost, before fees. Fills only at the live ${LIVE} floor or better. Avg ¢ is the mean of those prints. WAIT does not buy.`,
  },
  "pane.score": {
    title: "Score math",
    body: "How SATOSHI turned 21 leans into one number. Score must clear the bar. Sit-mass, disagreement, and cousin windows raise it. Walk-forward is train vs later — if later is worse, the book is memorizing.",
  },
  "pane.gates": {
    title: "Gate checklist",
    body: "Hard gates can force WAIT (dead feed, leftover book, LAW lock). Soft gates only shade confidence.",
  },
  "pane.thinking": {
    title: "Chair thinking",
    body: "The chair in English: hypothesis, evidence, counter, invalidate. Same shape as every seat.",
  },

  "footer.quorum": {
    title: "Quorum",
    body: "Head-count of UP / DOWN / WAIT. Not weighted — just how split the floor is.",
  },
  "footer.law": {
    title: "Law",
    body: "Consecutive wrong chair calls. Enough in a row dims size, then can lock the desk for a cooldown.",
  },
  "footer.tape": {
    title: "Settle tape",
    body: "Official Kalshi YES/NO when it posts. PENDING = waiting on that result — bots are not taught from our spot vs strike.",
  },

  "set.wilson": {
    title: "Wilson",
    body: "Conservative hit rate. Punishes small samples so a 3-for-3 doesn't look like 100%.",
  },
  "set.ev": {
    title: "EV¢",
    body: "Average paper cents this pattern or skill earned per graded window. Negative = it's been paying the other side.",
  },
  "set.trust": {
    title: "trust",
    body: "Uncalibrated until enough samples. Folded if Wilson is poor or EV is deeply negative after n ≥ 12.",
  },
  "set.huddle": {
    title: "Run huddle now",
    body: "Rebuild live weights and retune thresholds from the current book, without waiting for the timer.",
  },
};

export function glossOf(key: string): Gloss | null {
  return GLOSS[key] ?? null;
}

export const TOUR_KEY = "satoshi-desk-tour-v1";

export type TourStep = {
  id: string;
  target: string;
  tab: TabId;
  title: string;
  body: string;
};

export const TOUR_STEPS: TourStep[] = [
  {
    id: "header",
    target: "tour-header",
    tab: "satoshi",
    title: "Paper desk, still learning",
    body: "Beta. SATOSHI and the seats are still learning this tape. Calls are practice, not trades, not advice. Hover or tap a dotted label anytime for a one-line definition.",
  },
  {
    id: "strip",
    target: "tour-satoshi",
    tab: "satoshi",
    title: "The chair's call",
    body: "UP / DOWN / WAIT is the paper decision. Conf is how sure. Size is how big a paper bet. The clock is time left in this window. Score must clear the bar or the desk sits.",
  },
  {
    id: "satoshi",
    target: "tour-chamber",
    tab: "satoshi",
    title: "Eighteen specialists vote",
    body: "Each cell is a voting seat: its vote in words, a pip in the vote's colour, and how sure. Hover or tap a seat to read its thesis; open the seat for its full record. Three more — WARDEN, ORBIT, WIRE — sit as non-voting pit crew.",
  },
  {
    id: "wick",
    target: "tour-wick",
    tab: "structure",
    title: "WICK reads the candles",
    body: "Patterns print on the chart. PEND = wait for the next close. CFM = confirmed. CTX = wrong place. Never act on a live, unclosed candle.",
  },
  {
    id: "settings",
    target: "tour-settings",
    tab: "settings",
    title: "Mute, demo, the ledger",
    body: "Demo and live keep separate skill books. Mute a noisy seat. Pattern ledger folds junk after enough samples. Replay this tour from the ? up top.",
  },
  {
    id: "footer",
    target: "tour-footer",
    tab: "satoshi",
    title: "Paper only",
    body: "Not financial advice. Not Kalshi. No real money. The settle tape is official Kalshi result — PENDING until they post it.",
  },
];

export function tourSeen(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(TOUR_KEY) === "done";
  } catch {
    return true;
  }
}

export function markTourSeen() {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(TOUR_KEY, "done");
  } catch {
    /* quota */
  }
}
