# Satoshi Desk — one prompt to paste

Open a **new** Grok Build project. Do not attach the old Council repo.

Copy everything between the markers. If Build truncates, send the rest as the next message starting at the cut.

======= START PROMPT =======

Build a new web app from scratch called Satoshi Desk.

Bitcoin-only 15-minute paper research desk. Do not port any old repo. Do not add Ethereum, Vitalik, a second table, membership, billing, campus, academy, follower routing, proof ledgers, summon videos, 3D round-table art, portraits-as-product, or looks-first chrome.

Priority: functionality → accuracy → readability. Dark, dense, readable trading UI. Paper only. No live orders. A clean WAIT is a successful call. Never invent a number a feed did not print. If a feed is stale or down, stamp STALE or DOWN and force WAIT or cap confidence. Do not draw guessed candles or a fake book.

WHAT THE APP IS
Every 2 seconds the desk takes ONE shared market snapshot. Each specialist bot reads only its own fields and returns a lean. SATOSHI synthesizes those votes into one call: UP / DOWN / WAIT.

Two layers must be visible at all times:
1. EYES — the exact chart, pattern, or report that bot is looking at, live.
2. MIND — what that bot is considering, including the fact that would change its mind.

Each bot is a roster of named Skill Cards (not a personality). Skills start as SHADOW (visible, weight 0), graduate to LIVE, and get BENCHED when they decay. SATOSHI’s tab is the synthesis: every bot’s lean, confidence, weight, signed contribution, shadow lean, the running score, the gate checklist, calibration tax, and the Chair’s thinking.

TABS (only these)
SATOSHI | STRUCTURE | TAPE | DERIVS | BOOK | CONTEXT | SETTINGS
No other tabs.

════════════════════════════════════
TAB SATOSHI (home)
════════════════════════════════════
Top strip, always live:
- BTC spot (source + age in seconds)
- Kalshi ticker (KXBTC15M-…)
- Floor strike
- Distance to strike in $ and %
- YES bid / YES ask / NO bid / NO ask in cents
- Leftover cents = 100 − YES ask − NO ask
- Combined ask and spread
- Minutes + seconds left in the 15m window
- Phase: ENTRY (>12m left) · MID (4–12m) · FINAL (<4m)
- Feed health: SPOT / KALSHI / DERIVS each LIVE / STALE / DOWN
- Current SATOSHI call: UP / DOWN / WAIT + confidence + |score| vs confluence bar
- Learning phase: EXPLORE / CALIBRATE / EXPLOIT + graded-window count
- DEMO amber badge when demo mode is on

Main table, one row per live seat:

Rank | Seat | Callsign | Lean | Conf | Skill used | Base w | Listen | Health | Signed | Contribution | Shadow lean | Why (one line) | Status

Seat status = LIVE / MUTED / FADED / INVERT / FOLDED / VETO / DOWN / UNCALIBRATED.
Skill status = CANDIDATE / SHADOW / LIVE / BENCH.
WAIT and SIT are current-window reads, not status levels.
Shadow lean = what the seat’s SHADOW skill would have said (weight 0). Blank if none.
Skill used = the LIVE skill id that fired, or SIT.
Signed = +conf_w if UP, −conf_w if DOWN, 0 if WAIT.
Contribution = signed × effective_weight, bar left=DOWN right=UP.
Sort by |contribution| descending. Muted / veto / uncalibrated rows pin at the bottom.
Clicking a row jumps to that bot’s card.

Three panes under the table:

1. SCORE MATH (live, numbers visible, not a black box)
   score = Σ(signed × w) / Σw
   Show confluence bar (adaptive, default 0.30, floor 0.24, ceiling 0.72)
   Show fade-family fold, invert cap, diversity bonus, aggressiveness scalar
   Show calibration tax: if conf-bin 70–80 has hit < 55% on n≥12, cap Chair conf at the bin’s actual hit rate until it rebuilds. Print the tax.
   Full-call conf = min(92, round(50 + |score| × 55)), then apply tax.
   WAIT conf = 70–92 based on how clearly gates failed.

2. GATE CHECKLIST — PASS / FAIL with the triggering number
   - WARDEN: both spot and Kalshi healthy
   - LAW: not in lockdown
   - Book not chalk (YES or NO ≥ 99¢)
   - Leftover > 0
   - Quote age ≤ 25s
   - Not hard-early (mins_left ≥ 12) unless already in
   - Not hard-late (mins_left ≤ 2.2) unless already in
   - Spread ≤ 6¢
   - Quiet-vol floor not blocking (ATR% ≥ 0.12 or vol percentile ≥ 25)
   - Top-3 ranks not in hard conflict
   - |score| × aggressiveness ≥ confluence bar
   Any hard FAIL → WAIT. Soft fails dampen aggressiveness only.

3. CHAIR THINKING — six fields plus two extras
   PHASE
   HYPOTHESIS — one sentence synthesis of ranked seats
   EVIDENCE — top 3 signed contributions with their numbers
   COUNTER — loudest dissenting seat + any failed gate
   DECISION — lean + |score| vs bar + one-line why
   INVALIDATE IF — the named gate or print that would force WAIT or flip
   CALC — plain-text arithmetic: "DRIFT +0.12, TAPE +0.08, FADE −0.04, faded pile capped → score +0.41 vs bar 0.36 → UP"
   SKILL / HUDDLE — last settle line and last huddle action: "WICK.pin +1 · FADE.60s −1 · bar 0.36→0.37" / "proposed TAPE.roc SHADOW"

Footer: QUORUM (UP / DOWN / WAIT counts) and LAW (consecutive wrongs, lock on/off, seconds left). These two are meta — no bot pages.

After each demo/live window settles, write one SETTLE TAPE line on this tab: finish UP/DOWN, each directional seat graded hit/miss, weights nudged, WAIT seats graded good-sit / missed-edge.

════════════════════════════════════
BOT TABS (2–4 bots per page)
════════════════════════════════════
Each bot is a two-column card. Cards on one tab share one snapshot timestamp.

LEFT — EYES
The exact live chart / pattern overlay / report that seat reads. NOT a generic BTC chart on every card.
Annotate the firing skill on the graphic (the pin bar, the 60s rip, the strike line).
Feature table under the graphic: every number the formula uses, ticking, units + age.
Feed badge LIVE / STALE / DOWN + age in seconds.
If DOWN: empty-state "NO PRINT — bot is silent". No guessed series.

RIGHT — MIND (exactly these fields, live, no extra prose)
PHASE: entry | mid | final + minutes left
HYPOTHESIS: one sentence about THIS 15m window
EVIDENCE: 2–4 bullets of numbers from its feature dict
COUNTER: strongest fact against the hypothesis, or "none printed"
DECISION: UP | DOWN | WAIT · confidence N · one-line why
INVALIDATE IF: the single next print that would flip or silence this seat
SKILL USED: id · status LIVE/SHADOW · this-regime n/hits · Wilson %
SHADOW: "shadow <id> would have said DOWN 61" or "none"

If the feed is STALE/DOWN: EVIDENCE says STALE/DOWN and DECISION is WAIT or confidence-capped.

STRUCTURE tab
1. WICK (candle_btc) — 1m/5m pattern specialist
2. DRIFT (momentum) — 5m/15m/30m trend alignment
3. STREAK — settled-window run continue/fade
4. EXHAUST — fade a 1h run after a 5m flip

TAPE tab
5. PULSE (volume) — spike / dry-up vs price
6. TAPE (orderflow) — Kalshi book imbalance + ROC
7. WHALE — large prints / buy-sell ratio
8. VEL (spotlag) — spot lead vs Kalshi lag

DERIVS tab
9. CARRY (funding) — funding persist + OI path
10. CHAIN (oi_pressure) — OI trajectory + crowding
11. CASCADE (liq) — forced-flow clusters
12. VOLT (volatility) — ATR / realized vol regime

BOOK tab
13. ODDS — YES¢ path vs entry / skew
14. STRIKE — spot vs Kalshi floor strike + time left
15. CHEAP — extreme cheap contract, muted on trend days
16. FADE (panic) — fade a Kalshi mid rip

CONTEXT tab
17. ORBIT (regime) — aggressiveness / quiet / trend-day gate
18. CLOCK (session_tod) — UTC session prior + 15m clock
19. WIRE (news) — Fear & Greed extremes only
20. WARDEN (guardian) — feed health, force WAIT

Meta on Satoshi tab only: QUORUM, LAW.

════════════════════════════════════
SKILL ENGINE (required in v1)
════════════════════════════════════
A Skill Card is a named rule with: id, owner seat, question, eyes fields, fire-when, vote, conf formula, invalidate-if, regime license, status, n, hits, Wilson, Brier.

Statuses: SHADOW (log only, weight 0) → LIVE (full listen) → BENCH (decayed, history kept).
CANDIDATE cards sit in Settings until Zach Accepts them to SHADOW.

Promotion to LIVE, all must pass, walk-forward only:
- n ≥ 24 directional samples in THAT regime
- Wilson lower-bound hit% ≥ 55% and ≥ parent seat
- Brier ≤ parent seat
- Chair ECE not worse
- beats the current LIVE skill on the last 40 windows
Demote to BENCH: L20 < 42% or 8-wrong streak.
Cap per seat: 3 LIVE + 2 SHADOW. Extra candidates queue in Settings, they do not vote.
Do not reweight a skill with n < 8. Mark UNCALIBRATED.
Learn on settle only, never every tick. Credit 0 when chalk, leftover ≤ 0, or both feeds down.
WAIT is graded: good-sit if the skipped side would have lost; missed-edge if the skipped side would have won. ORBIT / VOLT / WARDEN earn credit on good sits.

Regime license: a skill is licensed per session×phase pocket (example US_AM + expansion). Winning in US_AM does not unlock ASIA quiet. Listen gate is hard: junk in a pocket stays muted there.

Seed these LIVE-eligible skills on first run (start all as SHADOW except the first listed per seat, which starts LIVE so the desk has a voice):

WICK.pin_at_high — location HIGH AND upper_wick/range ≥ 0.55 AND bar closed → fade the push
WICK.engulf_at_extreme — two-bar engulf at HIGH or LOW → with the engulf
WICK.doji_after_run — doji after |ret15| ≥ 0.25% → WAIT
DRIFT.aligned_3h — ret5, ret15, ret30 same sign AND |ret15| ≥ 0.25% → that side
STREAK.continue_young — streak_n ≤ 3 AND live path agrees → continue
STREAK.fade_extended — streak_n ≥ 5 → fade
EXHAUST.1h_run_5m_flip — |1h ret| ≥ 1% AND price in top/bottom 20% of 1h range AND 5m flipped → fade the 1h side
PULSE.vol_agree — vol > 2.2× median AND price same direction → that side
PULSE.dryup_sit — vol < 0.45× median after a push → WAIT
TAPE.persist_imbalance — imbalance same sign ≥ 4 snapshots → that side
VEL.spot_lead — |spot lead bps| meaningful for session AND YES mid has not followed → lean with spot
CARRY.persist_fade — |funding| extreme for ≥ 3 prints AND OI rising → fade funding side
CHAIN.oi_with_price — OI building with price → continuation
CASCADE.proxy_flush — vol spike + sharp return + OI flush → lean with squeeze, cap conf 58, label PROXY
VOLT.dead_sit — ATR% < 0.12 or vol percentile < 25 → WAIT and raise council bar
ODDS.cheap_yes — YES ≤ 42¢ AND path not still crashing AND not ORBIT trend-day → UP
STRIKE.itm_time — |dist| large vs mins_left → lean in-the-money side
STRIKE.magnet_sit — |dist| < 0.5 ATR AND mins_left < 2.2 → WAIT
CHEAP.value — ≤ 42¢ side AND not trend-day → that side
FADE.60s_rip — YES mid rip ≥ 8–12¢ in 60s AND not ORBIT trend-day → fade the rip
ORBIT.quiet_raise_bar — quiet regime → do not vote a side; raise confluence bar
CLOCK.session_prior — soft prior only; UNCALIBRATED and WAIT until that hour/weekday has n ≥ 8
WIRE.extreme_fng — Fear & Greed ≤ 20 or ≥ 80 → soft contrary prior, cap conf 55
WARDEN.both_down — spot AND Kalshi down → Chair veto WAIT 92 (never a side)

Huddle (03:00–03:15 America/Chicago, also runnable from Settings as “Run huddle now”):
1. Rebuild weights from graded history
2. Recalibrate phase explore → calibrate → exploit (n < 15 explore / < 80 calibrate / else exploit)
3. Apply calibration tax per conf bin
4. Promote / bench skills that hit the gates
5. Residual miner may emit at most ONE CANDIDATE skill card per night: the unused EYES feature most associated with Chair misses over the last 40 windows. Write the trigger in the same language as EYES. Put it in Settings for Accept / Dismiss. Never auto-LIVE.
6. Print one huddle line on Satoshi.

Do not use an LLM to vote. An LLM may draft the MIND sentence FROM the feature dict AFTER the numeric vote. An LLM may draft a CANDIDATE card FROM residuals. The card still has to print numbers and climb the ladder.

════════════════════════════════════
SHARED SNAPSHOT (one object, every cycle)
════════════════════════════════════
{
  as_of, phase, mins_left, close_time, ticker,
  spot, spot_source, spot_age_s,
  candles_1m[], candles_5m[], candles_15m[], candles_1h[],
  strike,
  yes_bid, yes_ask, no_bid, no_ask,
  leftover_cents, combined_ask_cents, spread_cents, quote_age_s,
  funding_rate, funding_history[],
  open_interest, oi_history[], oi_delta_3m, oi_delta_10m, oi_delta_1h,
  liq_long_usd, liq_short_usd, force_n,
  fear_greed, fear_greed_label,
  health: { spot_ok, kalshi_ok, derivs_ok, derivs_source },
  window_memory: { prior_settles[], path_since_entry, streak_n, streak_side },
  regime_key   // session × phase, e.g. US_AM_MID
}

Bots do not fetch. Shared candle math (ret5/15/30, ATR%, vol percentile, location HIGH/LOW/MID) is computed once per cycle and reused.

LIVE FEEDS (public, fail-soft)
- Spot + klines: https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=90
  Fallback: https://api.binance.us/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=90
  Fallback last only: https://api.coinbase.com/v2/prices/BTC-USD/spot
- 5m / 15m / 1h klines from the same Binance vision host
- Kalshi 15m BTC: https://api.elections.kalshi.com/trade-api/v2/markets?status=open&series_ticker=KXBTC15M&limit=1
  then that market’s orderbook. CORS may fail — proxy through the app server or mark KALSHI DOWN. Never fake a book.
- Funding + OI: https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP
  and https://www.okx.com/api/v5/public/open-interest?instId=BTC-USDT-SWAP
  Do not call fapi.binance.com from a US host (HTTP 451).
- Sentiment: https://api.alternative.me/fng/?limit=1
- Liquidations: if no force-liq feed, CASCADE uses PROXY (vol spike + return + OI flush) and must label PROXY.

LIVE = age ≤ 8s spot, ≤ 25s Kalshi, ≤ 60s derivs
STALE = older, last-good shown with age
DOWN = no last-good this session

DEMO MODE is required and is the default.
Demo generates a coherent 15-minute window: strike near spot, 1m candles that walk, a YES/NO book that is sometimes leftover-positive and sometimes chalk, slow funding/OI/F&G, a countdown that settles at 0:00 then opens the next window and chips the finish into STREAK + the learner.
Demo numbers pass through the SAME bot formulas, Chair math, and skill grader as Live.
Label the top strip DEMO in amber.
Demo and Live are SPLIT: they do not share Wilson / Brier / EV / seat weights. Demo may reuse the same bot formulas and UI, but demo ticks must not write into the live learner store. Demo is a drill environment on its own state.

════════════════════════════════════
BOT FORMULAS (implement these; do not improvise AI vibes)
════════════════════════════════════
Each bot returns { lean, confidence, features, reasoning, skill_used, shadow }.
Lean WAIT unless the setup is real. Quiet data → WAIT.

Confidence for directional seats:
raw = clamp(edge_strength, 0, 1)
conf = round(100 * raw^1.15 * phase_mult * health_mult)
phase_mult ENTRY 0.85 / MID 1.00 / FINAL 1.10
health_mult fresh 1.0 / stale 0.6 / down 0.0 → WAIT
cap 40 on an unclosed 1m bar; cap 25 if mid-range / no location edge

WICK EYES: 1m (and 5m) candlesticks, last 60 bars. Mark pin / engulf / marubozu / doji / star.
Location HIGH / LOW / MID. MID = pattern votes OFF.
Pin / wick reject ≥ 55% of range against the move → fade.
Bullish engulf / marubozu + ret5 > +0.08% → UP.
Doji after a run → WAIT.
Quiet body (< 35% of range) → WAIT.
Invalidate-if: opposite engulf, or ret15 flips sign.

DRIFT EYES: three return bars 5m / 15m / 30m + close sparkline.
ENTRY: all three aligned and |ret15| ≥ 0.25% → that side, else WAIT.
MID/FINAL: path since entry flipped against entry lean → revise or WAIT.
Invalidate-if: any horizon flips sign.

STREAK EYES: last 8 settled window outcomes as UP/DOWN chips.
Continue when streak_n ≤ 3 and live path agrees. Fade when streak_n ≥ 5. Else WAIT.
Invalidate-if: live path breaks the streak side.

EXHAUST EYES: 1h candle + last six 5m candles.
Fade the 1h side only when |1h ret| ≥ 1% AND price in top/bottom 20% of 1h range AND 5m flipped against it.
Invalidate-if: 5m resumes the 1h direction.

PULSE EYES: volume histogram under 1m close, last 30.
Spike > 2.2× median. Dry-up < 0.45× median.
Vol-up + price-up → UP. Vol-up + price-down → DOWN. Dry-up after a push → WAIT.
Vol percentile < 25 → WAIT.
Invalidate-if: next bar is an opposite spike.

TAPE EYES: Kalshi YES vs NO depth (top 5) + imbalance sparkline.
imbalance = (yes_bid_size − no_bid_size) / (yes_bid_size + no_bid_size)
Persistent same sign ≥ 4 snapshots → that side. No book → DOWN badge, WAIT.
Invalidate-if: imbalance sign flips and holds 2 snapshots.

WHALE EYES: large-print tape, or PROXY = 1m volume × close USD flagged > 2.5× median. Label PROXY if so.
Buy-heavy → UP. Sell-heavy → DOWN. None this window → WAIT.
Invalidate-if: opposite large-print cluster.

VEL EYES: two panes — spot last 10 min, and YES mid cents vs 50.
Lead = spot return bps over 30–90s minus YES mid change.
Only call when |lead| is meaningful for the session (wider in Asia, tighter in US).
No Kalshi print → WAIT.
Invalidate-if: lag closes or spot reverses.

CARRY EYES: funding line last 12 prints + OI line.
Extreme persist ≥ 3 prints + rising OI → fade funding side.
Falling OI + extreme funding → WAIT. Mild funding → WAIT.
Invalidate-if: funding normalizes while OI still rising.

CHAIN EYES: OI line + price line, last 2 hours.
OI building with price → continuation. OI flushing with price spike → WAIT or fade.
Invalidate-if: OI delta sign flips.

CASCADE EYES: long-liq vs short-liq bars, or PROXY vol-spike + return + OI flush.
Proxy cap conf 58 and say PROXY. No cascade → WAIT.
Invalidate-if: OI stops flushing and vol collapses.

VOLT EYES: ATR% vs its 20-window median + compression/expansion tag.
Dead vol → WAIT and raise the council quiet floor.
Compression → expansion → allow directional, lean with the break.
Invalidate-if: vol collapses back under the median.

ODDS EYES: YES mid cents path since window open, 50¢ midline.
Cheap YES ≤ 42¢ and path not crashing → UP.
Rich YES ≥ 58¢ and path not ripping → DOWN.
ORBIT trend-day can override value.
Invalidate-if: YES mid crosses back through 50 against the lean.

STRIKE EYES: spot vs horizontal strike line, last 15–30 min, time-to-go chip.
YES pays if BTC finishes above strike.
ENTRY: |dist| large vs time → lean ITM side.
FINAL: |dist| < 0.5 ATR and < 2.2m left → WAIT.
Invalidate-if: spot prints back through strike, or magnet-sit fires.

CHEAP EYES: YES¢ and NO¢ vs 42¢ / 58¢ bands.
Only lean into ≤ 42¢ when ORBIT is not a trend day. Trend-day cheap = value trap → WAIT.
Invalidate-if: ORBIT tags trend-day or mid goes another 8¢ against.

FADE EYES: YES mid line with 30s / 60s / 120s change callouts.
Rip ≥ 8–12¢ in 60s → take the OTHER side. Not on ORBIT trend-day.
If the rip continues after entry, revise.
Invalidate-if: mid makes a new extreme in the rip direction.

ORBIT EYES: regime dashboard, not a price chart.
Tiles: session pocket, ATR percentile, vol percentile, streak tag, aggressiveness 0–1.
Usually votes WAIT. Sets the council aggressiveness scalar.
Quiet → raise confluence bar. Expansion → lower it slightly.
Invalidate-if: ATR percentile crosses the quiet/expansion line.

CLOCK EYES: 15m countdown + session chip ASIA / EUROPE / US + weekday.
Soft prior only. Do not flip a mid-window call on session alone.
No history → UNCALIBRATED, WAIT.
Invalidate-if: nothing mid-window; CLOCK does not flip alone.

WIRE EYES: Fear & Greed number + 7-day sparkline.
Lean only at ≤ 20 or ≥ 80. Otherwise WAIT. Cap conf 55. Path must confirm.
Invalidate-if: index leaves the extreme band.

WARDEN EYES: health table of every feed with age.
Never votes a side. Both down → Chair veto WAIT 92. One down → cap directional conf at 62.
Invalidate-if: both feeds print fresh.

QUORUM (Satoshi tab only): count non-muted, non-WARDEN, non-LAW leans. Majority line.
LAW (Satoshi tab only): consecutive wrong Chair directional calls (WAIT is not a miss). After 2 wrongs → lockdown 1 window (~8 min): no live UP/DOWN, shadow still computes.

════════════════════════════════════
CHAIR MATH (implement exactly, show every term)
════════════════════════════════════
Base weights (normalize to 1 after mutes). WARDEN, LAW, QUORUM do not enter Σw.

WICK 0.10  PULSE 0.07  DRIFT 0.07  TAPE 0.06  CARRY 0.06
ORBIT 0.05  VOLT 0.07  CHAIN 0.06  STREAK 0.06  ODDS 0.09
STRIKE 0.11  CLOCK 0.07  WHALE 0.08  FADE 0.12
CHEAP 0.10  VEL 0.10  EXHAUST 0.09

listen(rank) = max(0.12, 0.82^(rank-1))
If a seat’s directional Wilson < 42% with n ≥ 8, multiply listen by 0.35.
If UNCALIBRATED (n < 8), listen = 0 and status UNCALIBRATED.

Per seat:
conf_w = (confidence / 100) ^ 1.4
signed = +conf_w if UP, −conf_w if DOWN, 0 if WAIT
w = base_weight × listen(rank) × health × regime_license
health 0–1 from WARDEN. regime_license 0 if the firing skill is not licensed in this pocket, else 1.

If faded/invert: flip signed and scale w by (0.55 + 0.45 × fade_strength).
If invert weights exceed 18% of Σw, scale them down to 18%.

Fade-family fold: FADE + EXHAUST + CHEAP + WIRE leaning the SAME side count as ONE fact. Scale that pile so combined weight equals the loudest single seat in the pile. Mark those rows FOLDED.

score = Σ(signed × w) / Σw     // −1 .. +1
If ≥ 3 categories agree, score × 1.12. If 2 categories, score × 1.06.

Time aggressiveness:
mins_left ≥ 12 → × 0.55
10–12 → × 0.78
4–10 → × 1.15
2.2–4 → × 0.72
≤ 2.2 → × 0.55
Spread > 6¢ → × 0.85
Quiet vol → raise confluence bar rather than force a side.

Hard WAIT if any of:
- WARDEN veto (both feeds down)
- LAW lockdown
- chalk book
- leftover ≤ 0
- quote age > 25s on an ENTRY attempt
- |score| × aggressiveness < confluence bar
- top-3 ranks in hard conflict (two of top 3 on opposite sides at conf ≥ 60)

Otherwise lean = UP if score > 0 else DOWN.
FULL call only if |score| ≥ bar AND top-3 not in conflict. Else WAIT.
Chair does not invent conviction. Split table or failed gate → WAIT.

After settle:
- Grade every directional LIVE skill hit/miss against finish UP/DOWN
- Grade WAIT skills good-sit / missed-edge
- Nudge that skill’s n, hits, Wilson, Brier
- Nudge seat listen / fade
- Write the settle tape line
- Apply calibration tax to conf bins
Do not learn from chalk, leftover ≤ 0, or dual-feed-down windows.

════════════════════════════════════
SETTINGS
════════════════════════════════════
- Poll interval: 1000 / 2000 / 3500 ms
- Data source: Demo / Live
- Confluence bar override 0.24–0.72 + “use adaptive”
- Mute seats (checklist)
- Show faded math on / off
- Show shadow column on / off
- Timezone display: America/Chicago
- Beast interval (1500 ms) — faster poll only
- Reset demo window
- Run huddle now
- Skill library: list every card with status, n, Wilson, regime license, Accept / Dismiss / Force-BENCH
- Cap counters visible: LIVE x/3 · SHADOW x/2 per seat
- No live-trading arm. No skin packs. No summon. No password wall.

Persist settings + learner + skill stats + window memory in localStorage.

════════════════════════════════════
UI RULES
════════════════════════════════════
Dark background, high-contrast numbers, monospace for prices / cents / timers.
Tables and charts first. No fog, no 3D table, no portraits, no video.
One type system. Amber = DEMO / WAIT / SHADOW. Green = UP. Red = DOWN.
Mobile: Satoshi table scrolls horizontally; bot cards stack EYES then MIND.
Every number has a unit and a source. Example: 108442.3 spot binance_vision 1.2s
Do not claim accuracy, edge, or dollar P&L. No dollar leaderboard.
Legal line always visible: Paper research desk. Not financial advice. Not Kalshi. No real money.

STACK
Use Grok Build’s default (React + a thin server is fine). Analysis in a worker so the UI never freezes.

MUST WORK
1. First load opens in Demo, a window is already ticking, bots vote, Satoshi table fills, math adds up, each MIND shows SKILL USED.
2. Switching to Live uses the public endpoints. Failed CORS / 451 / timeout → that feed DOWN, not a spinner forever, not invented candles.
3. Settings.mute immediately removes that seat from Σw.
4. Clicking a Satoshi row jumps to that bot card.
5. Demo window end settles, grades skills, chips STREAK memory, opens the next 15m window, writes the settle tape line.
6. A SHADOW skill is visible and does not change the score. Accepting a CANDIDATE in Settings makes it SHADOW. No skill auto-promotes to LIVE without passing the numeric gates.
7. If every bot card draws the same candlestick, that is a fail — fix EYES to the series named for that seat.

DONE WHEN
- Satoshi tab shows lean, confidence, skill used, weight, signed contribution, shadow lean, visible score arithmetic, gate checklist, calibration tax, settle tape.
- Each bot page shows that seat’s real EYES series plus the MIND fields including SKILL USED and SHADOW.
- Dead feeds show DOWN and the bot goes silent / WAIT.
- Demo runs with zero keys and the learner persists across windows.
- No ETH, no Vitalik, no membership, no campus, no follower, no summon, no 3D table.

Build that. Functionality and accuracy first.

======= END PROMPT =======
