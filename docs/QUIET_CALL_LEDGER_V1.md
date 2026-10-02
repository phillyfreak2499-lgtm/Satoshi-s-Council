# QUIET_CALL_LEDGER_V1 — implementation spec (rev 3, APPROVED) + build errata

Status: **APPROVED TO BUILD by owner, 2026-10-01**, with VOLT and PULSE as judged seats and ORBIT as the sole control. **Built** on branch `research/quiet-call-ledger-v1` (draft PR, not merged, not deployed). This file is the pre-registration record; the build errata below take precedence where they differ from the body.

## Build errata and pre-build rulings (2026-10-01)

**ER-1 — seat count (found during build; code is the source of truth).** `SEAT_IDS` holds **21 ids including WARDEN**, so "every seat except WARDEN" is **20 ledger seats: 19 judged + ORBIT control**, not 21 / 20 as written in the body. The design intent is unchanged; only the arithmetic moves. The code derives the lists from `SEAT_IDS` rather than hard-coding them. Corrected numbers: a capture holds **20 calls**; K1/K2 Holm over **19 tests** (strictest z = **3.01**); χ² homogeneity **df = 18, critical value 28.87**; K1 at n = 500 detects |hit − 0.5| ≳ **6.7 pp**; bottom quartile uses k ≤ 19. Every "21", "20 judged", "z = 3.02" and "df = 19" in the body should be read with this correction.

**Owner rulings on the four pre-build conflicts (2026-10-01):**

1. **WIRE** stays judged; TILT = `readWire(snap).lean` (fades F&G extremes: ≥ 80 still rising → DOWN, ≤ 20 still falling → UP); otherwise NONE. ORBIT remains the sole control.
2. **ODDS / CHEAP** TILT leans to the cheaper side: YES ask < 50¢ → UP, > 50¢ → DOWN, exactly 50¢ (or no quote) → NONE.
3. **CASCADE** TILT = `readCascade(snap).lean` (the 5m move on a squeeze, liquidation cluster, or volume spike without OI).
4. **Tests live in `scripts/`** (`scripts/quiet-call.test.mjs`, `scripts/quiet-call-integration.test.mjs`) using the repo's Vite-loading pattern, because the strip-types runner cannot load `learner.ts` / `server-engine.ts`. `npm test` already globs `scripts/**/*.test.mjs`, so **`package.json` is not changed**. §11 content is unchanged.

**ER-2 — write ordering (found during build).** Capture and grade DB writes are fire-and-forget; an early integration run showed a grade update could overtake its own capture insert and leave rows PENDING. Fix: all quiet writes run on one serial chain, and the grade write is an **upsert of the full call row** (`on conflict … do update … where grade_status = 'PENDING'`), so it is correct even if the capture insert was lost. A settled row is never rewritten. Pinned by test #47a.

**ER-3 — two existing rails touched (found during build; not in the spec's file list).** (a) `scripts/discord-posts.test.mjs` pins a SHA-256 of the whole `server-engine.ts` minus the two Discord hooks. Instead of re-pinning, the rail now also strips each enumerated quiet hunk by exact match (a count mismatch throws) and asserts the remainder still hashes to the **original, unchanged** constant — i.e. the engine is byte-identical to `main` outside the quiet taps. (b) `scripts/active-window-recovery.test.mjs` runs the real `freshEng`/`loadState`/`persistState` in a VM sandbox with hand-supplied dependencies; it gains three stubs (`freshQuietBook`, `sanitizeQuietBook`, `sanitizeQuietCaptures`) in the same style as its existing `sanitize*` stubs. Real quiet persistence is covered by integration tests #39–#40.

Base read: `main` @ `2ec8b38` (Merge PR #400), read 2026-10-01.
Authority: NONE. Paper-only, research-only, hidden from every public surface. No vote, weight, gate, threshold, floor, status, or Chair input changes.

---

## 0. Bottom line

The design builds as specified, with the deviations the code forces (all listed in §1). Owner rulings from 2026-10-01 are marked **RESOLVED**. The two deviations that matter most:

1. **Capture frame.** `gradeWindow` today grades the window's *last gradeable tick* (`gradeSource` / `noteGradeCand`, `server-engine.ts:1427–1437`), which is near the close. That is a fine settlement frame, but a bad call frame: by then spot vs. strike mostly decides the window and asks sit near 1¢/99¢, so hit rate gets inflated and the hypothetical cents carry no information. The quiet call is therefore **captured once, at the first gradeable tick inside the Chair's entry window (`mins_left < 12`)**. It is graded at settlement inside `gradeWindow` using `centsOf` on **the capture snapshot's asks**.
2. **Where the state lives.** `getServerFrame()` (`server-engine.ts:2585`) publishes `sliceLearner(e.learner)` and `e.lastVotes` raw on the public `/frame`. Anything put on `Learner` or `Vote`, including `huddle_log`, goes public. So the quiet-call book is **a dedicated `QuietBook` held on the engine and persisted under its own `desk_state` key**. It is never a `SkillCard` in `learner.skills` and never a field on `Vote`. The math reuses the SkillCard machinery (`creditDirectional`, `refreshDerived`, `wilsonLower`) through a type-only widening.

**ORBIT is the sole control seat.** It emits a tagged coin flip every window, appears on the leaderboard, and is excluded from flagging and from the kill tests' seat counts. That leaves **20 judged seats**, VOLT and PULSE included (§3a).

Warm-up before the leaderboard is trustworthy: **200 graded quiet windows**. That is about 2.1 days at 96 windows/day, realistically 2.5–3 days after chalk and uncountable skips. Kill review: **once, at the first huddle after 500 graded quiet windows**, with the pre-registered tests in §9.

---

## 1. Deviation and decision register

Each item says what the design said, what this spec does, and why. Items marked **OWNER** need a yes/no before build.

| # | Design said | Spec does | Why |
|---|---|---|---|
| D1 | "Every window" (frame unspecified) | One capture per window at the **first tick with `mins_left < 12` and `gradeableBook(snap)`**. If none occurs before `mins_left ≤ 2.2`, the window is recorded `MISSED` and not graded. | The existing grade frame is the last pre-close tick, where hit rate is inflated and asks are near 1/99. `< 12` and `> 2.2` are the Chair's own entry gates (`chair.ts:489, 496`), so the call is measured where the desk could act. **RESOLVED 2026-10-01: first usable tick under 12 min.** A fixed mark can land on a dead tick; the first-usable rule degrades gracefully. |
| D2 | `centsOf` against "the window finish" | `centsOf(side, captureSnap, finish)`, using the capture-frame asks and the official finish. | Same function, but a different snapshot argument than the existing seat grading uses. This is the only reading under which "hypothetical cents" means something. |
| D3 | "Mandatory UP/DOWN computed from the seat's own read" | Tiered source: **RAW → PAPER → TILT → NONE** (§3). NONE = deterministic hash coin at conf 50, tagged. | Per the 2026-09-30 Phase 0 inventory, 11 of 21 voting seats have no LIVE card, so their pre-filter read (`raw_lean`) is WAIT on essentially every frame. A truly mandatory call needs fallbacks. TILT is the seat's own reader (e.g. TAPE's `imb` sign). **RESOLVED 2026-10-01: ORBIT is the sole control (tagged coin, excluded from flagging and the kill tests' count). VOLT and PULSE are judged seats.** Their cards are real conditional forecasts, and their readers already compute a conditional lean (§3b). Tier 4 (NONE) remains a tagged coin for any judged seat that exhausts tiers 1–3 on a window. |
| D4 | "BEFORE any filter/gag" | Uses `raw_lean`/`raw_conf` as `sitUnlessSure` stamps them (`bots.ts:266`). These are **after** `brierScale` (the card's own calibration) and **before** the whisper bar, COACH bench, retirement gag, STALE haircut, and Chair mutes. | `brierScale` is the card's self-calibration, which is part of the read, not a gag. This matches the existing gagged-read grading (`learner.ts:186–191`) and Directional Lean (`seat-lean.ts`), so there is one definition of "own read" on the desk. |
| D5 | "Reuse SkillCard machinery — new card kind or dedicated record" | **Dedicated `QuietRecord` per seat**, stored in `QuietBook` off-learner. It reuses `creditDirectional` (exported) and `refreshDerived` via a type-only `SkillStats` widening. | A card in `learner.skills` would be iterated by `runHuddle` bench/unbench, `windowsHuddleDue`, `skillCounts`, `rethinkSeat`, the vote pool, `seat-public`, SkillScoreAudit, status-transition telemetry, and `/frame`. Every one of those is either a decision path or public. |
| D6 | Grade "inside the existing gradeWindow pass" | Honored: `gradeWindow` gains an **optional trailing param** `quiet?: QuietGradeInput`. One call into `quiet-call.ts`, placed after the chalk/phantom early-return, so it shares the existing skip semantics. Absent param → byte-identical behavior. | Meets the design. It does not write `settle_tape` or `line`, both of which are public. |
| D7 | "Flagged in huddle review" | `quietHuddleReview()` runs **at the three `runHuddle` call sites** (`server-engine.ts:1371, 1617, 2664`), immediately after `runHuddle`. `runHuddle` itself is not modified. Flags go to `QuietBook.review_log`, never `learner.huddle_log`. | `huddle_log` is public via `/frame`, and runHuddle is a decision path. Same trigger moment, zero coupling. |
| D8 | Flagged seats are "candidates for existing rethink-card spawning" | Flags are **diagnosis only**. Today `spawnRethink` is reachable only through `reviewSeats → rethinkSeat`, and `SEAT_REVIEW_DEMOTION_FROZEN = true` blocks that path. There is no admin op to trigger a rethink. **A flag therefore produces no treatment until the owner acts.** | Stated so nobody expects flags to self-heal anything. Wiring a `rethink_seat` admin op would be a decision-path change and is out of scope; it would need its own spec. |
| D9 | Rolling last 20 / 50 ranks | Built as specified, but L20 is labeled **noise-dominated** (95% CI about ±20pp). | Honest labeling. Ranks are still printed. |
| D10 | Starts clean "at deploy" | Ships behind `QUIET_CALL_V1_ENABLED` (env, **default off**). It starts clean at **activation**, and `activated_at` is stamped. | Matches the repo convention for research captures (`*_INACTIVE` → owner activation). **RESOLVED 2026-10-01: ship dark.** The owner flips the flag at a chosen clean open (planned: a Monday). The flag takes effect at the next window boundary, so no partial window is captured. |
| D11 | (addition) | An extra EV column: **EV vs. coin** = cents − mean(centsOf UP, centsOf DOWN) at the same capture asks. | Raw EV is negative for any seat because of fees and vig. Without a same-window coin baseline, "EV rank" is uninterpretable. |
| D12 | (addition) | A **WARDEN exclusion**, so the ledger has 20 seats (ER-1; written as 21 before the build). | WARDEN is a non-directional veto and `gradeWindow` already skips it (`learner.ts:174`). Checked: the 21 are `SEAT_IDS` minus WARDEN, which **includes the retired seats ODDS, CHEAP and FADE** (`seats.ts:62` `RETIRED_SEAT_IDS`). Retirement only gags their final vote: `sitUnlessSure` stamps `raw_lean` before the retirement gag (`bots.ts:266–277`), so their own reads exist on every frame. |
| D13 | (owner ruling, rev 3) | **Control = ORBIT only.** It is always a pure coin (`source = CONTROL`), shown on the leaderboard labeled CONTROL, excluded from flagging and from K1/K2 (judged k = 20). If ORBIT drifts off 50%, that is a **grading-integrity alarm** (K0), not a signal. | ORBIT is the only sideless seat; all three of its cards vote "do not vote a side". VOLT and PULSE own real conditional forecasts (`skills.ts:336–385, 666–715`). Forcing those to coin flips would discard signal to keep the design tidy. One control still covers the integrity check and the fee-and-spread floor; the luck band is analytic (§5). |
| D14 | (owner ruling) | TILT direction per fade-type seat: **EXHAUST fades** the 1h run; **FADE fades** the 60s YES move; **CARRY mirrors `readCarry().lean`** (fade when funding is extreme, follow ret15 on moderate trend carry, otherwise no tilt). | Verified against the seats' own rules (§3). `readCarry` already computes exactly this conditional lean (`derivs.ts:86–90`), so CARRY's fallback reuses it rather than restating it. |
| D15 | (follows from rev 3) | **VOLT and PULSE TILT mirror their readers' own `lean`**, the same pattern as CARRY: `readVolt(snap).lean` (`derivs.ts:160–186`) and `readPulse(snap).lean` (`tape.ts:53–81`). | Both readers already encode their cards' conditions. One nuance, mirrored as-is: `readPulse` returns the price side on any volume spike, including climax and absorb spikes, which PULSE's own cards treat as WAIT. The reader is the fallback source of truth; this is noted so analysis can split TILT calls if it matters. |

Nothing here touches the 80¢ floor (`FLOOR_LIVE_CENTS` / `CHAIR_MIN_ASK_CENTS`), fees, gates, weights, thresholds, statuses, or the Chair.

---

## 2. Data flow (one window)

```
tick (server-engine.ts ~1714)
  runBots → decideChair → settleIfNeeded(prev) → noteGradeCand
  └─ NEW noteQuietCapture(e, snap, votes)     ← read-only, after the Chair decided
       if enabled && no capture for jobKey(snap) && snap.as_of ≤ close_time
          && gradeableBook(snap) && snap.mins_left < 12 && snap.mins_left > 2.2
         → e.quietCaptures[jobKey] = buildCapture(snap, votes)   (21 calls)
         → void writeQuietCaptureRows(capture)                  (DB, async)

settle → applyGrade (server-engine.ts:1236)
  capture = e.quietCaptures[jobKey(snap)]  (identity checked: ticker + close_time)
  if isCountable(close):
     gradeWindow(learner, snap, votes, chair, finish, { book: e.quietBook, capture })
        └─ after chalk early-return: gradeQuiet(book, capture, finish)
           (chalk path → capture marked SKIPPED_CHALK, nothing credited)
  else: markQuiet(capture, "SKIPPED_UNCOUNTABLE")
  delete e.quietCaptures[jobKey]; void writeQuietGradeRows(...)
  huddle due? runHuddle(...) then quietHuddleReview(e.quietBook, ...)
  persistState(e, true)   ← quiet_book + quiet_captures in the same write as learner
```

The capture runs **after** the Chair has decided on that tick and only reads `votes` and `snap`. Nothing it computes is attached to `votes`, `snap`, `chair`, or `learner`.

---

## 3. The quiet call (per seat, per window)

```ts
type QuietSource = "RAW" | "PAPER" | "TILT" | "NONE" | "CONTROL";
type AdmittedState = "SPOKE" | "WAIT" | "SIT" | "FORCED_SIT" | "RETIRED" | "MUTED" | "FEED_DOWN";

type QuietCall = {
  seat: SeatId;                 // 21 seats, WARDEN excluded
  control: boolean;             // ORBIT only
  side: "UP" | "DOWN";          // always set
  conf_raw: number;             // as read (0–92 scale for RAW/PAPER; 50 for TILT/NONE/CONTROL)
  p: number;                    // clamp(conf_raw, 50, 99) / 100 — the probability graded by Brier
  source: QuietSource;
  paper_card_id?: string;       // when source = PAPER
  closed_card?: boolean;        // PAPER card is in CLOSED_DIRECTIONAL_CARDS
  admitted_lean: Lean;          // the vote's final lean at capture
  admitted_state: AdmittedState;
  skill_used: string;
};

type QuietCapture = {
  v: "QUIET_CALL_V1";
  ticker: string; close_time: number; as_of: number; mins_left: number;
  regime_key: string;
  yes_ask: number; no_ask: number; yes_mid: number;   // inputs centsOf will read
  build_sha: string;
  calls: QuietCall[];
};
```

### 3a. Control seat

`QUIET_CONTROL_SEATS = ["ORBIT"]`. For ORBIT, selection skips every tier below and goes straight to the coin: side = `fnv1a(seat|ticker|close_time) & 1`, `conf_raw = 50`, `source = CONTROL`. ORBIT has no directional cards, so this discards nothing.

What the control does: (1) **pipeline integrity**, because ORBIT significantly off 0.5 means grading or the hash is broken (K0); (2) **coin EV under capture-time asks**, the fee-and-spread floor, which is also computed analytically for every seat as EV-vs-coin. The **luck band** does not need an empirical coin. It is the binomial 95% interval at each n, shown analytically on the board (§5).

### 3b. Judged seats

**Source selection, in strict order (pure, deterministic):**

1. **RAW**: `vote.raw_lean ∈ {UP, DOWN}`. Side = `raw_lean`, `conf_raw = raw_conf ?? confidence`. This covers spoken votes, whisper-gagged reads, COACH-benched reads, and retired-seat reads.
2. **PAPER**: otherwise, the directional entry in `vote.paper` (the seat's other cards that fired this frame, any status) with the highest `confidence`. Ties break on lexical card id. `paper_card_id` and `closed_card` are recorded so analysis can exclude closed cards.
3. **TILT**: otherwise, `quietTilt(seat, snap, feats)`, a new pure function per seat that reads the **same reader the seat's bot already calls** and returns only a sign, with `conf_raw = 50`. Proposed sign sources (each one confirmed against the reader's actual fields at build, and returning `null` when the reader is flat or absent):

| Seat | Reader (existing) | Proposed sign |
|---|---|---|
| WICK | `readWick(c1, …)` | `structure.trend` |
| DRIFT | `readDrift` | `d.lean` |
| STREAK | `readStreak` | `st.side` |
| EXHAUST | `snap.ret1h` (the input its cards and `readExhaust` use) | **Fade:** `ret1h > 0 → DOWN`, `< 0 → UP`, `0 → null`. Verified: all five directional EXHAUST cards vote "fade the 1h" (`skills.ts:270–319`), and the sixth (`inside_after_run`) votes WAIT. |
| TAPE | `readTape` | sign of `imb` |
| WHALE | `readWhale` | `w.lean` |
| VEL | `readVel` | sign of `lead` |
| CARRY | `readCarry(snap).lean` (`derivs.ts:68–90`) | **Conditional, mirrored as-is:** extreme persisted funding → fade the crowded side; moderate funding agreeing with ret15 while OI builds → with ret15; otherwise WAIT → `null` (falls to NONE). Verified against `CARRY.persist_fade`, `CARRY.unwind`, `CARRY.trend_carry` (fade/follow) and `normalize_sit`/`flip_print` (WAIT). |
| CHAIN | `readChain` | `withPx` / `against` → price direction |
| CASCADE | `readCascade(snap).lean` | **Owner ruling 3:** the 5m move on squeeze / liq cluster / vol-spike-without-OI; else NONE. |
| STRIKE, INDEX | `readClock` | ITM side (`readClock.itm`); at the strike → NONE |
| ODDS, CHEAP | `snap.yes_ask` | **Owner ruling 2:** cheaper side — YES ask < 50¢ → UP, > 50¢ → DOWN, exactly 50¢ / no quote → NONE |
| FADE | `d60` exactly as `fadeBot` computes it (`bots.ts:1026–1027`: `yes_mid_path` last − 6th-from-last) | **Fade:** `d60 > 0 → DOWN`, `< 0 → UP`, `0` or path < 6 → `null`. Verified: FADE's only card is `FADE.60s_rip`, "fade the rip" (`skills.ts:765–770`). FADE is retired but in the 21 (D12). |
| CLOCK | `readMarket` / session prior | `CLOCK.session_prior` pocket majority for `clock_key` |
| WIRE | `readWire(snap).lean` | **Owner ruling 1:** fade F&G extremes (≥ 80 rising → DOWN, ≤ 20 falling → UP); else NONE |
| VOLT | `readVolt(snap).lean` (`derivs.ts:160–186`) | **Mirror the reader:** expansion (ATR% ≥ 0.22 and \|ret15\| ≥ 0.25%) → with ret15; else vol-hot (pct ≥ 80, \|ret5\| ≥ 0.15%) → with ret5; else range spike → with ret5; else `null` → NONE. Matches `expand_break`, `vol_hot`, `atr_spike`. |
| PULSE | `readPulse(snap).lean` (`tape.ts:53–81`) | **Mirror the reader:** 1m volume spike (> 2.2× median) with directional candle → that side; else 5m volume lag with ret15 agreeing → with ret15; else `null` → NONE. Matches `vol_agree`, `vol_lag_5m` (see D15 nuance). |
| ORBIT | — | **Not applicable: control seat (§3a)** |

4. **NONE**: otherwise, side = `fnv1a(seat|ticker|close_time) & 1 ? UP : DOWN`, `conf_raw = 50`. This is graded into the all-in record (it is the honest cost of having no read) and reported separately. NONE is tagged and only occurs when a **judged** seat exhausts tiers 1–3 on a window (e.g. CARRY in normalize/flip states, VOLT in a dead or coiled tape, PULSE on normal volume, TAPE with `imb = 0`). Every record is reported both all-in and with NONE excluded, so VOLT and PULSE stay interpretable even if many of their windows end in NONE.

`admitted_state` is derived from the final vote: `FEED_DOWN` if `health === "DOWN"`; `RETIRED` if the seat is in `RETIRED_SEATS`; `MUTED` if the seat is in `settings.mutes`; `FORCED_SIT` if `forced_sit`; `SIT` if `skill_used === "SIT"`; `WAIT` if lean is WAIT; else `SPOKE`.

---

## 4. Grading (inside `gradeWindow`)

Placement: `learner.ts` `gradeWindow`, immediately after the chalk/dual-down early-return block. On that early-return path, the capture is marked `SKIPPED_CHALK` and nothing is credited.

Per call, with `finish` the official settle:

```
hit   = side === finish ? 1 : 0
cents = centsOf(side, captureSnap, finish)              // existing fn, clock.ts:82
coin  = (centsOf("UP", captureSnap, finish) + centsOf("DOWN", captureSnap, finish)) / 2
creditDirectional(rec.all, hit, p*100, capture.regime_key, cents)   // existing fn, exported
creditDirectional(rec.bySource[source], …)               // same stats split by source
creditDirectional(rec.byAdmitted[spoke ? "SPOKE" : "SILENT"], …)
rec.coin_sum += coin; rec.pocket_ev[regime] += cents
rec.roll.push({ hit, cents, coin, p, source }) ; keep last 50
```

`captureSnap` is a minimal `Snapshot`-shaped object built from the capture's `yes_ask/no_ask/yes_mid`. Those are the only fields `centsOf` reads. A test pins this so that if `centsOf` ever reads more, the build fails.

**Persistence shape:**

```ts
type SkillStats = Pick<SkillCard, "n"|"hits"|"wilson"|"brier_sum"|"brier_n"|"brier"|
                                  "ev_sum"|"ev_n"|"ev"|"streak_wrong"|"last20"|"pocket">;
type QuietRecord = {
  seat: SeatId;
  all: SkillStats;
  bySource: Record<QuietSource, SkillStats>;
  byAdmitted: { SPOKE: SkillStats; SILENT: SkillStats };
  coin_sum: number;
  pocket_ev: Record<string, number>;
  roll: { hit: 0|1; cents: number; coin: number; p: number; source: QuietSource }[]; // ≤ 50
};
type QuietBook = {
  v: "QUIET_CALL_V1";
  activated_at: number;
  graded_windows: number;       // windows with a capture that graded
  missed_windows: number;       // no capture tick in the entry window
  skipped: { chalk: number; uncountable: number; identity: number };
  graded_keys: string[];        // last 256 jobKeys; second grade of a key is ignored
  seats: Record<SeatId, QuietRecord>;
  flags: Record<SeatId, QuietFlag>;
  review_log: string[];         // private; ≤ 40
  kill: KillVerdict | null;
};
```

`refreshDerived` widens its param type from `SkillCard` to `SkillStats`, and `creditDirectional` is exported with the same widening. Both are type-only changes with no runtime diff, and a test pins that existing card grading is unchanged.

---

## 5. Leaderboard (review surface, not public)

Route: `GET /research/quiet-calls`. Auth uses the `x-desk-admin` header only, through the `adminKeyOk` pattern from `owner/ai-cost.get.ts`. A wrong or missing key returns 404. The response is JSON with `cache-control: no-store`. It is not in the sitemap and not linked from any page. It carries the standard `authority: { production_authority: "NONE", promotes_nothing: true, books_nothing: true, paper_only: true }` block.

Per seat, for each horizon **L20 · L50 · ALL**: `n, hits, hit%, wilson_lb, wilson_ub, brier, bss (= 1 − brier/0.25), ev_per_call, ev_vs_coin_per_call`, plus `rank_wilson` and `rank_ev`. ALL-horizon extras: source coverage %, SPOKE vs. SILENT split, per-regime pockets (n, hit%, EV), `flag` state, `warming` (true while seat n < 200), `control` (true for ORBIT only).

ORBIT is listed in a separate CONTROL row beneath the 20 judged seats. Its rank is computed against the judged field so you can see where a coin would place ("a coin would rank 11th of 20 on L50"), but it never takes a rank slot from a judged seat. The board also shows an analytic `luck_band` line: the binomial 95% interval around 0.5 at the current L20, L50 and ALL n.

Ranking:

- `rank_wilson` sorts by Wilson LB descending, then EV/call descending, then seat id.
- `rank_ev` sorts by EV-vs-coin/call descending, then Wilson LB descending, then seat id. EV-vs-coin is used rather than raw EV so ranks are not driven by which windows a seat happened to have.

Board-level: `trust: "WARMING" | "TRUSTWORTHY"` (TRUSTWORTHY once `graded_windows ≥ 200`), `graded_windows`, `missed_windows`, the skip counts, and `activated_at`.

**Warm-up: 200 graded quiet windows.** At n = 200 the 95% Wilson half-width at p = 0.5 is about ±6.9pp (interval 0.431–0.569). At n = 50 it is about ±13.5pp, and at n = 20 about ±20pp. Below 200, ranks are printed but tagged WARMING, and no huddle flags fire.

---

## 6. Huddle integration (diagnose only)

`quietHuddleReview(book, now)` runs after each `runHuddle` call. It is pure apart from mutating `book.flags` and `book.review_log`.

**Eligibility (all required):** the seat is not a control seat, `book.graded_windows ≥ 200`, the seat's `all.n ≥ 200`, and the seat's `roll` is full (50). ORBIT is never flagged.

**Trigger, precise.** A seat is TRAILING at a huddle if **either** of these holds:

- **(A) Significantly below coin:** `wilsonUpper(all.hits, all.n) < 0.50`. The seat's record is confidently worse than a coin. This is diagnosed as `INVERT?`, because an inverse record is information, not just failure.
- **(B) Persistent bottom:** at **3 consecutive** eligible huddles, all of the following held:
  - the seat ranked in the **bottom quartile** (`rank_wilson > ⌈0.75·k⌉`, k = eligible judged seats, at most 20) on ALL;
  - L50 hit% < 0.50;
  - L50 EV-vs-coin/call < 0.

A seat that is TRAILING becomes **FLAGGED**. A flag clears after **2 consecutive** huddles where neither A nor B holds (hysteresis). At most **3** seats are newly flagged per huddle, chosen by lowest ALL Wilson LB. The rest wait for the next huddle.

Each flag records `{since, reason: "A"|"B", wilson_lb, wilson_ub, l50_hit, l50_ev_vs_coin, rethink_eligible}`. `rethink_eligible` mirrors `spawnRethink`'s own preconditions (the seat owns ≥1 card and has fewer than 2 `.rethink_` cards). It is read, never acted on.

**Output.** One private line per huddle goes into `book.review_log`, e.g. `QUIET 2026-10-04 03:00 · n=212 · FLAG TAPE(B wlb .41 L50 44% −3.1¢) · CLEAR none`. Nothing is written to `learner.huddle_log`, `settle_tape`, the board, Discord, or push. Treatment (bench/promote/rethink) stays entirely with existing machinery and the owner (see D8).

---

## 7. Persistence and migration

**`desk_state` JSON (synchronous durability):** two new top-level keys in `persistState` (`server-engine.ts:610`): `quiet_book` and `quiet_captures` (pending captures keyed by jobKey, capped at 8). They are restored with `sanitizeQuietBook` / `sanitizeQuietCaptures`, which drop malformed input to empty or fresh and never throw. Because they go in the same write as `learner`, a grade and its quiet credit are atomic. Old states without these keys restore to an empty book. `sliceLearner` is not touched.

**New table: `migrations/0071_desk_quiet_calls.sql`.** It is strictly additive and idempotent (`create table if not exists`):

```sql
create table if not exists desk_quiet_calls (
  ticker        text not null,
  close_time    timestamptz not null,
  seat          text not null,
  captured_at   timestamptz not null,
  mins_left     double precision not null,
  regime_key    text not null,
  side          text not null check (side in ('UP','DOWN')),
  conf_raw      double precision not null,
  p_used        double precision not null check (p_used >= 0.5 and p_used <= 0.99),
  source        text not null check (source in ('RAW','PAPER','TILT','NONE','CONTROL')),
  paper_card_id text,
  closed_card   boolean not null default false,
  admitted_lean text not null,
  admitted_state text not null,
  skill_used    text not null,
  yes_ask       double precision, no_ask double precision, yes_mid double precision,
  build_sha     text not null,
  grade_status  text not null default 'PENDING'
                check (grade_status in ('PENDING','GRADED','SKIPPED_CHALK','SKIPPED_UNCOUNTABLE','SKIPPED_IDENTITY')),
  finish        text check (finish in ('UP','DOWN')),
  hit           smallint check (hit in (0,1)),
  cents         double precision,
  coin_cents    double precision,
  graded_at     timestamptz,
  primary key (ticker, close_time, seat)
);
create index if not exists desk_quiet_calls_close_idx on desk_quiet_calls(close_time desc);
create index if not exists desk_quiet_calls_seat_idx  on desk_quiet_calls(seat, close_time desc);
create table if not exists desk_quiet_windows (
  ticker text not null, close_time timestamptz not null,
  status text not null check (status in ('CAPTURED','MISSED')),
  noted_at timestamptz not null default now(),
  primary key (ticker, close_time)
);
```

Rows are written fire-and-forget (`void …catch(noteErr)`) with `on conflict do nothing` on capture and a guarded `update … where grade_status='PENDING'` on grade. A DB failure can never block a tick or a grade. The JSON book is authoritative for the leaderboard and huddle. The table is authoritative for kill analysis and audit. A reconciliation function rebuilds a `QuietBook` from table rows; the review route reports any drift between the two.

---

## 8. Activation and retirement switch

`QUIET_CALL_V1_ENABLED` is an env var, default off (D10). When off, `noteQuietCapture` returns immediately, `gradeWindow` receives no `quiet` arg, and `quietHuddleReview` is a no-op. Retirement (§9) means setting it off. Tables and the JSON book stay, read-only, and nothing is deleted.

---

## 9. Pre-registered kill criteria

These are evaluated **once**, at the first huddle after `book.graded_windows ≥ 500`. The verdict is written to `book.kill` and `docs/QUIET_CALL_LEDGER_V1_VERDICT.md`. There are no earlier peeks for kill purposes; the leaderboard is visible throughout but decides nothing.

- **K0, integrity (extends, does not retire).** If captured/eligible windows < 90%, or table↔book drift is > 0, or **ORBIT's ALL record rejects p = 0.5 at α = 0.05 two-sided**, fix the cause and re-run the check at 500 *clean* windows. The ORBIT test is a pipeline check: a coin that "has skill" means the grading or the hash is broken. With one control there is a 5% chance of a false alarm per checkpoint. That cost is acceptable, because the response is to pause and inspect, not to retire.
- **K1, no discrimination.** Retire if **both** of the following hold:
  - (a) no judged seat's ALL record rejects p = 0.5 two-sided at a Holm-corrected family α = 0.05 (**20 tests**, so the strictest threshold is z = 3.02);
  - (b) a χ² homogeneity test across the **20 judged seats'** hit rates does not reject at 0.05 (df = 19, critical value 30.14).
  
  Contrarian seats count as discriminating.
- **K2, no signal beyond skill cards.** Existing grading already credits RAW reads, including gagged ones, to skill cards (`learner.ts:186–198`). So the *novel* subset is `source ∈ {PAPER, TILT}` (NONE excluded as coin, RAW excluded as already carded). Retire if **all** of the following hold:
  - (a) no judged seat's novel subset rejects p = 0.5 at Holm α = 0.05 (20 tests);
  - (b) the window-clustered pooled novel hit rate (unit = window, value = mean hit across that window's novel calls) has a 95% CI containing 0.5;
  - (c) the window-clustered pooled novel mean of (cents − coin) has a one-sided 95% t lower bound ≤ 0.
- **Retire if K1 OR K2.** Otherwise continue; the owner decides any next checkpoint, and none is pre-registered.

ORBIT never enters K1 or K2. It contributes only to K0.

**Known limits, stated up front.** At n = 500 per seat with Holm z = 3.02 (20 tests), K1 can only detect seats with |hit − 0.5| ≳ 6.8pp, so "retire" means "no seat with an edge that large", not "no signal anywhere". Seats share windows and often share readers, so tests are correlated. That is why the pooled tests cluster by window.

---

## 10. Files

**New**

| File | Purpose |
|---|---|
| `src/lib/desk/quiet-call.ts` | Pure: types, `selectQuietCall`, `quietTilt`, `fnvCoin`, `buildCapture`, `gradeQuiet`, ranks, `quietHuddleReview`, `evaluateKill`, `sanitizeQuietBook/Captures`, `rebuildBookFromRows` |
| `src/lib/desk/quiet-call.server.ts` | DB writes (capture rows, window status, grade update), report builder for the route, reconciliation |
| `server/routes/research/quiet-calls.get.ts` | Admin-header-only JSON leaderboard, 404 otherwise |
| `migrations/0071_desk_quiet_calls.sql` | §7 tables |
| `scripts/quiet-call.test.mjs` | Unit tests (§11 #1–27), Vite-loaded (ruling 4) |
| `scripts/quiet-call-integration.test.mjs` | gradeWindow / huddle / engine / leak tests (§11 #28–47, + #47a), Vite + disposable PGlite (ruling 4) |
| `docs/QUIET_CALL_LEDGER_V1.md` | This spec, as the pre-registration record |

**Modified**

| File | Change | Decision-path risk |
|---|---|---|
| `src/lib/desk/learner.ts` | `gradeWindow(…, quiet?: QuietGradeInput)`, one call after the chalk return, and a `SKIPPED_CHALK` mark on the chalk path; `export` + type-widen `creditDirectional` | None when the arg is absent; pinned by the deep-equal invariance test |
| `src/lib/desk/skills.ts` | `refreshDerived(card: SkillStats)` (type-only) | None (no runtime diff) |
| `src/lib/desk/types.ts` | Add `SkillStats` type alias | None |
| `src/lib/desk/server-engine.ts` | `Eng.quietBook`, `Eng.quietCaptures`; `noteQuietCapture` after `noteGradeCand` (~1714); pass capture in `applyGrade` (1273), mark uncountable in the else-branch; `quietHuddleReview` after each `runHuddle` (1371, 1617, 2664); persist/restore keys (495–545, 610–640) | Read-only taps; covered by the engine invariance test |

**Not touched:** `engine.ts` (the browser/local engine calls `gradeWindow` without the new arg, so quiet calls never exist client-side), `bots.ts`, `chair*.ts`, `book-floor.ts`, `persist.ts`/`sliceLearner`, `seat-public.ts`, `seat-lean.ts`, all public routes.

---

## 11. Test list

### Unit tests (`scripts/quiet-call.test.mjs`)

1. **RAW selection.** `raw_lean` UP with `raw_conf` 64 → UP, conf_raw 64, p 0.64, source RAW. This holds when the final lean is UP, WAIT+`forced_sit`, retired, or COACH-benched.
2. **RAW fallback to confidence.** `raw_lean` set but `raw_conf` undefined → uses `confidence`.
3. **PAPER selection.** `raw_lean` WAIT with papers [DOWN 58, UP 61, WAIT] → UP 61, PAPER, `paper_card_id` set. Equal confidences → lexical id tiebreak. A closed card sets `closed_card: true`.
4. **TILT selection.** No raw or paper direction, reader gives a sign → TILT, conf 50. Run once per judged seat against a fixture snapshot (20 cases). A flat reader returns null → NONE.
4a. **EXHAUST TILT fades.** `ret1h = +0.9%` → DOWN; `−0.9%` → UP; `0` → NONE.
4b. **FADE TILT fades.** `yes_mid_path` rising 10¢ over 6 points → DOWN; falling → UP; path shorter than 6 → NONE. A parity test confirms the `d60` it uses equals `fadeBot`'s own `Δ60s` evidence value on the same snapshot.
4c. **CARRY TILT mirrors `readCarry`.** Extreme positive funding persisting → DOWN; extreme negative → UP; moderate funding with ret15 up and OI rising → UP; normalize/flip states → NONE. Parity: CARRY's TILT equals `readCarry(snap).lean` for every fixture, so a future change to `readCarry` cannot desync it.
4d. **Retired seats are in.** ODDS, CHEAP and FADE each produce a quiet call on every capture. With a retired seat whose own card fired UP, the call is RAW UP and `admitted_state = RETIRED`.
4e. **VOLT and PULSE TILT mirror their readers.** VOLT's TILT equals `readVolt(snap).lean` and PULSE's equals `readPulse(snap).lean` for every fixture (parity, like CARRY). Expansion with ret15 up → VOLT UP; dead tape → VOLT NONE; 1m spike on a red candle → PULSE DOWN; normal volume → PULSE NONE. When a VOLT or PULSE card fires, the call is RAW/PAPER, not CONTROL.
5. **NONE and CONTROL selection.** ORBIT always produces `source = CONTROL`. A judged seat that exhausts tiers 1–3 produces `source = NONE`, never CONTROL. The coin is deterministic for the same seat/ticker/close, and across 10k synthetic keys it is balanced to within 1%.
5a. **ORBIT excluded from judgment.** ORBIT never receives a flag, never occupies a judged rank slot, and is absent from K1/K2 inputs; K0 does read it. VOLT and PULSE are judged: they can be flagged and are counted in K1/K2.
6. **WARDEN exclusion.** WARDEN never appears; a capture always has exactly 21 calls (20 judged + 1 control).
7. **Admitted state.** One case each for FEED_DOWN, RETIRED, MUTED, FORCED_SIT, SIT, WAIT, SPOKE, in precedence order.
8. **p clamp.** conf_raw 30 → p 0.50; conf_raw 92 → 0.92; conf_raw 120 → 0.99.
9. **Grading math.** Hit/miss against finish; `cents` equals `centsOf(side, captureSnap, finish)` for asks {yes 55, no 47}; coin = mean of both sides; Brier = (p − hit)²; EV-vs-coin sums.
10. **centsOf field pin.** Calling `centsOf` with the minimal capture snapshot gives the same result as calling it with the full source snapshot. This fails if `centsOf` starts reading another field.
11. **creditDirectional reuse.** Feeding a `QuietRecord.all` and a real `SkillCard` the same sequence yields identical n, hits, wilson, brier, ev, last20, and pocket.
12. **Rolling buffers.** `roll` is capped at 50; L20 = last 20; L50 Wilson/EV computed on the slice.
13. **Pockets.** Regime pocket n/hits plus `pocket_ev` accumulate per `capture.regime_key` (not the grade-frame regime).
14. **Ranks.** Wilson-desc, EV tiebreak, and seat-id tiebreak are deterministic, as is the EV-vs-coin rank. Seats with n = 0 rank last.
15. **Warm-up.** Board trust is WARMING at 199 and TRUSTWORTHY at 200. A seat with n < 200 is `warming`.
15a. **Luck band.** `luck_band` is the analytic binomial 95% interval around 0.5 at the current L20/L50/ALL n (e.g. n = 200 → 0.431–0.569).
16. **Flag trigger A.** Synthetic seat 70/200 (Wilson UB < 0.5) → FLAGGED with reason A. 90/200 → not flagged by A.
17. **Flag trigger B.** Bottom-quartile + L50 < 50% + L50 EV-vs-coin < 0 at 3 consecutive huddles → FLAGGED. Two consecutive then a recovery → not flagged.
18. **Hysteresis.** A flag clears only after 2 consecutive clean huddles.
19. **Cap.** Five seats trailing at once → 3 flagged (the lowest Wilson LB), and the other 2 on the next huddle.
20. **Eligibility.** Nothing flags before `graded_windows ≥ 200`, seat n ≥ 200, and a full roll.
21. **rethink_eligible.** It mirrors `spawnRethink` preconditions (no cards → false; 2 rethink cards → false), and the review never mutates `learner.skills`.
22. **Kill K1.** Fixture with all 20 judged seats ~Binomial(500, 0.5) → RETIRE. One judged seat at 0.58 (z > 3.02) → K1 passes. One at 0.42 also passes (contrarian counts). ORBIT at 0.58 does **not** pass K1. χ² homogeneity (df 19) is checked against a hand-computed value.
23. **Kill K2.** Novel subset at coin with RAW strong → RETIRE (signal is already carded). Novel subset strong → continue. Window clustering is verified by duplicating seats on one window, which must not shrink the CI.
24. **Kill K0.** 85% coverage → EXTEND, not RETIRE. Drift > 0 → EXTEND. ORBIT at 290/500 (rejects 0.5) → EXTEND with reason `CONTROL_DRIFT`.
25. **Kill one-shot.** The evaluation runs exactly once at ≥ 500. Later huddles do not re-evaluate or overwrite `book.kill`.
26. **Sanitize.** Garbage, partial, wrong-version, or negative-count input → fresh book with no throw. A valid book survives a round-trip unchanged. Captures beyond the cap of 8 are trimmed oldest-first.
27. **Rebuild.** `rebuildBookFromRows(rows)` equals the incrementally built book for the same 300-window synthetic stream.

### Integration tests (`scripts/quiet-call-integration.test.mjs`)

28. **gradeWindow invariance (the core rail).** For 50 fixture windows, `gradeWindow` with and without `quiet` yields a deep-equal `learner` and an identical `line`. This covers chalk windows, Chair-WAIT windows, and gagged-seat windows.
29. **gradeWindow credits the book.** With a capture, `book.graded_windows` increments by 1 and each seat's n increments by 1.
30. **Chalk path.** A chalk/phantom snapshot returns early; the capture is marked SKIPPED_CHALK; the book is uncredited; the learner matches baseline.
31. **Uncountable path.** `applyGrade` on an `isCountable = false` close → SKIPPED_UNCOUNTABLE, `gradeWindow` not called (existing behavior), book uncredited.
32. **Identity guard.** A capture whose close_time ≠ snap.close_time → SKIPPED_IDENTITY, no credit.
33. **Double grade.** A second `applyGrade` for the same jobKey is ignored by the existing guard, and the book's own `graded_keys` also refuses it, so the book's n is unchanged.
34. **Missing capture.** A grade with no capture (disabled, or window MISSED) leaves the book untouched and the learner unaffected.
35. **Capture timing.** Ticks at mins_left 14, 12.0, 11.9, 11.5 → captured exactly once, at 11.9. A non-gradeable book at 11.9 with a gradeable one at 11.5 → captured at 11.5. Nothing before 2.2 → MISSED and a `desk_quiet_windows` row written.
36. **Capture is read-only.** Deep-clone `votes`, `snap`, `chair`, and `learner` before `noteQuietCapture`; after it, all four are deep-equal.
37. **runHuddle invariance.** `runHuddle` output learner is deep-equal whether or not `quietHuddleReview` runs after it. `learner.huddle_log` never contains `QUIET`.
38. **Huddle wiring.** All three `runHuddle` call sites are followed by `quietHuddleReview` (source-scan rail, matching the repo's existing call-site rail style).
39. **Persist round-trip.** `persistState` → `restore` returns an equal `quiet_book` and pending captures. A state saved before this change restores to an empty book with no error.
40. **Restart between capture and settle.** A capture is persisted, the engine restarts, the window settles → graded once, from the persisted capture.
41. **Public leak rail.** `JSON.stringify(await getServerFrame())` contains no `quiet`, `QUIET_CALL`, `quiet_book`, or `p_used` keys. `Vote` objects carry no new keys versus the pre-change type snapshot. `sliceLearner` output keys are unchanged.
42. **Route auth.** `/research/quiet-calls` returns 404 with no header, 404 with `?key=` in the query string (header-only), and 200 with a valid `x-desk-admin`. Responses are `no-store` and include the authority block. The route is absent from sitemap.xml.
43. **Disabled = inert.** With `QUIET_CALL_V1_ENABLED` unset, a full tick → settle → huddle cycle writes no quiet rows, keeps the book empty, and leaves the learner and ledger row deep-equal to baseline.
44. **Standing-constraint rails.** `FLOOR_LIVE_CENTS`/`CHAIR_MIN_ASK_CENTS === 80`; `SEAT_REVIEW_DEMOTION_FROZEN === true`; `AUTO_SKILL_PROMOTION_ENABLED === false`; `runBots` and `decideChair` outputs are identical with the feature on vs. off for fixture frames.
45. **Ledger row unchanged.** `buildLedgerRow` output is deep-equal with the feature on vs. off.
46. **Migration.** `0071` applies twice cleanly under `check:migrations` (PGLite). Check constraints reject `side='WAIT'`, `p_used=0.4`, and an unknown `source`.
47. **DB failure isolation.** The capture/grade writers throwing → tick and `applyGrade` still complete, the learner is persisted, and `noteErr` is recorded.

---

## 12. Owner rulings (all resolved)

**2026-10-01, rev 2:** D1 (first usable tick under 12 min); D10 (ship dark, activate at a clean Monday open, effective at the next window boundary); D14 (EXHAUST fades, FADE fades, CARRY mirrors `readCarry`); retired seats confirmed in the 21 (D12).

**2026-10-01, rev 3:** control group = ORBIT only. VOLT and PULSE are judged seats; their TILT mirrors their readers (D15). Judged k = 20 (Holm z = 3.02, χ² df 19). Tier 4 = tagged coin for any judged seat that exhausts tiers 1–3. **Spec approved to build.**


## October 2 lead review — ordered kill snapshot

The kill evaluator now queues its audit-table read behind already-issued capture/grade writes and evaluates against a deep copy of the book taken at invocation. This prevents a pending grade from producing false BOOK_DRIFT and prevents later live book mutation from changing the evaluated cohort. Regression #47b issues a grade and kill without awaiting the write, mutates the caller book during the read, and requires reconciliation against the original book. This is persistence isolation only: no capture policy, statistical threshold, learner or production decision changes. Collection remains OFF pending independent review and owner activation.
