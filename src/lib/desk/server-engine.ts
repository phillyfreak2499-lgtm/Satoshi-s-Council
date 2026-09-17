/**
 * The shared brain. One engine loop on the server: pulls the live tape,
 * runs the 21 seats and the chair, prints calls, grades every finished
 * window, and persists the learner to Postgres — around the clock, whether
 * or not any browser is open. Browsers in Live mode are viewers (GET /frame);
 * desk controls arrive through POST /desk with the admin key.
 * Demo mode never touches this — it stays a per-browser sandbox.
 */
import { runBots } from "./bots";
import { checkpointActiveWindow, restoreActiveWindow, type ActiveWindow } from "./active-window";
import { runChair } from "./chair";
import { readClock, takerFeeCents } from "./clock";
import { isCountable } from "./research-quality";
import { beginSkillScoreAudit, finishSkillScoreAudit, withSkillAuditColumn, type SkillScoreAudit } from "./skill-score-audit";
import { captureEntrySkillRoster, withEntrySkillRosterColumn } from "./entry-skill-roster";
import { evaluateEntrySkillQuality, withEntrySkillQualityColumn } from "./entry-skill-quality";
import { appendPeriod, FUNDING_PERIOD_MS, nativePeriodMs, OI_PERIOD_MS, type HistPoint } from "./hist";
import { bundleToSnapshot } from "./live";
import {
  acceptCandidate,
  chicagoHuddleDue,
  gradeWindow,
  reviewSeats,
  runHuddle,
  windowsHuddleDue,
} from "./learner";
import { mergeLearner, sliceLearner } from "./persist";
import { CHAIR_SCALP, markSide, onLean, settleAll } from "./scalp";
import { bookable, bookableShadow, CHAIR_MIN_ASK_CENTS, paperBookEdgeOk, paperBookTeamOk } from "./book-floor";
import {
  dailyAdmission, hasPaperPosition, paperSummary, restoreRiskCalls, selectiveBookOk, selectiveChair,
  settleRiskCalls, SELECTIVE_ENTRY_ID, SELECTIVE_PARAMS, type EntryWatch,
} from "./selective-entry";
import {
  bookedDecisionAtGrade,
  sanitizeBookedDecisionState,
  type BookedDecisionState,
} from "./booked-decision";
import { freshLearner } from "./skills";
import { stickLean, type Stick } from "./stick";
import { softenTimeGates } from "./time-gates";
import { loadBundle } from "./server-feeds";
import { selectOpenKalshiMarket } from "./kalshi-market";
import { BOARD_UPDATE_MAX, DESK_UPDATES } from "./updates";
import {
  labDigestBits,
  labFairState,
  labSettleReceipt,
  startLab,
  labFairNow,
  forgetWhaleWindow,
  noteDeskState,
  whalePrintRecords,
} from "./lab.server";
import { recordPrints } from "./absorption.server";
import { recordPathParity, sampleKey } from "./path-parity.server";
import { activeChampion, recordExitArena } from "./policy-lab.server";
import { pointsFromReplay } from "./exit-arena";
import {
  faultLine,
  type IdentityChecks,
  type IdentityFault,
  isInconsistent,
  matchSettle,
  tickerAgrees,
} from "./window-identity";
import { coachRun, ensureCrewBoot, sweepRun } from "./crew.server";
import { ensureLedgerBoot, ledgerCitesFor, ledgerRun } from "./ledger-clerk.server";
import { arenaDigestLine, settleHumanCalls } from "./arena.server";
import { noteReplay, pruneReplays, recordReplay, replayLive } from "./replay.server";
import { decisionSnapshotFrom, recordDecisionSnapshot } from "./decision-snapshot.server";
import { observeChairWaitMilestone } from "./chamber-wait.server";
import { notifyCall, notifySettle, notifyWatchdog } from "./push.server";
import { weeklyRecap } from "./recap.server";
import { applyWatchdog, freshWatchdog, watchdogDecision, watchdogPayload, type WatchdogState } from "./push-rules";
import {
  V2_POPULATION,
  V2_SAMPLE_MINS,
  decideV2,
  extractFeatures,
  fitLogistic,
  newestTrainedMs,
  predictV2,
  seatEvidence,
  seatProb,
  settleV2,
  v2FeaturesVersion,
  type V2Decision,
  type V2Features,
  type V2Weights,
  V2_GATE_CALLS,
  V2_GATE_SAMPLES,
  v2Gates,
  type V2Stats,
  v2Voice,
} from "./chair-v2";
import type { CallLogRow, ChairResult, Learner, Lean, SeatId, SeatKnobs, Settings, Snapshot, Vote } from "./types";
import type { Sql } from "@/lib/db";
import { takerEvCents, takerSignal } from "./taker";
import {
  addKeyed,
  afterPersist,
  alertHealth,
  enqueueLedger,
  type ErrLog,
  healthVerdict,
  type LedgerJob,
  type LedgerRow,
  ledgerGaps,
  oldestQueueAgeMs,
  OUTBOX_CAP,
  partitionResolved,
  PENDING_CAP,
  persistOnce,
  type PersistIO,
  pushErr,
  removeKeyed,
  jobKey,
  sanitizePending,
  sanitizeQueue,
} from "./reliability";

const STATE_ID = "live";
const PERSIST_EVERY_MS = 8_000;

const DEFAULT_SERVER_SETTINGS: Settings = {
  poll_ms: 4000,
  source: "live",
  bar_override: null,
  adaptive_bar: true,
  mutes: [],
  show_faded: true,
  show_shadow: true,
  tz: "America/Chicago",
  beast: false,
};

type Eng = {
  recoveredWindow: ActiveWindow | null;
  stateWrite: Promise<void>;
  started: boolean;
  ready: Promise<void> | null;
  settings: Settings;
  learner: Learner;
  callLog: CallLogRow[];
  riskCalls: CallLogRow[];
  riskReady: boolean;
  entryWatch: EntryWatch | null;
  selectiveStart: number;
  baselineCalls: CallLogRow[];
  lastCall: { ticker: string; close_time: number; lean: Lean } | null;
  prevSnap: Snapshot | null;
  lastVotes: Vote[];
  lastChair: ChairResult | null;
  lastError: string | null;
  lastTickAt: number;
  sticks: Partial<Record<string, Stick>>;
  stickWindow: string;
  liveHist: { funding: HistPoint[]; oi: HistPoint[]; oiUsd: HistPoint[] };
  pending: PendingWindow[];
  /** Windows refused by the identity invariant, kept for forensics. Persisted. */
  identityFaults: IdentityFaultRecord[];
  /** Windows already graded, so a restart cannot teach one of them twice. Persisted. */
  gradedKeys: string[];
  gradeCand: { snap: Snapshot; votes: Vote[]; chair: ChairResult } | null;
  lastClose: number;
  timer: ReturnType<typeof setInterval> | null;
  inFlight: boolean;
  lastPersistAt: number;
  lastDigestCheckAt: number;
  pulse: DeskPulse | null;
  pulseTimer: ReturnType<typeof setInterval> | null;
  pulseInFlight: boolean;
  pulseFails: number;
  pulseBackoffUntil: number;
  lastPulseReqAt: number;
  v2: V2Weights | null;
  v2Sampled: string;
  /** Windows already sampled for the TAKER shadow seat (windowKey), once each. */
  takerSampled: string;
  v2Live: V2Decision | null;
  v2Stats: V2Stats | null;
  v2Fitting: boolean;
  v2LastFitAt: number;
  /** When a window's grade was last CALCULATED in memory (boot counts). */
  lastGradeAt: number;
  /** When a window was last durably recorded AND verified in the ledger — the
   *  health clock. A grade that is calculated but not persisted never advances
   *  this, so a failed write can't look like a completed grade. Restored on boot. */
  lastLedgerOkAt: number;
  /** Graded windows awaiting a durable, verified ledger write (retry with backoff). */
  ledgerQueue: LedgerJob[];
  /** 80¢ trial: the first ask per window at which the OLD 70¢ floor would have
   *  filled, keyed by windowKey. Research only — never gates a live fill. */
  shadowFills: Record<string, { lean: "UP" | "DOWN"; cents: number }>;
  /** The state the desk was in when a fill happened, keyed by windowKey. The
   *  ledger otherwise only describes the grade frame, so without this a signal
   *  cannot be sliced by regime, time left, spread or the economics it paid.
   *  Research only — nothing reads it to decide anything. */
  entryState: Record<string, BookedDecisionState>;
  ledgerFlushing: boolean;
  /** Interior holes found in the recent ledger by the last gap scan (lost windows). */
  ledgerGapCount: number;
  lastGapScanAt: number;
  /** Owner push subscriptions the watchdog could reach, from the last probe. */
  alertOwnerSubs: number;
  /** Recent failures with scope + text, bounded — which window/feed/write, and why. */
  errors: ErrLog[];
  /** When this process booted (for the health boot-grace). */
  startedAt: number;
  /** Long-lookback reconciliation: total interior holes over the recon window,
   *  the most recent few missing windows, and the accepted baseline (a hole
   *  count beyond it is a NEW loss that alerts). Baseline is persisted. */
  reconAt: number;
  reconHoles: number;
  reconMissing: number[];
  reconBaseline: number | null;
  /** Owner readiness latch: the "enough data to evaluate" push fires ONCE. Persisted. */
  readinessAlerted: boolean;
  watchdog: WatchdogState;
  watchdogTimer: ReturnType<typeof setInterval> | null;
};

/** A window graded once its official Kalshi result arrives; held in a bounded
 *  collection so a second pending window can never overwrite the first (G5). */
type PendingWindow = { ticker: string; close_time: number; snap: Snapshot; votes: Vote[]; chair: ChairResult };

/** A window whose identity did not hold, with the witnesses that caught it. */
type IdentityFaultRecord = {
  key: string;
  ticker: string;
  close_time: number;
  fault: IdentityFault;
  detail: string;
  checks: IdentityChecks;
  at: number;
};

/** How many identity faults to carry. Far above the zero a healthy desk produces. */
const IDENTITY_FAULT_CAP = 40;

/** How many graded windows to remember. ~2 days, far beyond any settlement delay. */
const GRADED_KEY_CAP = 200;

/** Restore the fault log across a restart, dropping anything malformed. */
function sanitizeIdentityFaults(raw: unknown): IdentityFaultRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: IdentityFaultRecord[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const f = r as Partial<IdentityFaultRecord>;
    if (typeof f.key !== "string" || typeof f.ticker !== "string" || typeof f.fault !== "string") continue;
    if (typeof f.close_time !== "number") continue;
    out.push({
      key: f.key,
      ticker: f.ticker,
      close_time: f.close_time,
      fault: f.fault as IdentityFault,
      detail: typeof f.detail === "string" ? f.detail : "",
      checks: (f.checks ?? { on_grid: false, ticker_time_ok: null, ticker_seen: false, close_ok: false }) as IdentityChecks,
      at: Number(f.at) || 0,
    });
  }
  return out.slice(-IDENTITY_FAULT_CAP);
}

export type { V2Stats } from "./chair-v2";

export type V2Frame = {
  live: V2Decision | null;
  weights_n: number;
  fitted_at: number;
  stats: V2Stats | null;
  top: [string, number][];
};

/** The fast lane: a ~1.5s quote pulse for the viewers' eyes only. The brain
 *  never reads it — everything the seats decide on stays frame-cadenced.
 *  as_of is the timestamp OF THE DATA; on upstream failure the last good
 *  pulse is kept with its original as_of and stale flips true — a dead feed
 *  must look dead, never fresh. */
export type DeskPulse = {
  as_of: number;
  fetched_at: number;
  ticker: string;
  spot: number | null;
  yes_bid: number;
  yes_ask: number;
  no_bid: number;
  no_ask: number;
  close_time: number;
  strike: number;
  stale: boolean;
};

// Survive dev HMR double-imports: one engine per process, on globalThis.
const g = globalThis as typeof globalThis & { __satoshiServerEngine__?: Eng };

function freshEng(): Eng {
  return {
    recoveredWindow: null,
    stateWrite: Promise.resolve(),
    started: false,
    ready: null,
    settings: { ...DEFAULT_SERVER_SETTINGS },
    learner: freshLearner(),
    callLog: [],
    riskCalls: [],
    riskReady: false,
    entryWatch: null,
    selectiveStart: Math.ceil(Date.now() / 900_000) * 900_000,
    baselineCalls: [],
    lastCall: null,
    prevSnap: null,
    lastVotes: [],
    lastChair: null,
    lastError: null,
    lastTickAt: 0,
    sticks: {},
    stickWindow: "",
    liveHist: { funding: [], oi: [], oiUsd: [] },
    pending: [],
    identityFaults: [],
    gradedKeys: [],
    gradeCand: null,
    lastClose: 0,
    timer: null,
    inFlight: false,
    lastPersistAt: 0,
    lastDigestCheckAt: 0,
    pulse: null,
    pulseTimer: null,
    pulseInFlight: false,
    pulseFails: 0,
    pulseBackoffUntil: 0,
    lastPulseReqAt: 0,
    v2: null,
    v2Sampled: "",
    takerSampled: "",
    v2Live: null,
    v2Stats: null,
    v2Fitting: false,
    v2LastFitAt: 0,
    lastGradeAt: Date.now(),
    lastLedgerOkAt: Date.now(),
    ledgerQueue: [],
    shadowFills: {},
    entryState: {},
    ledgerFlushing: false,
    ledgerGapCount: 0,
    lastGapScanAt: 0,
    alertOwnerSubs: 0,
    errors: [],
    startedAt: Date.now(),
    reconAt: 0,
    reconHoles: 0,
    reconMissing: [],
    reconBaseline: null,
    readinessAlerted: false,
    watchdog: freshWatchdog(),
    watchdogTimer: null,
  };
}

/** Record a failure with its scope and text: sets the single lastError (kept for
 *  the UI/watchdog) and appends to the bounded ring so recent failures keep
 *  their detail — which window, feed, or write, and why. */
function noteErr(e: Eng, scope: string, msg: string) {
  e.lastError = `${scope}: ${msg}`.slice(0, 200);
  e.errors = pushErr(e.errors, scope, msg, Date.now());
}

function eng(): Eng {
  g.__satoshiServerEngine__ ??= freshEng();
  return g.__satoshiServerEngine__;
}

async function sql() {
  const { getSql } = await import("@/lib/db");
  return getSql();
}

async function loadState(e: Eng) {
  try {
    const db = await sql();
    const rows = await db<{ state: unknown }>`select state from desk_state where id = ${STATE_ID} limit 1`;
    const raw = rows[0]?.state as
      | {
          learner?: Partial<Learner>;
          call_log?: CallLogRow[];
          settings?: Partial<Settings>;
          last_call?: Eng["lastCall"];
          v2?: V2Weights | null;
          last_ledger_ok_at?: number;
          ledger_queue?: unknown;
          shadow_fills?: unknown;
          entry_state?: unknown;
          ledger_recon_baseline?: number | null;
          readiness_alerted?: boolean;
          pending?: unknown;
          identity_faults?: unknown;
          graded_keys?: unknown;
          active_window?: unknown;
          risk_calls?: unknown;
          risk_history_valid?: boolean;
          selective_start?: number;
          selective_policy?: string;
          baseline_calls?: unknown;
        }
      | undefined;
    if (!raw) {
      e.riskReady = true;
      return;
    }
    e.learner = mergeLearner(raw.learner ?? null);
    e.callLog = Array.isArray(raw.call_log)
      ? raw.call_log.filter((r) => r && (r.lean === "UP" || r.lean === "DOWN") && r.cents > 0).slice(0, 80)
      : [];
    const risk = restoreRiskCalls(raw.risk_calls, e.callLog);
    e.riskCalls = risk.calls;
    e.riskReady = risk.valid && raw.risk_history_valid !== false;
    e.baselineCalls = restoreRiskCalls(raw.baseline_calls, []).calls;
    if (raw.selective_policy === SELECTIVE_ENTRY_ID && Number.isFinite(raw.selective_start) && raw.selective_start! > 0) e.selectiveStart = raw.selective_start!;
    e.settings = { ...DEFAULT_SERVER_SETTINGS, ...(raw.settings ?? {}), source: "live" };
    e.settings.mutes = (e.settings.mutes ?? []).filter(Boolean);
    e.lastCall = raw.last_call ?? null;
    if (raw.v2 && raw.v2.w && typeof raw.v2.b === "number") e.v2 = raw.v2;
    // Restore the recorded-window clock so a restart (or a crash loop) keeps its
    // real age instead of resetting the watchdog's grace to now.
    if (typeof raw.last_ledger_ok_at === "number" && raw.last_ledger_ok_at > 0) {
      e.lastLedgerOkAt = raw.last_ledger_ok_at;
    }
    // Durable outbox: any grade calculated + force-persisted before the last
    // process death comes back here and drains to the ledger on this boot.
    e.ledgerQueue = sanitizeQueue(raw.ledger_queue, Date.now());
    e.shadowFills = sanitizeShadowFills(raw.shadow_fills);
    e.entryState = sanitizeBookedDecisionState(raw.entry_state);
    // Windows that closed before the last process death and were still waiting
    // on Kalshi's official result. Restored as the decision they were, so the
    // grade is the one the desk actually earned rather than one today's learner
    // would produce. resolvePending picks them up on the next tick that carries
    // their settle; settleIfNeeded will not re-add them because lastClose has
    // moved on, and addKeyed is keyed per window so a double restore cannot
    // double-grade.
    e.pending = sanitizePending<PendingWindow>(raw.pending, PENDING_CAP);
    e.identityFaults = sanitizeIdentityFaults(raw.identity_faults);
    e.gradedKeys = Array.isArray(raw.graded_keys)
      ? raw.graded_keys.filter((k): k is string => typeof k === "string").slice(-GRADED_KEY_CAP)
      : [];
    e.recoveredWindow = restoreActiveWindow(raw.active_window, e.gradedKeys);
    if (typeof raw.ledger_recon_baseline === "number") e.reconBaseline = raw.ledger_recon_baseline;
    e.readinessAlerted = raw.readiness_alerted === true;
  } catch (err) {
    e.lastError = `state load: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function persistState(e: Eng, force = false) {
  if (!force && Date.now() - e.lastPersistAt < PERSIST_EVERY_MS) return true;
  e.lastPersistAt = Date.now();
  try {
    const state = JSON.stringify({
      learner: sliceLearner(e.learner),
      call_log: e.callLog.slice(0, 80),
      risk_calls: e.riskCalls,
      risk_history_valid: e.riskReady,
      selective_start: e.selectiveStart,
      selective_policy: SELECTIVE_ENTRY_ID,
      baseline_calls: e.baselineCalls,
      settings: {
        bar_override: e.settings.bar_override,
        adaptive_bar: e.settings.adaptive_bar,
        mutes: e.settings.mutes,
        beast: e.settings.beast,
      },
      last_call: e.lastCall,
      v2: e.v2,
      last_ledger_ok_at: e.lastLedgerOkAt,
      ledger_queue: e.ledgerQueue.slice(-OUTBOX_CAP),
      shadow_fills: e.shadowFills,
      entry_state: e.entryState,
      ledger_recon_baseline: e.reconBaseline,
      readiness_alerted: e.readinessAlerted,
      // The pre-settlement half of the grading race. Bounded by PENDING_CAP,
      // which a healthy desk never approaches (0-2 entries).
      pending: e.pending.slice(-PENDING_CAP),
      identity_faults: e.identityFaults.slice(-IDENTITY_FAULT_CAP),
      graded_keys: e.gradedKeys.slice(-GRADED_KEY_CAP),
      // A restart can straddle close BEFORE the pending-settlement list exists.
      // Persist the observed grading input while the window is still open.
      active_window: checkpointActiveWindow(
        e.prevSnap && e.lastChair ? gradeSource(e, e.prevSnap, e.lastVotes, e.lastChair) : e.recoveredWindow,
        e.gradedKeys,
        e.pending,
      ),
    });
    // Tick, watchdog and grading saves may overlap. Write in capture order so
    // an older in-flight save cannot resurrect a completed checkpoint/outbox.
    const write = e.stateWrite.catch(() => {}).then(async () => {
      const db = await sql();
      await db`
        insert into desk_state (id, state, updated_at) values (${STATE_ID}, ${state}::jsonb, now())
        on conflict (id) do update set state = ${state}::jsonb, updated_at = now()
      `;
    });
    e.stateWrite = write;
    await write;
    return true;
  } catch (err) {
    e.lastError = `state save: ${err instanceof Error ? err.message : String(err)}`;
    return false;
  }
}

/** Checked-in changelog → pinned Board posts, one per slug. A posted note is
 *  never rewritten — the Board is a record — with one exception: a note that
 *  was clipped on the way in (the stored body is a strict prefix of the full
 *  one) is completed in place. The post itself (its id and time) is never
 *  recreated, so nothing reads as new. */
async function syncUpdates(e: Eng) {
  try {
    const db = await sql();
    for (const u of DESK_UPDATES) {
      const body = u.body.replace(/\s+/g, " ").trim().slice(0, BOARD_UPDATE_MAX);
      await db`
        insert into board (who, body, kind, lean, ticker, conf, slug)
        values ('DESK', ${body}, 'update', '', '', 0, ${u.slug})
        on conflict (slug) do update set body = excluded.body
        where length(excluded.body) > length(board.body)
          and left(excluded.body, length(board.body)) = board.body
      `;
    }
  } catch (err) {
    e.lastError = `updates sync: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function windowKey(snap: Snapshot) {
  return `${snap.ticker}:${snap.close_time}`;
}

function stickyVotes(e: Eng, votes: Vote[], snap: Snapshot): Vote[] {
  const k = windowKey(snap);
  if (e.stickWindow !== k) {
    e.sticks = {};
    e.stickWindow = k;
  }
  return votes.map((v) => {
    if (v.seat === "WARDEN") return v;
    const { lean, st } = stickLean(e.sticks[v.seat], v.lean, snap.as_of);
    e.sticks[v.seat] = st;
    if (lean === v.lean) return v;
    return { ...v, lean, reasoning: `${v.reasoning} · hold ${st.shown} (${st.pendingN}/2 ${st.pending ?? "—"})` };
  });
}

function lastSide(e: Eng, snap: Snapshot): Lean {
  if (e.lastChair && e.prevSnap && windowKey(e.prevSnap) === windowKey(snap)) return e.lastChair.lean;
  return "WAIT";
}

function decideChair(e: Eng, votes: Vote[], snap: Snapshot, lastLean: Lean): ChairResult {
  // LEDGER's promoted patterns that fire on this window — appended to the
  // chair's read as labelled evidence only; they change no gate, side or size.
  const cites = ledgerCitesFor(votes);
  const chair = softenTimeGates(runChair(votes, snap, e.learner, e.settings, lastLean, cites), snap);
  const { lean, st } = stickLean(e.sticks[CHAIR_SCALP], chair.lean, snap.as_of);
  e.sticks[CHAIR_SCALP] = st;
  return lean === chair.lean ? chair : { ...chair, lean };
}

/** Keep only well-formed shadow entries across a restart. */
function sanitizeShadowFills(raw: unknown): Record<string, { lean: "UP" | "DOWN"; cents: number }> {
  const out: Record<string, { lean: "UP" | "DOWN"; cents: number }> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const lean = (v as { lean?: unknown }).lean;
    const cents = Number((v as { cents?: unknown }).cents);
    if ((lean !== "UP" && lean !== "DOWN") || !(cents > 0) || !(cents < 100)) continue;
    out[k] = { lean, cents };
  }
  return out;
}

/** The shadow book's entry for this window: the FIRST ask the old floor would
 *  have taken, recorded once. A later, richer tick never overwrites it, because
 *  the old book would already have been positioned by then. */
function noteShadowFill(e: Eng, snap: Snapshot, lean: "UP" | "DOWN", cents: number): void {
  const key = windowKey(snap);
  if (e.shadowFills[key]) return;
  if (!bookableShadow(cents)) return;
  e.shadowFills[key] = { lean, cents: Math.round(cents * 10) / 10 };
  // Bound the map: a handful of live windows, never an all-time ledger.
  const keys = Object.keys(e.shadowFills);
  if (keys.length > 12) for (const k of keys.slice(0, keys.length - 12)) delete e.shadowFills[k];
}

/** Record the decision-time state of a fill, once per window. Research only. */
function runningBuildSha(): string {
  const sha = String(process.env.RENDER_GIT_COMMIT ?? "").trim().toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(sha) ? sha : "";
}

function noteEntryState(e: Eng, snap: Snapshot, chair: ChairResult, votes: Vote[], cents: number): void {
  if (chair.lean !== "UP" && chair.lean !== "DOWN") return;
  const key = windowKey(snap);
  if (e.entryState[key]) return;
  const touch = chair.lean === "UP" ? snap.no_bid_size : snap.yes_bid_size;
  e.entryState[key] = {
    lean: chair.lean,
    regime: snap.regime_key ?? "",
    secs_left: Math.round((snap.secs_left ?? 0) * 10) / 10,
    conf: Math.round(chair.confidence ?? 0),
    score: Math.round((chair.score ?? 0) * 1000) / 1000,
    bar: Math.round((chair.bar ?? 0) * 1000) / 1000,
    fair_yes: Math.round((snap.fair_yes ?? 0) * 10) / 10,
    spread_cents: Math.round((snap.spread_cents ?? 0) * 10) / 10,
    leftover_cents: Math.round((snap.leftover_cents ?? 0) * 10) / 10,
    touch_size: Math.round(Number(touch) || 0),
    fee_cents: takerFeeCents(cents),
    build_sha: runningBuildSha(),
    entry_roster: captureEntrySkillRoster(snap, chair, votes, cents, takerFeeCents(cents), runningBuildSha(), takerFeeCents),
  };
  const keys = Object.keys(e.entryState);
  if (keys.length > 12) for (const k of keys.slice(0, keys.length - 12)) delete e.entryState[k];
}

/** One paper position per window, held to settlement. The chair may change
 *  its mind on screen; the ledger does not sell low and buy high for it.
 *  Autopsy of the flip era: 40 of the last 42 logged calls were flips,
 *  41 of 42 positions were sold on a flip, net -83¢ — the left tail was
 *  the churn, not the calls. */
async function noteCall(e: Eng, snap: Snapshot, chair: ChairResult, votes: Vote[]) {
  if (hasPaperPosition(e.riskCalls, snap)) return;
  if (e.lastCall && e.lastCall.ticker === snap.ticker && e.lastCall.close_time === snap.close_time) {
    if (e.lastCall.lean === "UP" || e.lastCall.lean === "DOWN") return; // already positioned: hold
  }
  if (chair.lean !== "UP" && chair.lean !== "DOWN") {
    e.lastCall = { ticker: snap.ticker, close_time: snap.close_time, lean: chair.lean };
    return;
  }
  // S2-10: the final paper-book edge guard. runChair's hard edge gate can be undone
  // downstream — decideChair applies stickLean AFTER it, and stickLean is not
  // edge-aware — so a side the CURRENT edge gate turned to WAIT can still arrive here
  // as a sticky UP/DOWN (it did: KXBTC15M-26SEP110445-45, edge_up -1.6, booked). The
  // paper book — live AND its 70¢ shadow, which differ only by the floor — refuses any
  // fill whose current booking-side edge is non-positive. This runs before the shadow
  // capture so neither book records a fill the edge rejects, keeping the two books
  // separated by the floor alone. It reads the same snap.edge_up/edge_down the Chair's
  // own gate reads (no second formula), books nothing, and mutates nothing — not the
  // Chair read, the shown lean, stickLean, holdScore, thresholds, or history.
  if (!paperBookEdgeOk(snap, chair.lean)) return;
  if (!paperBookTeamOk(chair, chair.lean)) return;
  if (!selectiveBookOk(snap, chair, { calls: e.riskCalls, ready: e.riskReady, start: e.selectiveStart, watch: e.entryWatch })) return;
  const cents = markSide(snap, chair.lean);
  if (!(cents > 0) || !(cents < 100)) return;
  // The 80¢ trial's shadow book: note the first ask this window at which the
  // OLD floor would have filled, before the live floor gets its say. Same
  // decision, same tick, same price — one number recorded, no second engine,
  // and nothing here can change what the live book does below.
  noteShadowFill(e, snap, chair.lean, cents);
  // The book's price floor: the read stands on screen, the fill waits. Nothing
  // is positioned, so a later tick at the floor can still fill this window.
  if (!bookable(cents)) return;
  // The state the desk was in when the book actually paid. The ledger otherwise
  // only remembers the grade frame, so this is the only chance to record it.
  noteEntryState(e, snap, chair, votes, cents);
  const flipped = false;
  e.callLog = [
    {
      id: `${snap.close_time}-${chair.lean}-${snap.as_of}`,
      t: snap.as_of,
      ticker: snap.ticker,
      close_time: snap.close_time,
      lean: chair.lean,
      cents: Math.round(cents * 10) / 10,
      settle: null,
      flipped,
    },
    ...e.callLog,
  ].slice(0, 80);
  e.riskCalls = restoreRiskCalls(e.riskCalls, [e.callLog[0]!]).calls;
  e.lastCall = { ticker: snap.ticker, close_time: snap.close_time, lean: chair.lean };
  // Save the daily reservation before publishing the new call. A restart must not reset its allowance.
  if (!(await persistState(e, true))) {
    e.riskReady = false;
    return;
  }
  notifyCall(chair.lean, Math.round(cents), snap.mins_left, snap.ticker);
}

function settleCallLog(e: Eng, ticker: string, close_time: number, winner: "UP" | "DOWN") {
  e.riskCalls = settleRiskCalls(e.riskCalls, ticker, close_time, winner);
  e.baselineCalls = settleRiskCalls(e.baselineCalls, ticker, close_time, winner);
  e.callLog = e.callLog.map((r) => {
    if (r.settle != null) return r;
    const sameTicker = ticker && r.ticker === ticker;
    const sameClose = close_time > 0 && Math.abs(r.close_time - close_time) < 90_000;
    if (!sameTicker && !sameClose) return r;
    return { ...r, settle: r.lean === winner ? 100 : 0 };
  });
}

/** Observe the same current signal before selective admission. This is never a public call or an order. */
function noteUnfilteredCall(e: Eng, snap: Snapshot, chair: ChairResult) {
  if (snap.close_time - 900_000 < e.selectiveStart || hasPaperPosition(e.baselineCalls, snap)) return;
  if (chair.lean !== "UP" && chair.lean !== "DOWN") return;
  if (!paperBookEdgeOk(snap, chair.lean)) return;
  const cents = markSide(snap, chair.lean);
  if (!bookable(cents)) return;
  const row: CallLogRow = { id: `unfiltered-${snap.close_time}-${snap.as_of}`, t: snap.as_of,
    ticker: snap.ticker, close_time: snap.close_time, lean: chair.lean, cents, settle: null, flipped: false };
  e.baselineCalls = restoreRiskCalls(e.baselineCalls, [row]).calls;
}

function applyEntryMode(e: Eng, snap: Snapshot, chair: ChairResult): ChairResult {
  const result = selectiveChair(snap, chair, {
    calls: e.riskCalls, ready: e.riskReady, start: e.selectiveStart, watch: e.entryWatch,
  });
  e.entryWatch = result.watch;
  return result.chair;
}

/**
 * The settlement that may grade this window, or nothing.
 *
 * Delegates the invariant to window-identity: ticker AND close time must agree,
 * and the ticker's own embedded close must agree too when it parses. The matcher
 * this replaced checked one field at a time — ticker while ignoring the clock,
 * then the clock while ignoring the ticker — which is how one market's result
 * graded nine consecutive windows on 2026-09-10.
 *
 * A contradiction is recorded and alerted; a result that has not arrived yet is
 * the ordinary pending case and stays quiet.
 */
function officialHit(e: Eng, snap: Snapshot, ticker: string, close_time: number) {
  const v = matchSettle(snap.official_settles, ticker, close_time);
  if (v.ok) return v.settle;
  if (isInconsistent(v.fault)) noteIdentityFault(e, ticker, close_time, v.fault, v.detail, v.checks);
  return undefined;
}

/** Record a window whose identity did not hold. Bounded, persisted, alerted once. */
function noteIdentityFault(
  e: Eng,
  ticker: string,
  close_time: number,
  fault: IdentityFault,
  detail: string,
  checks: IdentityChecks,
) {
  const key = `${ticker}|${close_time}|${fault}`;
  if (e.identityFaults.some((f) => f.key === key)) return; // one record per window per fault
  e.identityFaults = [...e.identityFaults, { key, ticker, close_time, fault, detail, checks, at: Date.now() }].slice(
    -IDENTITY_FAULT_CAP,
  );
  const line = faultLine(ticker, close_time, fault, detail);
  e.learner.settle_tape = [line, ...e.learner.settle_tape].slice(0, 48);
  noteErr(e, "identity", line);
  void persistState(e, true); // forensic state must outlive the process that saw it
}

// Permanent research record: one row per graded window. The columns and their
// values are unchanged from before; only the WRITE became durable — built once
// at grade time, then persisted + verified with idempotent retry off the tick.
const LEDGER_COLUMNS =
  "(ticker, close_time, source, winner, chair_lean, chair_conf, score, bar, sit_mass, " +
  "entry_cents, settle_cents, ev_cents, calls, seats, close_dist, close_atr, close_secs, " +
  "settle_avg, settle_last, brti_prints, settle_gap, fair_pre, rule_avg_ok, rule_last_ok, " +
  "settle_feed, settle_feed_n, official_value, shadow_entry_cents, shadow_ev_cents, " +
  "entry_regime, entry_secs_left, entry_conf, entry_score, entry_bar, entry_fair_yes, " +
  "entry_spread_cents, entry_leftover_cents, entry_touch_size, entry_fee_cents, " +
  "entry_lean, entry_build_sha, skill_score_audit, entry_skill_roster, entry_skill_quality)";
const LEDGER_INSERT =
  `insert into desk_ledger ${LEDGER_COLUMNS} values ` +
  "($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29," +
  "$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42::jsonb,$43::jsonb,$44::jsonb) " +
  "on conflict (ticker, close_time) do nothing";

/** Build one graded window's ledger row synchronously, at grade time, from the
 *  state as it is right now — so a later retry records exactly what was decided,
 *  never a recomputation against drifted state. No DB, cannot fail. */
/** The 80¢ trial's shadow row: what the old 70¢ floor would have made on this
 *  window. Entry was captured live during the window; the outcome is known now.
 *  Research only — it is not added to any live total. */
function shadowBits(e: Eng, snap: Snapshot, finish: "UP" | "DOWN"): { entry: number | null; ev: number | null } {
  const key = windowKey(snap);
  const sh = e.shadowFills[key];
  delete e.shadowFills[key];
  if (!sh) return { entry: null, ev: null };
  const settle = sh.lean === finish ? 100 : 0;
  const ev = Math.round((settle - sh.cents - takerFeeCents(sh.cents)) * 10) / 10;
  return { entry: sh.cents, ev };
}

function buildLedgerRow(e: Eng, snap: Snapshot, votes: Vote[], chair: ChairResult, finish: "UP" | "DOWN", source: string, scoreAudit: SkillScoreAudit | null = null): LedgerRow {
  const official = snap.official_settles.find((o) => o.ticker === snap.ticker && o.value != null)?.value ?? null;
  const rc = labSettleReceipt(snap.ticker, snap.close_time, snap.strike, finish, official);
  const shadow = shadowBits(e, snap, finish);
  const entryKey = windowKey(snap);
  const entry = e.entryState[entryKey] ?? null;
  const booked = bookedDecisionAtGrade(e.callLog, snap.ticker, snap.close_time, entry);
  delete e.entryState[entryKey];
  const rows = e.callLog.filter((r) => r.ticker === snap.ticker && Math.abs(r.close_time - snap.close_time) < 90_000);
  const first = rows[rows.length - 1] ?? null; // call log is newest-first
  let ev: number | null = null;
  if (rows.length) {
    ev = 0;
    for (const r of rows) {
      if (r.settle == null) continue;
      ev += r.settle - r.cents - takerFeeCents(r.cents);
    }
    ev = Math.round(ev * 10) / 10;
  }
  const seats: Record<string, { lean: string; conf: number; hit: boolean | null; raw_lean: string; raw_conf: number }> = {};
  for (const v of votes) {
    if (v.seat === "WARDEN") continue;
    seats[v.seat] = {
      lean: v.lean,
      conf: v.confidence,
      hit: v.lean === "UP" || v.lean === "DOWN" ? v.lean === finish : null,
      raw_lean: v.raw_lean ?? v.lean,
      raw_conf: v.raw_conf ?? v.confidence,
    };
  }
  const values: unknown[] = [
    snap.ticker,
    new Date(snap.close_time).toISOString(),
    source,
    finish,
    chair.lean,
    chair.confidence,
    chair.score,
    chair.bar,
    chair.sit_mass,
    first?.cents ?? null,
    first?.settle ?? null,
    ev,
    rows.length,
    JSON.stringify(seats),
    snap.spot > 0 && snap.strike > 0 ? snap.spot - snap.strike : null,
    snap.atr > 0 ? snap.atr : null,
    snap.secs_left,
    rc.settle_avg,
    rc.settle_last,
    rc.brti_prints || null,
    rc.settle_gap,
    rc.fair_pre,
    rc.rule_avg_ok,
    rc.rule_last_ok,
    rc.settle_feed,
    rc.settle_feed_n,
    rc.official_value,
    shadow.entry,
    shadow.ev,
    entry?.regime ?? null,
    entry?.secs_left ?? null,
    entry?.conf ?? null,
    entry?.score ?? null,
    entry?.bar ?? null,
    entry?.fair_yes ?? null,
    entry?.spread_cents ?? null,
    entry?.leftover_cents ?? null,
    entry?.touch_size ?? null,
    entry?.fee_cents ?? null,
    booked?.lean ?? null,
    booked?.build_sha ?? null,
    scoreAudit == null ? null : JSON.stringify(scoreAudit),
    booked && entry?.entry_roster && entry.entry_roster.ticker === snap.ticker &&
      entry.entry_roster.close_time_ms === snap.close_time && entry.entry_roster.side === booked.lean
      ? JSON.stringify(entry.entry_roster) : null,
    booked && entry?.entry_roster && entry.entry_roster.ticker === snap.ticker &&
      entry.entry_roster.close_time_ms === snap.close_time && entry.entry_roster.side === booked.lean &&
      isCountable(snap.close_time)
      ? (() => { const quality = evaluateEntrySkillQuality(entry.entry_roster, finish, source);
          return quality == null ? null : JSON.stringify(quality); })() : null,
  ];
  return { ticker: snap.ticker, close_time: snap.close_time, values };
}

/** The idempotent upsert + read-back verify a durable write needs. */
function ledgerIO(db: Sql): PersistIO {
  return {
    write: async (r) => {
      await db.query(LEDGER_INSERT, withEntrySkillQualityColumn(withEntrySkillRosterColumn(withSkillAuditColumn(r.values))));
    },
    verify: async (r) => {
      const rows = await db.query<{ n: number }>(
        "select 1 as n from desk_ledger where ticker = $1 and close_time = $2 limit 1",
        [r.ticker, new Date(r.close_time).toISOString()],
      );
      return rows.length > 0;
    },
  };
}

const LEDGER_DRAIN_MAX = 20;

/** Drain the persist queue: for each due window, write + verify with backoff.
 *  A verified write advances the recorded-window clock and clears the job; a
 *  failure keeps the window queued (so it recovers when the DB returns) and
 *  keeps its error detail. Never throws, never blocks a window from being
 *  re-attempted, and off the decision path entirely. */
async function flushLedger(e: Eng): Promise<void> {
  if (e.ledgerFlushing || !e.ledgerQueue.length) return;
  e.ledgerFlushing = true;
  try {
    const db = await sql();
    const io = ledgerIO(db);
    const start = Date.now();
    const due = e.ledgerQueue.filter((j) => j.nextAt <= Date.now()).slice(0, LEDGER_DRAIN_MAX);
    for (const j of due) {
      if (Date.now() - start > 20_000) break; // bound one drain even if the DB is timing out every op
      const out = await persistOnce(j, io, Date.now());
      const res = afterPersist(e.ledgerQueue, out);
      e.ledgerQueue = res.queue;
      if (res.verified) e.lastLedgerOkAt = Date.now();
      else noteErr(e, "ledger", `${j.key} · ${out.job.lastErr ?? "retry"} (attempt ${out.job.attempts})`);
    }
  } catch (err) {
    noteErr(e, "ledger flush", err instanceof Error ? err.message : String(err));
  } finally {
    e.ledgerFlushing = false;
  }
}

const DIGEST_CHECK_MS = 15 * 60_000;

/** Yesterday (Chicago) on the floor, posted to the board once, old digests pruned. */
async function maybeDigest(e: Eng) {
  if (Date.now() - e.lastDigestCheckAt < DIGEST_CHECK_MS) return;
  e.lastDigestCheckAt = Date.now();
  try {
    const db = await sql();
    const agg = await db<{ day: string; windows: number; calls: number; wins: number; net_ev: number | null; floored: number }>`
      select
        to_char((now() at time zone 'America/Chicago')::date - 1, 'YYYY-MM-DD') as day,
        count(*)::int as windows,
        (count(*) filter (where entry_cents is not null))::int as calls,
        (count(*) filter (where entry_cents is not null and ev_cents > 0))::int as wins,
        coalesce(sum(ev_cents), 0) as net_ev,
        (count(*) filter (where chair_lean in ('UP','DOWN') and entry_cents is null))::int as floored
      from desk_ledger_research
      where (close_time at time zone 'America/Chicago')::date
          = (now() at time zone 'America/Chicago')::date - 1
    `;
    const a = agg[0];
    if (!a || !a.windows) return;
    const dayRows = await db<{ seats: Record<string, { hit?: boolean | null }> }>`
      select seats from desk_ledger_research
      where (close_time at time zone 'America/Chicago')::date
          = (now() at time zone 'America/Chicago')::date - 1
    `;
    const tally: Record<string, { n: number; hits: number }> = {};
    for (const row of dayRows) {
      if (!row.seats || typeof row.seats !== "object") continue;
      for (const [seat, s] of Object.entries(row.seats)) {
        if (s?.hit == null) continue;
        const t = (tally[seat] ??= { n: 0, hits: 0 });
        t.n += 1;
        t.hits += s.hit ? 1 : 0;
      }
    }
    const ranked = Object.entries(tally)
      .filter(([, t]) => t.n >= 3)
      .sort((x, y) => y[1].hits / y[1].n - x[1].hits / x[1].n);
    const best = ranked[0];
    const worst = ranked[ranked.length - 1];
    const net = Number(a.net_ev) || 0;
    const bits = [
      `${a.day} on the floor: ${a.windows} windows graded`,
      a.calls
        ? `${a.calls} call${a.calls === 1 ? "" : "s"} (${a.wins}W/${a.calls - a.wins}L), net ${net >= 0 ? "+" : ""}${net.toFixed(1)}¢ after fees`
        : "no fills — the council sat",
    ];
    if (a.floored) {
      bits.push(`${a.floored} read${a.floored === 1 ? "" : "s"} held under the ${CHAIR_MIN_ASK_CENTS}¢ floor`);
    }
    if (best && worst && best[0] !== worst[0]) {
      bits.push(`best seat ${best[0]} ${best[1].hits}/${best[1].n}, toughest ${worst[0]} ${worst[1].hits}/${worst[1].n}`);
    }
    await digestV2Bits(bits);
    const arenaLine = await arenaDigestLine();
    if (arenaLine) bits.push(arenaLine);
    const sweepLine = await sweepRun(e.learner);
    if (sweepLine) bits.push(sweepLine);
    const ledgerLine = await ledgerRun();
    if (ledgerLine) bits.push(ledgerLine);
    // Leave room for the whole recap. At 400 the last bit (usually LEDGER's
    // read) was clipped mid-word; the lab recap below already uses 900.
    const body = bits.join(" · ").slice(0, 900);
    await db`
      insert into board (who, body, kind, lean, ticker, conf, slug)
      values ('DESK', ${body}, 'update', '', '', 0, ${`digest-${a.day}`})
      on conflict (slug) do nothing
    `;
    // The lab's recap is its own post so neither one truncates the other.
    const labBits: string[] = [];
    await labDigestBits(labBits);
    if (labBits.length) {
      const labBody = `${a.day} in the lab: ${labBits.join(" · ")}`.slice(0, 900);
      await db`
        insert into board (who, body, kind, lean, ticker, conf, slug)
        values ('DESK', ${labBody}, 'update', '', '', 0, ${`lab-${a.day}`})
        on conflict (slug) do nothing
      `;
    }
    // Sunday morning: the week that ended Saturday, once.
    await weeklyRecap(db, a.day).catch((err: unknown) => {
      e.lastError = `recap: ${err instanceof Error ? err.message : String(err)}`;
    });
    await db`
      delete from board
      where kind = 'update' and (slug like 'digest-%' or slug like 'lab-%')
        and created_at < now() - interval '14 days'
    `;
    await pruneReplays();
    // COACH's one decision per seat per day, after the day is scored.
    const coached = await coachRun(e.learner);
    if (coached.length) void persistState(e, true);
  } catch (err) {
    e.lastError = `digest: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function applyGrade(
  e: Eng,
  snap: Snapshot,
  votes: Vote[],
  chair: ChairResult,
  finish: "UP" | "DOWN",
  source: string,
): Promise<void> {
  // A window teaches once, ever. The ledger dedupes its own row with ON CONFLICT,
  // but the learner has no such protection: a second call would settle scalps and
  // advance streak state a second time from one result. Ordering alone is not
  // enough to rely on — any future path that resolves a window twice, or a
  // restore that races a persist, would teach twice — so the decision is recorded
  // rather than inferred, and it is persisted so it survives the process.
  const key = jobKey(snap.ticker, snap.close_time);
  if (e.gradedKeys.includes(key)) {
    noteErr(e, "grade", `${key} already graded — second attempt ignored (${source})`);
    return;
  }
  e.gradedKeys = [...e.gradedKeys, key].slice(-GRADED_KEY_CAP);
  e.lastGradeAt = Date.now();
  // Measurement only: freeze the actual inputs before grading, then compare
  // actual increments before reviewSeats can change a skill's status.
  let scoreAudit = beginSkillScoreAudit(e.learner, snap, votes, finish, {
    countable: isCountable(snap.close_time), source, build_sha: runningBuildSha(), graded_at: e.lastGradeAt,
  });
  // S2-9: a research-quality-invalid window (e.g. the quarantined 2026-09-10 stale-ticker
  // block) must not teach the online learner. The learner is taught by three calls here —
  // gradeWindow (seat_n/seat_hits/seat_recent/fade/skills/graded_windows/chair record),
  // settleAll (scalp calibration) and reviewSeats — so a single gate at this boundary is the
  // only non-scattered way to skip EVERY learner mutation for an invalid window. The check is
  // the canonical registry on the window's own close time — the same identity
  // desk_ledger_research / isCountable key on; no QTY_FIX/era cutoff. Prospective only: no
  // persisted learner state is touched, and the ledger row below is still enqueued so the
  // quarantined record is preserved — the row stays, it simply earns no learner credit.
  if (isCountable(snap.close_time)) {
    e.learner.settle_tape = e.learner.settle_tape.filter((l) => !l.startsWith("PENDING "));
    const gr = gradeWindow(e.learner, snap, votes, chair, finish);
    e.learner = gr.learner;
    scoreAudit = finishSkillScoreAudit(scoreAudit, e.learner);
    settleAll(e.learner, finish);
    reviewSeats(e.learner);
    if (e.learner.settle_tape[0]) e.learner.settle_tape[0] = `${e.learner.settle_tape[0]} · ${source}`;
  } else {
    scoreAudit = finishSkillScoreAudit(scoreAudit, e.learner);
  }
  settleCallLog(e, snap.ticker, snap.close_time, finish);
  // Enqueue the ledger row (built now, from this window's state) for a durable,
  // verified write off the tick. lastLedgerOkAt only advances once it lands.
  e.ledgerQueue = enqueueLedger(e.ledgerQueue, buildLedgerRow(e, snap, votes, chair, finish, source, scoreAudit), Date.now());
  void gradeV2(e, snap, finish);
  void gradeTaker(e, snap, finish); // shadow seat, recorded only — no chair/learner effect
  const booked = e.callLog.find((r) => r.ticker === snap.ticker && Math.abs(r.close_time - snap.close_time) < 90_000);
  const chairBits =
    booked && booked.settle != null
      ? { entry: booked.cents, settle: booked.settle, ev: Math.round((booked.settle - booked.cents - takerFeeCents(booked.cents)) * 10) / 10 }
      : null;
  void settleHumanCalls(snap.ticker, finish).then((rows) =>
    notifySettle(snap.ticker, finish, chairBits, new Map(rows.map((r) => [r.token, r.cents]))),
  );
  // THE EXIT ARENA READS THE REPLAY BEFORE PERSISTENCE CONSUMES IT.
  //
  // `recordReplay` below removes the graded window's buffer with `series.take`, which
  // runs SYNCHRONOUSLY before its first `await` — so by the time the exit-arena block
  // further down calls `replayLive`, the buffer is already gone and it reads null. That
  // ordering silently lost every graded Chair-filled window's exit-policy measurement
  // (desk_policy_observations sat at zero). So the arena's view is captured here, from
  // the exact (ticker, close_time) buffer, WHILE IT STILL EXISTS — and `recordReplay`
  // remains the single destructive consumer.
  //
  // `pointsFromReplay` is the same transform the arena already applied; running it now,
  // synchronously and before any await, snapshots an immutable path that the take()
  // below cannot pull out from under it. Only for a booked position, and only when this
  // exact window has a replay — no neighbour, no fallback, no fabrication.
  const exitReplayPath =
    booked && booked.cents > 0
      ? (() => {
          const s = replayLive(snap.ticker, snap.close_time);
          return s ? pointsFromReplay(s.cols) : null;
        })()
      : null;
  // The window this grade belongs to, by both halves: applyGrade has already put
  // this close through the identity invariant, so it is the one the buffer is keyed
  // on. A ticker alone could name another close during a frozen feed.
  void recordReplay(snap.ticker, snap.close_time, finish).catch((err) => {
    e.lastError = `replay: ${err instanceof Error ? err.message : String(err)}`;
  });
  // WHALE 2.0's prospective absorption sample. Measured now, at settle, because
  // what a print did is a question about the sixty seconds after it — and
  // written with the outcome already known, so the row is complete or absent
  // rather than half-filled and waiting.
  void (async () => {
    const rows = whalePrintRecords(snap.ticker, snap.close_time);
    if (!rows.length) return;
    await recordPrints(rows, finish);
    // Only once the write has come back: a read followed by a failed write must
    // not be the thing that loses the data.
    forgetWhaleWindow(snap.ticker);
  })().catch((err) => {
    e.lastError = `absorption: ${err instanceof Error ? err.message : String(err)}`;
  });
  // THE LAB's exit competition. Every frozen exit policy is handed the one real
  // paper fill — same entry by construction — and measured against the replay's
  // executable bids. Research only: the rows go to their own table, vote nothing,
  // and promote nothing. A window the chair sat out writes nothing, because there
  // is no position to exit.
  void (async () => {
    // The path was captured above, before recordReplay consumed the buffer. A null
    // means no booked position or no replay for this exact window — either way, nothing
    // to measure and nothing written.
    if (!exitReplayPath || !booked || !(booked.cents > 0)) return;
    const champion = await activeChampion();
    await recordExitArena(
      {
        ticker: snap.ticker,
        closeMs: snap.close_time,
        winner: finish,
        entry: { side: booked.lean, cents: booked.cents, t: booked.t },
        path: exitReplayPath,
      },
      { ...champion, prospective_start_at: new Date(Math.max(Date.parse(champion.prospective_start_at), e.selectiveStart)).toISOString() },
    );
  })().catch((err) => {
    e.lastError = `lab: ${err instanceof Error ? err.message : String(err)}`;
  });
  if (windowsHuddleDue(e.learner) || chicagoHuddleDue(e.learner.last_huddle)) {
    e.learner = runHuddle(e.learner).learner;
  }
  e.learner.window_memory.entry_spot = 0;
  // This is the durability boundary for the learner claim and ledger outbox.
  // Await it: a deploy after grading must not terminate the process while the
  // only copy of the completed window is still an unobserved promise.
  await persistState(e, true);
}

function markPending(e: Eng, snap: Snapshot) {
  const hhmm = new Date(snap.close_time).toISOString().slice(11, 16);
  const line = `PENDING ${hhmm} ${snap.ticker} · awaiting Kalshi result — bots not taught`;
  e.learner.settle_tape = [line, ...e.learner.settle_tape.filter((l) => !l.startsWith("PENDING "))].slice(0, 48);
}

async function resolvePending(e: Eng, snap: Snapshot): Promise<void> {
  if (!e.pending.length) return;
  // Every pending window whose official result has arrived grades now; the rest
  // stay pending. Resolving one can no longer drop the others (the G5 fix).
  const { resolved, remaining } = partitionResolved(e.pending, (p) => Boolean(officialHit(e, snap, p.ticker, p.close_time)));
  if (!resolved.length) return;
  e.pending = remaining;
  for (const p of resolved) {
    const hit = officialHit(e, snap, p.ticker, p.close_time);
    if (hit) await applyGrade(e, p.snap, p.votes, p.chair, hit.lean, "kalshi-result");
  }
}

function gradeableBook(snap: Snapshot): boolean {
  if (snap.chalk || snap.leftover_cents > 12) return false;
  return !(snap.health.spot === "DOWN" && snap.health.kalshi === "DOWN");
}

function noteGradeCand(e: Eng, snap: Snapshot, votes: Vote[], chair: ChairResult) {
  if (e.gradeCand && e.gradeCand.snap.close_time !== snap.close_time) e.gradeCand = null;
  if (gradeableBook(snap)) e.gradeCand = { snap, votes, chair };
}

function gradeSource(e: Eng, snap: Snapshot, votes: Vote[], chair: ChairResult) {
  if (!gradeableBook(snap) && e.gradeCand && e.gradeCand.snap.close_time === snap.close_time) return e.gradeCand;
  return { snap, votes, chair };
}

/** Boot recovery is used only by settlement, never as a fresh feed or Chair read. */
function previousDecision(e: Eng) {
  if (e.prevSnap && e.lastChair) return { snap: e.prevSnap, votes: e.lastVotes, chair: e.lastChair };
  const saved = e.recoveredWindow;
  if (saved) {
    // Keep the last live-book candidate if the first resumed tick is chalk.
    if (!e.gradeCand && gradeableBook(saved.snap)) e.gradeCand = saved;
    return { snap: saved.snap, votes: saved.votes, chair: saved.chair };
  }
  return { snap: e.prevSnap, votes: e.lastVotes, chair: e.lastChair };
}

/** A window settles on a death tick (≤0.4s left) or — the common case with a
 *  4s poll against a 3s bundle cache — on ROLLOVER: the first tick whose
 *  close_time moved past the previous window. Without the rollover path,
 *  grading depends on a tick landing inside the final 400ms, which is luck. */
async function settleIfNeeded(
  e: Eng,
  snap: Snapshot,
  votes: Vote[],
  chair: ChairResult,
  prev: { snap: Snapshot | null; votes: Vote[]; chair: ChairResult | null },
): Promise<void> {
  await resolvePending(e, snap);
  const rolled = Boolean(
    prev.snap &&
      prev.chair &&
      snap.close_time !== prev.snap.close_time &&
      prev.snap.close_time <= snap.as_of + 60_000,
  );
  const deathTick = snap.secs_left <= 0.4;
  if (!deathTick && !rolled) return;
  const w = rolled
    ? { ticker: prev.snap!.ticker, close_time: prev.snap!.close_time }
    : { ticker: snap.ticker, close_time: snap.close_time };
  if (e.lastClose === w.close_time) return;
  e.lastClose = w.close_time;
  let s: { snap: Snapshot; votes: Vote[]; chair: ChairResult };
  if (rolled) {
    s =
      e.gradeCand && e.gradeCand.snap.close_time === w.close_time
        ? e.gradeCand
        : { snap: prev.snap!, votes: prev.votes, chair: prev.chair! };
  } else {
    s = gradeSource(e, snap, votes, chair);
  }
  const hit = officialHit(e, snap, w.ticker, w.close_time);
  if (hit) {
    // Leave pending BEFORE grading, never after: applyGrade force-persists at its
    // end, so removing afterwards wrote a state where an already-graded window
    // was still waiting. A crash in that gap re-graded it on the next boot.
    e.pending = removeKeyed(e.pending, w.ticker, w.close_time); // clear only this window, not others
    await applyGrade(e, s.snap, s.votes, s.chair, hit.lean, "kalshi-result");
    return;
  }
  e.pending = addKeyed(
    e.pending,
    { ticker: w.ticker, close_time: w.close_time, snap: s.snap, votes: s.votes, chair: s.chair },
    PENDING_CAP,
  );
  markPending(e, s.snap);
  // A deploy can land in the seconds between rollover and Kalshi's result.
  // This await is what makes pending recovery real rather than best-effort: the
  // exact decision is in desk_state before this settlement boundary completes.
  await persistState(e, true);
}

async function liveSnap(e: Eng): Promise<Snapshot> {
  const bundle = await loadBundle();
  if ((bundle.funding_series?.length ?? 0) >= 2) {
    e.liveHist.funding = bundle.funding_series;
  } else if (bundle.funding_rate != null && bundle.funding_time) {
    e.liveHist.funding = appendPeriod(
      e.liveHist.funding,
      bundle.funding_time,
      bundle.funding_rate,
      nativePeriodMs(e.liveHist.funding, FUNDING_PERIOD_MS),
    );
    bundle.funding_series = e.liveHist.funding;
    bundle.funding_history = e.liveHist.funding.map((p) => p.v);
  }
  if ((bundle.oi_series?.length ?? 0) >= 2) {
    e.liveHist.oi = bundle.oi_series;
  } else if (bundle.open_interest != null) {
    e.liveHist.oi = appendPeriod(e.liveHist.oi, bundle.as_of, bundle.open_interest, OI_PERIOD_MS);
    bundle.oi_series = e.liveHist.oi;
    bundle.oi_history = e.liveHist.oi.map((p) => p.v);
  }
  if ((bundle.oi_usd_series?.length ?? 0) >= 2) {
    e.liveHist.oiUsd = bundle.oi_usd_series;
  } else if (bundle.oi_usd != null) {
    e.liveHist.oiUsd = appendPeriod(e.liveHist.oiUsd, bundle.as_of, bundle.oi_usd, OI_PERIOD_MS);
    bundle.oi_usd_series = e.liveHist.oiUsd;
  }
  return attachLab(bundleToSnapshot(bundle, e.learner.window_memory, e.prevSnap));
}

/** The lab's settlement-rule fair value rides on the snapshot so INDEX reads it like any seat reads a feed. */
function attachLab(snap: Snapshot): Snapshot {
  const f = labFairState(snap.ticker);
  snap.lab_fair_yes = f ? f.yes_cents : null;
  snap.lab_locked = f ? f.locked : 0;
  snap.lab_age_s = f ? f.age_s : 999;
  snap.lab_settle_avg = f ? f.settle_avg : null;
  return snap;
}

/**
 * S2-5: hand the already-finalized decision pair to the research writer.
 *
 * Capture is synchronous, so the row is THIS tick's `(snap, chair)` and never a
 * later fill, grade, or quote. The write is fire-and-forget: a failing shadow
 * write is routed to the durable error ring (noteErr), never thrown into the
 * tick, and reads nothing back into the Chair or the paper book.
 */
let lastDecisionIdentityKey = "";

function noteDecisionSnapshot(e: Eng, snap: Snapshot, chair: ChairResult): void {
  // Window-identity guard (see decision-snapshot-writer). At a rollover the close
  // advances to the next window before the feed's ticker catches up, so this tick
  // can carry (stale ticker, new close) — the same contradiction matchSettle fails
  // closed on. tickerAgrees === false means the ticker's embedded close positively
  // disagrees with the row's close; skip the measurement and leave a deduplicated
  // breadcrumb. `null` (unparseable) is NOT refused. The Chair, seats and paper book
  // are untouched — this returns out of the helper, not the tick.
  if (tickerAgrees(snap.ticker, snap.close_time) === false) {
    const key = `${snap.ticker}|${snap.close_time}`;
    if (key !== lastDecisionIdentityKey) {
      lastDecisionIdentityKey = key;
      noteErr(e, "decision-snapshot-identity", "ticker-close-time-mismatch");
    }
    return;
  }
  void observeChairWaitMilestone(snap, chair, e.callLog).catch(() => {});
  try {
    const row = decisionSnapshotFrom(snap, chair);
    void recordDecisionSnapshot(row).catch((err) => {
      noteErr(e, "decision-snapshot", err instanceof Error ? err.message : String(err));
    });
  } catch (err) {
    noteErr(e, "decision-snapshot", err instanceof Error ? err.message : String(err));
  }
}

async function tick(e: Eng) {
  if (e.inFlight) return;
  e.inFlight = true;
  try {
    void maybeDigest(e);
    if (chicagoHuddleDue(e.learner.last_huddle)) {
      e.learner = runHuddle(e.learner).learner;
    }
    const snap = await liveSnap(e);
    if (!e.learner.window_memory.entry_spot) e.learner.window_memory.entry_spot = snap.spot;
    e.learner.window_memory.path_since_entry = [
      ...e.learner.window_memory.path_since_entry,
      snap.spot - e.learner.window_memory.entry_spot,
    ].slice(-120);
    const votes = stickyVotes(e, runBots(snap, e.learner), snap);
    for (const v of votes) {
      if (v.seat === "WARDEN") continue;
      onLean(e.learner, v.seat, v.lean, snap);
    }
    const rawChair = decideChair(e, votes, snap, lastSide(e, snap));
    noteUnfilteredCall(e, snap, rawChair);
    const chair = applyEntryMode(e, snap, rawChair);
    // S2-5: capture the Chair's decision-time market state from THIS exact
    // finalized (snap, chair) pair, synchronously, the instant the read exists and
    // BEFORE the paper-fill path (noteCall) or any later grade can stand in for it.
    // The write is non-blocking and measurement-only; it reads nothing back into
    // the decision and cannot change what the Chair said or whether the book fills.
    noteDecisionSnapshot(e, snap, chair);
    onLean(e.learner, CHAIR_SCALP, chair.lean, snap);
    await noteCall(e, snap, chair, votes);
    noteReplay(snap, votes, chair, e.callLog.some((r) => r.ticker === snap.ticker), labFairNow(snap.ticker));
    // Hand the lab this tick's window state so a print landing between ticks
    // carries real context, with its own staleness recorded. Research only.
    noteDeskState({
      t: snap.as_of,
      // seatEvidence is the same converter desk_samples stores, so the
      // absorption study's DRIFT and CASCADE bands line up with the ones the
      // seat-signal study already uses rather than being a second scale.
      drift: seatEvidence(votes.find((v) => v.seat === "DRIFT")),
      cascade: seatEvidence(votes.find((v) => v.seat === "CASCADE")),
      regime: snap.regime_key,
      fair_yes: snap.fair_yes,
      dist: readClock(snap).dist,
      sigma: readClock(snap).sigma,
    });
    noteV2(e, snap, votes, chair);
    noteTaker(e, snap, chair);
    notePathParity(e, snap, chair);
    // Settle BEFORE rolling the grade candidate and prev pointers: on a window
    // rollover the OLD window grades from its own last live-book tick.
    const prev = previousDecision(e);
    await settleIfNeeded(e, snap, votes, chair, prev);
    noteGradeCand(e, snap, votes, chair);
    if (!e.learner.window_memory.entry_lean && chair.lean !== "WAIT") {
      e.learner.window_memory.entry_lean = chair.lean;
    }
    e.prevSnap = snap;
    e.lastVotes = votes;
    e.lastChair = chair;
    e.recoveredWindow = null;
    e.lastError = null;
    e.lastTickAt = Date.now();
    await persistState(e);
    void flushLedger(e); // off the tick's critical path — a slow DB must never wedge grading
  } catch (err) {
    e.lastError = err instanceof Error ? err.message : String(err);
    e.lastTickAt = Date.now();
  } finally {
    e.inFlight = false;
  }
}

// ---------------------------------------------------------------------------
// PATH PARITY (shadow, measurement only): what the desk's index-based d30/d60/d120
// read versus what the clock says, recorded side by side.
//
// The offsets are labelled as seconds but indexed into an array whose slots are
// normally ONE MINUTE of Kalshi candle. `back` slots back crosses `back - 1` gaps, so
// "d60" typically spans FIVE minutes, not six and not sixty seconds. Nothing here
// changes that. It writes both readings, the reason each is what it is, and the
// coverage facts, so the decision to migrate the four consumers can rest on a
// distribution instead of an example — and so that migrating, which would redefine
// every calibration record fitted against the old numbers, stays an explicit decision
// with its own research-era boundary.
//
// Strictly one-way: `recordPathParity` returns void, so there is no result for this
// tick to branch on. No seat, threshold, Chair input, learned weight or skill status
// reads any of it.
// ---------------------------------------------------------------------------

/**
 * The window-minute last written, so the tick loop does not re-insert on every pass.
 * The loop runs at `pollMs` — 4s normally, 2.5s in beast — so that would otherwise be
 * 15 to 24 redundant sample-sets a minute.
 *
 * Process-local on purpose: it is an efficiency guard, not the correctness guarantee.
 * Correctness is the deterministic sample key plus ON CONFLICT DO NOTHING, which also
 * survives a restart mid-minute.
 */
let lastParityBucket = "";

function notePathParity(e: Eng, snap: Snapshot, chair: ChairResult) {
  try {
    const bucket = sampleKey(snap.ticker, snap.close_time, snap.as_of, "all");
    if (bucket === lastParityBucket) return;
    lastParityBucket = bucket;
    // `.catch` is not decoration: `recordPathParity` is async, so anything it throws
    // BEFORE its own try block would reject this floating promise and surface as an
    // unhandled rejection rather than as a caught error. Same idiom as recordReplay.
    void recordPathParity({
      ticker: snap.ticker,
      closeMs: snap.close_time,
      atMs: snap.as_of,
      path: snap.yes_mid_path,
      points: snap.yes_mid_path_pts,
      candle_ts: snap.candle_ts,
      phase: snap.phase,
      secs_left: snap.secs_left,
      // Context for the research read only. The shadow never writes back to the Chair.
      chair_decision: chair.lean,
    }).catch((err) => {
      noteErr(e, "path-parity", err instanceof Error ? err.message : String(err));
    });
  } catch (err) {
    // A measurement must not be able to disturb the desk it measures. Routed through
    // noteErr rather than `e.lastError =` because the tick clears lastError a few
    // lines later in its own happy path, which would erase the breadcrumb; noteErr
    // also pushes onto the durable error ring, so a failing shadow write is visible
    // instead of only showing up as missing rows.
    noteErr(e, "path-parity", err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// Chair v2 (shadow): one sample per window at the mid-window decision point,
// graded at settle, refit on the ledger, scored against the live chair.
// ---------------------------------------------------------------------------

function noteV2(e: Eng, snap: Snapshot, votes: Vote[], chair: ChairResult) {
  try {
    const f = extractFeatures(votes, snap);
    const p = predictV2(e.v2, f, snap, v2Voice(e.v2Stats));
    const d = decideV2(p, snap);
    e.v2Live = d;
    const key = windowKey(snap);
    if (
      e.v2Sampled !== key &&
      snap.mins_left <= V2_SAMPLE_MINS &&
      snap.mins_left > 2.2 &&
      snap.yes_ask > 0 &&
      gradeableBook(snap)
    ) {
      e.v2Sampled = key;
      void recordV2Sample(e, snap, chair, f, d);
    }
  } catch (err) {
    e.lastError = `v2: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ---------------------------------------------------------------------------
// TAKER (shadow, non-voting): one frozen Kalshi-taker-flow reading per window,
// sampled at the same mid-window point as v2 and graded at settle. Recorded
// ONLY — it never votes and never touches the chair, learner, COACH, thresholds
// or any seat. The ledger judges it prospectively; see src/lib/desk/taker.ts.
// ---------------------------------------------------------------------------

function noteTaker(e: Eng, snap: Snapshot, chair: ChairResult) {
  try {
    const key = windowKey(snap);
    if (e.takerSampled !== key && snap.mins_left <= V2_SAMPLE_MINS && snap.mins_left > 2.2 && snap.yes_ask > 0 && gradeableBook(snap)) {
      e.takerSampled = key;
      void recordTaker(e, snap, chair);
    }
  } catch (err) {
    e.lastError = `taker: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function recordTaker(e: Eng, snap: Snapshot, chair: ChairResult) {
  try {
    const call = takerSignal(snap.kalshi_taker_yes, snap.kalshi_trade_n);
    const entry = call.lean === "UP" ? snap.yes_ask : call.lean === "DOWN" ? snap.no_ask : null;
    const db = await sql();
    await db`
      insert into desk_taker
        (ticker, close_time, mins_left, taker_yes, trade_n, eligible, lean, conf, imbalance, chair_lean, regime, entry_cents)
      values
        (${snap.ticker}, ${new Date(snap.close_time).toISOString()}, ${snap.mins_left},
         ${snap.kalshi_taker_yes}, ${snap.kalshi_trade_n}, ${call.eligible}, ${call.lean}, ${call.conf},
         ${call.imbalance}, ${chair.lean}, ${snap.regime_key ?? ""}, ${entry ?? null})
      on conflict (ticker, close_time) do nothing
    `;
  } catch (err) {
    e.lastError = `taker sample: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function gradeTaker(e: Eng, snap: Snapshot, finish: "UP" | "DOWN") {
  try {
    const db = await sql();
    const rows = await db<{ id: number; lean: string; entry_cents: number | null }>`
      select id, lean, entry_cents from desk_taker
      where ticker = ${snap.ticker} and winner is null
        and abs(extract(epoch from (close_time - ${new Date(snap.close_time).toISOString()}::timestamptz))) < 90
      limit 1
    `;
    const row = rows[0];
    if (!row) return;
    const ev = takerEvCents(row.lean as Lean, row.entry_cents, finish, takerFeeCents);
    await db`update desk_taker set winner = ${finish}, ev_cents = ${ev}, graded_at = now() where id = ${row.id}`;
  } catch (err) {
    e.lastError = `taker grade: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function recordV2Sample(e: Eng, snap: Snapshot, chair: ChairResult, f: V2Features, d: V2Decision) {
  try {
    const db = await sql();
    const market = JSON.stringify({
      yes_mid: snap.yes_mid,
      yes_ask: snap.yes_ask,
      no_ask: snap.no_ask,
      fair_yes: snap.fair_yes,
      spot: snap.spot,
      strike: snap.strike,
    });
    await db`
      insert into desk_samples (ticker, close_time, mins_left, features, market, v1_lean, v2_p, v2_lean, v2_entry)
      values (${snap.ticker}, ${new Date(snap.close_time).toISOString()}, ${snap.mins_left},
              ${JSON.stringify(f)}::jsonb, ${market}::jsonb, ${chair.lean}, ${d.p_up}, ${d.lean}, ${d.entry_cents})
      on conflict (ticker, close_time) do nothing
    `;
  } catch (err) {
    e.lastError = `v2 sample: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function gradeV2(e: Eng, snap: Snapshot, finish: "UP" | "DOWN") {
  try {
    const db = await sql();
    const rows = await db<{ id: number; v2_lean: string; v2_entry: number | null }>`
      select id, v2_lean, v2_entry from desk_samples
      where ticker = ${snap.ticker} and winner is null
        and abs(extract(epoch from (close_time - ${new Date(snap.close_time).toISOString()}::timestamptz))) < 90
      limit 1
    `;
    const row = rows[0];
    if (!row) return;
    const ev = settleV2(row.v2_lean as Lean, row.v2_entry, finish);
    await db`
      update desk_samples set winner = ${finish}, v2_ev = ${ev}, graded_at = now() where id = ${row.id}
    `;
    void refitV2(e);
  } catch (err) {
    e.lastError = `v2 grade: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function refitV2(e: Eng) {
  if (e.v2Fitting) return;
  if (Date.now() - e.v2LastFitAt < 60_000) return;
  e.v2Fitting = true;
  e.v2LastFitAt = Date.now();
  try {
    const db = await sql();
    // Train on the most recent 3000 RESEARCH-QUALITY-VALID graded samples. desk_samples
    // carries no quality column, so validity is the ledger's research view joined on exact
    // (ticker, close_time) identity — the same population the scoreboard scores on, and the
    // same view the v1 comparison already reads. The join is applied BEFORE the limit, so a
    // known-invalid window can never consume one of the 3000 training slots.
    const rows = await db<{ features: V2Features; winner: string; close_time: string }>`
      select s.features, s.winner, s.close_time from desk_samples s
      join desk_ledger_research l on l.ticker = s.ticker and l.close_time = s.close_time
      where s.winner is not null order by s.close_time desc limit 3000
    `;
    const fitted = fitLogistic(rows.map((r) => ({ x: r.features, y: r.winner === "UP" ? 1 : 0 })));
    if (fitted) {
      // Provenance — metadata only; never read by predictV2. Describes the fit truthfully.
      fitted.population = V2_POPULATION;
      fitted.trained_through = newestTrainedMs(rows.map((r) => r.close_time));
      fitted.features_version = v2FeaturesVersion();
      e.v2 = fitted;
      await persistState(e, true);
    }
    await refreshV2Stats(e);
  } catch (err) {
    e.lastError = `v2 fit: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    e.v2Fitting = false;
  }
}

async function refreshV2Stats(e: Eng) {
  try {
    const db = await sql();
    // Raw sample bookkeeping (not a v1/v2 comparison): how many samples exist and how
    // many are graded. Left over the bare table deliberately.
    const a = await db<{ n_samples: number; n_graded: number }>`
      select count(*)::int as n_samples, count(winner)::int as n_graded from desk_samples
    `;
    // v1 AND v2 metrics over the IDENTICAL research-quality-valid graded population, so the
    // scoreboard compares the two chairs on the same windows. The formulas are unchanged —
    // only eligibility moved: desk_samples carries no quality column, so validity is the
    // ledger's research view joined on exact (ticker, close_time) identity (the join the v1
    // side already used). brier_market is the market's Brier over that same valid population.
    const b = await db<{
      ev_v1: number;
      calls_v1: number;
      brier_v2: number | null;
      brier_market: number | null;
      ev_v2: number;
      calls_v2: number;
    }>`
      select
        coalesce(sum(l.ev_cents), 0) as ev_v1,
        (count(*) filter (where l.calls > 0))::int as calls_v1,
        avg(case when s.v2_p is not null
            then power(s.v2_p - (case when s.winner = 'UP' then 1 else 0 end), 2) end) as brier_v2,
        avg(power((s.market->>'yes_mid')::float / 100 - (case when s.winner = 'UP' then 1 else 0 end), 2)) as brier_market,
        coalesce(sum(s.v2_ev), 0) as ev_v2,
        (count(*) filter (where s.v2_lean in ('UP','DOWN')))::int as calls_v2
      from desk_samples s
      join desk_ledger_research l on l.ticker = s.ticker and l.close_time = s.close_time
      where s.winner is not null
    `;
    const x = a[0];
    if (!x) return;
    const y = b[0];
    e.v2Stats = {
      n_samples: Number(x.n_samples) || 0,
      n_graded: Number(x.n_graded) || 0,
      brier_v2: y?.brier_v2 == null ? null : Number(y.brier_v2),
      brier_market: y?.brier_market == null ? null : Number(y.brier_market),
      ev_v2: Number(y?.ev_v2) || 0,
      ev_v1: Number(y?.ev_v1) || 0,
      calls_v2: Number(y?.calls_v2) || 0,
      calls_v1: Number(y?.calls_v1) || 0,
    };
  } catch (err) {
    e.lastError = `v2 stats: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function v2Frame(e: Eng): V2Frame {
  const top = e.v2
    ? Object.entries(e.v2.w)
        .sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))
        .slice(0, 5)
        .map(([k, v]) => [k, Math.round(v * 100) / 100] as [string, number])
    : [];
  return { live: e.v2Live, weights_n: e.v2?.n ?? 0, fitted_at: e.v2?.fitted_at ?? 0, stats: e.v2Stats, top };
}

/** Yesterday's shadow-chair scoreboard and sharpest seats, for the digest. */
async function digestV2Bits(bits: string[]) {
  try {
    const db = await sql();
    const rows = await db<{ features: V2Features; winner: string; v2_ev: number | null; v2_lean: string; ev_v1: number | null }>`
      select s.features, s.winner, s.v2_ev, s.v2_lean, l.ev_cents as ev_v1
      from desk_samples s
      join desk_ledger_research l on l.ticker = s.ticker and l.close_time = s.close_time
      where s.winner is not null
        and (s.close_time at time zone 'America/Chicago')::date = (now() at time zone 'America/Chicago')::date - 1
    `;
    if (!rows.length) return;
    const ev2 = rows.reduce((t, r) => t + (Number(r.v2_ev) || 0), 0);
    const ev1 = rows.reduce((t, r) => t + (Number(r.ev_v1) || 0), 0);
    const calls2 = rows.filter((r) => r.v2_lean === "UP" || r.v2_lean === "DOWN").length;
    bits.push(
      `shadow chair v2: ${calls2} call${calls2 === 1 ? "" : "s"}, net ${ev2 >= 0 ? "+" : ""}${ev2.toFixed(1)}¢ vs chair ${ev1 >= 0 ? "+" : ""}${ev1.toFixed(1)}¢`,
    );
    const tally: Record<string, { n: number; sum: number }> = {};
    for (const r of rows) {
      const y = r.winner === "UP" ? 1 : 0;
      for (const [k, ev] of Object.entries(r.features)) {
        if (k === "market" || k === "fair" || !ev) continue;
        const t = (tally[k] ??= { n: 0, sum: 0 });
        t.n += 1;
        t.sum += (seatProb(Number(ev)) - y) ** 2;
      }
    }
    const ranked = Object.entries(tally)
      .filter(([, t]) => t.n >= 5)
      .map(([k, t]) => [k, t.sum / t.n] as [string, number])
      .sort((x, y) => x[1] - y[1]);
    if (ranked.length) {
      bits.push(`sharpest seats by Brier: ${ranked.slice(0, 2).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(", ")}`);
    }
    const st = eng().v2Stats;
    if (st) {
      const g = v2Gates(st);
      bits.push(`v2 promotion gate ${g.met}/3: samples ${st.n_graded}/${V2_GATE_SAMPLES} · calls ${st.calls_v2}/${V2_GATE_CALLS} · Brier ${g.brierOk ? "beats" : "trails"} market · net ${st.ev_v2 >= 0 ? "+" : ""}${st.ev_v2.toFixed(0)}¢`);
    }
  } catch {
    /* digest is best-effort */
  }
}

const PULSE_MS = 1_500;
const PULSE_DEMAND_MS = 60_000;
const KALSHI_PULSE_HOST = "https://api.elections.kalshi.com/trade-api/v2";

function pulseCents(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n <= 1.5) return Math.round(n * 100);
  return Math.round(n);
}

async function pulseGet(url: string): Promise<unknown> {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(3_000),
    headers: { accept: "application/json", "user-agent": "SatoshiCouncil/1.0 (paper research)" },
  });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

async function pulseTick(e: Eng) {
  if (e.pulseInFlight) return;
  const now = Date.now();
  if (now - e.lastPulseReqAt > PULSE_DEMAND_MS) return; // nobody watching — don't burn the feeds
  if (now < e.pulseBackoffUntil) return;
  e.pulseInFlight = true;
  try {
    const host = e.prevSnap?.kalshi_host || KALSHI_PULSE_HOST;
    const [cb, mk] = await Promise.allSettled([
      pulseGet("https://api.exchange.coinbase.com/products/BTC-USD/ticker"),
      pulseGet(`${host}/markets?status=open&series_ticker=KXBTC15M&limit=8`),
    ]);
    const spot =
      cb.status === "fulfilled" ? Number((cb.value as { price?: string }).price) : NaN;
    const row =
      mk.status === "fulfilled"
        ? selectOpenKalshiMarket((mk.value as { markets?: Record<string, unknown>[] }).markets)
        : null;
    if (Number.isFinite(spot) && row?.ticker) {
      e.pulse = {
        as_of: Date.now(),
        fetched_at: Date.now(),
        ticker: String(row.ticker),
        spot,
        yes_bid: pulseCents(row.yes_bid_dollars ?? row.yes_bid),
        yes_ask: pulseCents(row.yes_ask_dollars ?? row.yes_ask),
        no_bid: pulseCents(row.no_bid_dollars ?? row.no_bid),
        no_ask: pulseCents(row.no_ask_dollars ?? row.no_ask),
        close_time: Date.parse(String(row.close_time ?? row.expiration_time ?? "")) || 0,
        strike: Number(row.floor_strike ?? 0) || 0,
        stale: false,
      };
      e.pulseFails = 0;
      e.pulseBackoffUntil = 0;
    } else {
      throw new Error(
        cb.status === "rejected" ? `coinbase ${cb.reason}` : mk.status === "rejected" ? `kalshi ${mk.reason}` : "empty",
      );
    }
  } catch {
    e.pulseFails += 1;
    if (e.pulse) e.pulse = { ...e.pulse, fetched_at: Date.now(), stale: true };
    e.pulseBackoffUntil = Date.now() + Math.min(10_000, PULSE_MS * 2 ** Math.min(3, e.pulseFails));
  } finally {
    e.pulseInFlight = false;
  }
}

const PULSE_FRESH_MS = 5_000;

export function getPulse(): DeskPulse | null {
  const e = eng();
  ensureServerEngine();
  e.lastPulseReqAt = Date.now();
  if (!e.pulse) return null;
  // A pulse parked by the demand gate (nobody was watching) or an outage is
  // old data: say so, even though the loop will refresh it within a tick.
  if (!e.pulse.stale && Date.now() - e.pulse.as_of > PULSE_FRESH_MS) {
    return { ...e.pulse, stale: true };
  }
  return e.pulse;
}

function pollMs(e: Eng) {
  return e.settings.beast ? 2_500 : 4_000;
}

function restartTimer(e: Eng) {
  if (e.timer) clearInterval(e.timer);
  e.timer = setInterval(() => void tick(e), pollMs(e));
}

/** Idempotent boot. Safe to call from any route on any request. */
export function ensureServerEngine(): void {
  const e = eng();
  if (e.started) return;
  e.started = true;
  e.startedAt = Date.now();
  e.ready = (async () => {
    await loadState(e);
    await syncUpdates(e);
    void scanLedgerGaps(e); // name any window lost before this boot
    restartTimer(e);
    // The pulse loop's lifecycle lives here and only here — restartTimer
    // (beast toggles) must never double-start it.
    if (!e.pulseTimer) e.pulseTimer = setInterval(() => void pulseTick(e), PULSE_MS);
    if (!e.watchdogTimer) e.watchdogTimer = setInterval(() => watchdogTick(e), WATCHDOG_CHECK_MS);
    void refitV2(e);
    void tick(e);
    try {
      startLab(() => e.prevSnap);
    } catch (err) {
      e.lastError = `lab: ${err instanceof Error ? err.message : String(err)}`;
    }
    void ensureCrewBoot(e.learner);
    void ensureLedgerBoot();
  })().catch((err) => {
    e.lastError = `boot: ${err instanceof Error ? err.message : String(err)}`;
  });
}

const WATCHDOG_CHECK_MS = 60_000;

const GAP_SCAN_MS = 5 * 60_000;

/** Scan the recent ledger for interior holes — a window graded then lost — and
 *  refresh the owner-alert-channel probe. Throttled, best-effort, never throws.
 *  Runs at boot and off the watchdog timer, so it works even if the tick wedges. */
async function scanLedgerGaps(e: Eng): Promise<void> {
  if (Date.now() - e.lastGapScanAt < GAP_SCAN_MS) return;
  e.lastGapScanAt = Date.now();
  try {
    const db = await sql();
    const rows = await db<{ ms: number }>`
      select (extract(epoch from close_time) * 1000)::bigint as ms
      from desk_ledger where close_time > now() - interval '6 hours' order by close_time
    `;
    e.ledgerGapCount = ledgerGaps(rows.map((r) => Number(r.ms)).filter((n) => Number.isFinite(n))).length;
  } catch (err) {
    noteErr(e, "gap scan", err instanceof Error ? err.message : String(err));
  }
  try {
    const { ownerSubCount } = await import("./push.server");
    e.alertOwnerSubs = await ownerSubCount();
  } catch {
    /* alert-channel probe is best-effort */
  }
  await reconcile(e);
}

const RECON_MS = 60 * 60_000;

/** Lightweight periodic reconciliation over a long window, so a silent hole can
 *  never age out of the 6-hour scan undetected. Counts interior holes across 90
 *  days; the first run absorbs any pre-existing history as the baseline, and
 *  only a NEW hole beyond that baseline alerts (once, via a distinct push) — a
 *  graded window cannot vanish unnoticed even hours later. Informational on
 *  /status; it does not flip the status, since old gaps can be legitimate
 *  downtime. Throttled, bounded, best-effort. */
async function reconcile(e: Eng): Promise<void> {
  if (Date.now() - e.reconAt < RECON_MS) return;
  e.reconAt = Date.now();
  try {
    const db = await sql();
    const rows = await db<{ ms: number }>`
      select (extract(epoch from close_time) * 1000)::bigint as ms
      from desk_ledger where close_time > now() - interval '90 days' order by close_time
    `;
    const holes = ledgerGaps(rows.map((r) => Number(r.ms)).filter((n) => Number.isFinite(n)));
    e.reconHoles = holes.length;
    e.reconMissing = holes.slice(-8);
    if (e.reconBaseline == null) {
      e.reconBaseline = holes.length; // first run absorbs existing history silently
    } else if (holes.length > e.reconBaseline) {
      const delta = holes.length - e.reconBaseline;
      e.reconBaseline = holes.length;
      noteErr(e, "reconcile", `${delta} newly-missing ledger window(s); ${holes.length} total over 90d`);
      try {
        const { notifyWatchdog } = await import("./push.server");
        notifyWatchdog({
          title: "Ledger reconciliation",
          body: `${delta} newly-missing window(s) · ${holes.length} total over 90d · see /status`,
          tag: "reconcile",
          url: "/",
        });
      } catch {
        /* push is best-effort */
      }
    }
    // Owner readiness latch: once enough out-of-sample data has accumulated to
    // run the first serious evaluation, ping the owner ONCE (a distinct push).
    // Read-only — it decides nothing; the owner reads the gate in SETTINGS and
    // chooses whether to kick off the eval. Latch is persisted below.
    if (!e.readinessAlerted) {
      try {
        const { readinessReady } = await import("./readiness.server");
        if (await readinessReady()) {
          e.readinessAlerted = true;
          notifyWatchdog({
            title: "Enough data to evaluate",
            body: "The readiness gate passed — open SETTINGS for the copy-paste eval prompt.",
            tag: "readiness",
            url: "/",
          });
        }
      } catch {
        /* readiness probe is best-effort; it never blocks reconciliation */
      }
    }
    void persistState(e, true); // persist the updated baseline + readiness latch
  } catch (err) {
    noteErr(e, "reconcile", err instanceof Error ? err.message : String(err));
  }
}

/** Its own timer, on purpose: a tick loop that is stuck or throwing every
 *  pass is exactly what this has to notice, so it must not live inside it. It
 *  also drains the ledger queue and scans for holes, so persistence keeps
 *  recovering and losses keep being named even while the tick is wedged. The
 *  clock it watches is lastLedgerOkAt — a window durably RECORDED, not merely
 *  calculated — so a silent write failure trips it. */
function watchdogTick(e: Eng) {
  void flushLedger(e);
  void scanLedgerGaps(e);
  try {
    const now = Date.now();
    const d = watchdogDecision({ now, lastGradeAt: e.lastLedgerOkAt, state: e.watchdog });
    if (d.kind === "quiet") return;
    e.watchdog = applyWatchdog(e.watchdog, d, now, e.lastLedgerOkAt);
    const s = e.prevSnap;
    const undeliverable = e.alertOwnerSubs <= 0 ? " · NO OWNER SUBSCRIBER (see /status)" : "";
    notifyWatchdog(
      watchdogPayload(d, {
        lastGradeAt: e.lastLedgerOkAt,
        lastError: `${e.lastError ?? "no error logged"}${undeliverable}`,
        feeds: s ? `spot ${s.health.spot} · kalshi ${s.health.kalshi}` : "no snapshot yet",
        tickAgeS: e.lastTickAt ? Math.round((now - e.lastTickAt) / 1000) : -1,
      }),
    );
  } catch (err) {
    e.lastError = `watchdog: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** The honest deep-health verdict, for the external monitor at GET /status.
 *  Data/engine health flips the 200/503; alert-channel health rides along as a
 *  separate section that never flips the status. */
export async function getHealth(): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const e = eng();
  ensureServerEngine();
  const now = Date.now();
  const v = healthVerdict({
    now,
    started: e.started,
    startedAt: e.startedAt,
    lastTickAt: e.lastTickAt,
    lastLedgerOkAt: e.lastLedgerOkAt,
    queueOldestAgeMs: oldestQueueAgeMs(e.ledgerQueue, now),
    gaps: e.ledgerGapCount,
  });
  let lastSend: string | null = null;
  try {
    const { pushLastLog } = await import("./push.server");
    lastSend = pushLastLog() || null;
  } catch {
    /* best-effort */
  }
  const alerts = alertHealth({ ownerSubs: e.alertOwnerSubs, lastSend });
  const s = e.prevSnap;
  return {
    ok: v.ok,
    status: v.ok ? 200 : 503,
    body: {
      ok: v.ok,
      reasons: v.reasons,
      tick_age_s: e.lastTickAt ? Math.round((now - e.lastTickAt) / 1000) : -1,
      last_recorded_age_s: Math.round((now - e.lastLedgerOkAt) / 1000),
      ledger_queue: e.ledgerQueue.length,
      ledger_queue_oldest_s: Math.round(oldestQueueAgeMs(e.ledgerQueue, now) / 1000),
      ledger_gaps: e.ledgerGapCount,
      reconcile: { window_days: 90, holes: e.reconHoles, missing_recent: e.reconMissing, checked_at: e.reconAt || null },
      feeds: s ? { spot: s.health.spot, kalshi: s.health.kalshi, derivs: s.health.derivs } : null,
      alerts: { deliverable: alerts.deliverable, owner_subs: e.alertOwnerSubs, note: alerts.note },
      // The grading race, both halves: windows decided but not yet settled, and
      // windows refused because their identity did not hold. A non-empty
      // identity list is the 2026-09-10 failure mode recurring.
      pending_windows: e.pending.map((p) => ({ ticker: p.ticker, close_time: p.close_time })),
      identity_faults: e.identityFaults.slice(-5).map((f) => ({
        ticker: f.ticker,
        close_time: f.close_time,
        fault: f.fault,
        detail: f.detail,
        checks: f.checks,
      })),
      recent_errors: e.errors.slice(-5),
    },
  };
}

/** The shared brain's latest snapshot (the Arena books calls against it). */
export function getServerSnap(): Snapshot | null {
  return eng().prevSnap;
}

/** Live ledger integrity for the readiness gate: recent-scan holes, the 90-day
 *  reconciliation count, and how many holes are NEW beyond the accepted baseline
 *  (the only ones that mean a real loss). Read-only. */
export function getReadinessIntegrity(): { gaps: number; recon_holes: number; recon_baseline: number | null; recon_new_holes: number } {
  const e = eng();
  const base = e.reconBaseline;
  return {
    gaps: e.ledgerGapCount,
    recon_holes: e.reconHoles,
    recon_baseline: base,
    recon_new_holes: base == null ? 0 : Math.max(0, e.reconHoles - base),
  };
}

/** Whether the one-time "enough data to evaluate" owner push has already fired. */
export function readinessAlerted(): boolean {
  return eng().readinessAlerted;
}

/** Read-only view of COACH's knobs for the Pit Crew panel. */
export function getLearnerKnobs(): Record<string, SeatKnobs> {
  return eng().learner.knobs ?? {};
}

export type ServerFrame = {
  as_of: number;
  tick_age_s: number;
  snap: Snapshot | null;
  votes: Vote[];
  chair: ChairResult | null;
  settings: Pick<Settings, "bar_override" | "adaptive_bar" | "mutes" | "beast">;
  learner: Learner;
  call_log: CallLogRow[];
  lastError: string | null;
  settling: boolean;
  v2: V2Frame;
  selective: {
    policy: string;
    start: number;
    params: typeof SELECTIVE_PARAMS;
    ready: boolean;
    daily: ReturnType<typeof dailyAdmission>;
    comparison: { label: string; selected: ReturnType<typeof paperSummary>; unfiltered: ReturnType<typeof paperSummary> };
  };
};

export async function getServerFrame(): Promise<ServerFrame> {
  const e = eng();
  ensureServerEngine();
  if (e.ready) await e.ready;
  return {
    as_of: Date.now(),
    tick_age_s: e.lastTickAt ? Math.round((Date.now() - e.lastTickAt) / 100) / 10 : -1,
    snap: e.prevSnap,
    votes: e.lastVotes,
    chair: e.lastChair,
    settings: {
      bar_override: e.settings.bar_override,
      adaptive_bar: e.settings.adaptive_bar,
      mutes: e.settings.mutes,
      beast: e.settings.beast,
    },
    learner: sliceLearner(e.learner),
    call_log: e.callLog,
    lastError: e.lastError,
    settling: e.pending.length > 0,
    v2: v2Frame(e),
    selective: {
      policy: SELECTIVE_ENTRY_ID, start: e.selectiveStart, params: SELECTIVE_PARAMS, ready: e.riskReady,
      daily: dailyAdmission(e.riskCalls, Date.now()),
      comparison: { label: "Prospective admission comparison; same current signal before filters; same retained market windows, up to 160",
        selected: paperSummary(e.riskCalls.filter(r => hasPaperPosition(e.baselineCalls, r)), e.selectiveStart),
        unfiltered: paperSummary(e.baselineCalls, e.selectiveStart) },
    },
  };
}

/** The engine's current snapshot, read-only, for cached side panels (the brief). */
export function currentSnap(): Snapshot | null {
  return eng().prevSnap;
}

/** Internals exposed for the settle-logic harness only. */
export const __test = { freshEng, settleIfNeeded, noteCall };

export type DeskOp =
  | { op: "settings"; patch: Partial<Pick<Settings, "bar_override" | "adaptive_bar" | "mutes" | "beast">> }
  | { op: "clear_calls" }
  | { op: "huddle" }
  | { op: "accept_candidate" }
  | { op: "dismiss_candidate" }
  | { op: "force_bench"; id: string };

const OK_SETTINGS = new Set(["bar_override", "adaptive_bar", "mutes", "beast"]);

export async function applyDeskOp(op: DeskOp): Promise<{ ok: true }> {
  const e = eng();
  ensureServerEngine();
  if (e.ready) await e.ready;
  switch (op.op) {
    case "settings": {
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(op.patch ?? {})) {
        if (OK_SETTINGS.has(k)) patch[k] = v;
      }
      if ("mutes" in patch) {
        patch.mutes = Array.isArray(patch.mutes) ? (patch.mutes.filter(Boolean) as SeatId[]).slice(0, 32) : [];
      }
      if ("bar_override" in patch && patch.bar_override != null) {
        const n = Number(patch.bar_override);
        patch.bar_override = Number.isFinite(n) ? Math.min(0.72, Math.max(0.24, n)) : null;
      }
      const beastChanged = "beast" in patch && Boolean(patch.beast) !== e.settings.beast;
      e.settings = { ...e.settings, ...patch, source: "live" };
      if (beastChanged) restartTimer(e);
      break;
    }
    case "clear_calls":
      e.callLog = [];
      e.lastCall = null;
      break;
    case "huddle":
      e.learner = runHuddle(e.learner).learner;
      break;
    case "accept_candidate":
      e.learner = acceptCandidate(e.learner);
      break;
    case "dismiss_candidate":
      if (e.learner.candidate) e.learner.candidate = null;
      break;
    case "force_bench": {
      const c = e.learner.skills[op.id];
      if (c) c.status = "BENCH";
      break;
    }
  }
  if (e.prevSnap && e.lastVotes.length) {
    e.lastChair = decideChair(e, e.lastVotes, e.prevSnap, e.lastChair?.lean ?? "WAIT");
    e.lastChair = applyEntryMode(e, e.prevSnap, e.lastChair);
  }
  await persistState(e, true);
  return { ok: true };
}
