import type { TabId } from "./types";

export type Gloss = { title: string; body: string };

export const GLOSS: Record<string, Gloss> = {
  "beta.badge": {
    title: "Beta",
    body: "This desk is unfinished. The bots are still learning. Treat every call as practice.",
  },
  "beta.disclaimer": {
    title: "Paper only — not advice",
    body: "No live orders. SATOSHI and the 20 seats grade themselves after each 15-minute window. Friends can watch; nobody should size a real bet off this tape. Not financial advice. Use BOARD to post ideas and leave feedback.",
  },
  "beta.feedback": {
    title: "Board",
    body: "Shared ideas and feedback. Post an idea, reply on it, or leave tape notes. The call you were looking at rides along.",
  },
  "tab.satoshi": {
    title: "SATOSHI — the chair",
    body: "Weighs all 20 seats into one paper call: UP, DOWN, or WAIT. Same-evidence piles count as one voice. The board is the call. The charts are the eyes. The log is every directional fill vs 100¢ at the window end.",
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
    body: "ODDS, STRIKE, CHEAP, FADE. YES path, spot vs strike, cheap/rich bands, fast YES rips.",
  },
  "tab.context": {
    title: "CONTEXT — background",
    body: "ORBIT, CLOCK, WIRE, WARDEN. Regime, session clock, Fear & Greed, feed health.",
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
    body: "Looks for a move that has run too far: climax volume, RSI divergence, failed push. Fade, don't chase.",
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
    body: "42¢ bands on the *ask* — the price you can buy. Midpoint cheap is not a fill. Fat spread = hole, sit.",
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
  "seat.WIRE": {
    title: "WIRE (FNG)",
    body: "Fear & Greed is a daily index, not a 15-minute timer. Only a hot extreme (7-day path still going that way) gets a soft contrary, cap 55¢.",
  },
  "seat.WARDEN": {
    title: "WARDEN (GATE)",
    body: "Feed health plus whether the print makes sense. Down feeds, sequence gaps, zero strike, a crossed book, a missing 1-minute bar, or frozen OI all silence the family that is garbage. Never votes a side. Basis WIDE is a warning, not a veto.",
  },

  "lean.UP": {
    title: "UP",
    body: "Paper lean that Bitcoin finishes this 15-minute window above the strike.",
  },
  "lean.DOWN": {
    title: "DOWN",
    body: "Paper lean that Bitcoin finishes this 15-minute window below the strike.",
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
  "status.FADED": { title: "FADED", body: "Fade-family seat, discounted when the fade book is cold." },
  "status.INVERT": { title: "INVERT", body: "Wrong often enough that its lean is flipped for a stretch." },
  "status.FOLDED": { title: "FOLDED", body: "Learner parked this seat for poor EV. Watching, not voting." },
  "status.VETO": { title: "VETO", body: "Hard block — usually WARDEN or a failed gate. Desk sits." },
  "status.DOWN": { title: "DOWN", body: "Seat has no feed. Silent." },
  "status.UNCALIBRATED": {
    title: "UNCALIBRATED",
    body: "Too few graded samples. Can speak, but size is capped until the book fills in.",
  },

  "skill.LIVE": { title: "LIVE skill", body: "Graded enough times. Allowed to vote for real." },
  "skill.SHADOW": { title: "SHADOW skill", body: "Paper-traded in the background. Not yet trusted to vote." },
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
    body: "Synthetic window. Skills grade into the demo book only — they do not touch the live book.",
  },

  "col.rank": { title: "Rank", body: "Highest rolling avg ¢ first — cents captured between calls, last 20 prints. Not hit rate." },
  "col.scalp": {
    title: "Avg ¢",
    body: "Rolling average of cents made or lost between calls. Bought UP at 55¢, sold at 70¢ = +15. Held to the end right at 70¢ = +30. Wrong to 0 = −70. Last 20 prints.",
  },
  "col.seat": { title: "Seat", body: "The specialist. Click the row to open its card." },
  "col.callsign": { title: "Callsign", body: "Short handle for the seat. Floor shorthand, not a second bot." },
  "col.lean": { title: "Lean", body: "This seat's paper call: UP, DOWN, or WAIT." },
  "col.conf": { title: "Conf", body: "This seat's confidence in its own lean." },
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
    body: "This seat’s rolling average of cents between calls. Rank on SATOSHI follows this number, highest first.",
  },
  "field.phase": { title: "phase", body: "ENTRY / MID / FINAL of this 15-minute window." },
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
    body: "Where you are in the Bitcoin day, in your timezone. 🥇 NY morning and macro prints (CPI/NFP/claims, FOMC) are the best vol. 🥈 lunch and the equity close. 🥉 London and Tokyo. 💤 late US, pre-London, and weekends. ⏱ turn is the minute a 15-minute candle/Kalshi window opens or closes. Windows are defined in Eastern time so they stay put through daylight saving.",
  },
  "pane.board": {
    title: "Chair call",
    body: "The paper call this window. UP buys YES at the ask. DOWN buys NO at the ask. WAIT is not a fill. Score must clear the bar.",
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
    body: "Each UP/DOWN is a buy at that side’s ask. A flip sells the last buy at that side’s current cents, then buys the new side. Window end is 100 if that side won, 0 if it lost. Avg ¢ is mean of those prints. WAIT does not buy.",
  },
  "pane.score": {
    title: "Score math",
    body: "How SATOSHI turned 20 leans into one number. Score must clear the bar. Sit-mass and disagreement raise it.",
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
    target: "tour-strip",
    tab: "satoshi",
    title: "The chair's call",
    body: "UP / DOWN / WAIT is the paper decision. Conf is how sure. Size is how big a paper bet. The clock is time left in this window. Score must clear the bar or the desk sits.",
  },
  {
    id: "satoshi",
    target: "tour-satoshi",
    tab: "satoshi",
    title: "Twenty specialists vote",
    body: "Each row is a seat. Listen is how much SATOSHI is actually hearing them. Click a row to jump to that bot and read the why.",
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
