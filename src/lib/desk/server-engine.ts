/**
 * The shared brain. One engine loop on the server: pulls the live tape,
 * runs the 21 seats and the chair, prints calls, grades every finished
 * window, and persists the learner to Postgres — around the clock, whether
 * or not any browser is open. Browsers in Live mode are viewers (GET /frame);
 * desk controls arrive through POST /desk with the admin key.
 * Demo mode never touches this — it stays a per-browser sandbox.
 */
import { runBots } from "./bots";
import { runChair } from "./chair";
import { takerFeeCents } from "./clock";
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
import { bookable, CHAIR_MIN_ASK_CENTS } from "./book-floor";
import { freshLearner } from "./skills";
import { stickLean, type Stick } from "./stick";
import { softenTimeGates } from "./time-gates";
import { loadBundle } from "./server-feeds";
import { DESK_UPDATES } from "./updates";
import { labDigestBits, labFairState, labSettleReceipt, startLab, labFairNow } from "./lab.server";
import { coachRun, ensureCrewBoot, sweepRun } from "./crew.server";
import { ensureLedgerBoot, ledgerCitesFor, ledgerRun } from "./ledger-clerk.server";
import { arenaDigestLine, settleHumanCalls } from "./arena.server";
import { noteReplay, pruneReplays, recordReplay } from "./replay.server";
import { notifyCall, notifySettle, notifyWatchdog } from "./push.server";
import { weeklyRecap } from "./recap.server";
import { applyWatchdog, freshWatchdog, watchdogDecision, watchdogPayload, type WatchdogState } from "./push-rules";
import {
  V2_SAMPLE_MINS,
  decideV2,
  extractFeatures,
  fitLogistic,
  predictV2,
  seatProb,
  settleV2,
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
  started: boolean;
  ready: Promise<void> | null;
  settings: Settings;
  learner: Learner;
  callLog: CallLogRow[];
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
  watchdog: WatchdogState;
  watchdogTimer: ReturnType<typeof setInterval> | null;
};

/** A window graded once its official Kalshi result arrives; held in a bounded
 *  collection so a second pending window can never overwrite the first (G5). */
type PendingWindow = { ticker: string; close_time: number; snap: Snapshot; votes: Vote[]; chair: ChairResult };

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
    started: false,
    ready: null,
    settings: { ...DEFAULT_SERVER_SETTINGS },
    learner: freshLearner(),
    callLog: [],
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
          ledger_recon_baseline?: number | null;
        }
      | undefined;
    if (!raw) return;
    e.learner = mergeLearner(raw.learner ?? null);
    e.callLog = Array.isArray(raw.call_log)
      ? raw.call_log.filter((r) => r && (r.lean === "UP" || r.lean === "DOWN") && r.cents > 0).slice(0, 80)
      : [];
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
    if (typeof raw.ledger_recon_baseline === "number") e.reconBaseline = raw.ledger_recon_baseline;
  } catch (err) {
    e.lastError = `state load: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function persistState(e: Eng, force = false) {
  if (!force && Date.now() - e.lastPersistAt < PERSIST_EVERY_MS) return;
  e.lastPersistAt = Date.now();
  try {
    const db = await sql();
    const state = JSON.stringify({
      learner: sliceLearner(e.learner),
      call_log: e.callLog.slice(0, 80),
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
      ledger_recon_baseline: e.reconBaseline,
    });
    await db`
      insert into desk_state (id, state, updated_at) values (${STATE_ID}, ${state}::jsonb, now())
      on conflict (id) do update set state = ${state}::jsonb, updated_at = now()
    `;
  } catch (err) {
    e.lastError = `state save: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** Checked-in changelog → pinned Board posts, once per slug. */
async function syncUpdates(e: Eng) {
  try {
    const db = await sql();
    for (const u of DESK_UPDATES) {
      const body = u.body.replace(/\s+/g, " ").trim().slice(0, 400);
      await db`
        insert into board (who, body, kind, lean, ticker, conf, slug)
        values ('DESK', ${body}, 'update', '', '', 0, ${u.slug})
        on conflict (slug) do nothing
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

/** One paper position per window, held to settlement. The chair may change
 *  its mind on screen; the ledger does not sell low and buy high for it.
 *  Autopsy of the flip era: 40 of the last 42 logged calls were flips,
 *  41 of 42 positions were sold on a flip, net -83¢ — the left tail was
 *  the churn, not the calls. */
function noteCall(e: Eng, snap: Snapshot, chair: ChairResult) {
  if (e.lastCall && e.lastCall.ticker === snap.ticker && e.lastCall.close_time === snap.close_time) {
    if (e.lastCall.lean === "UP" || e.lastCall.lean === "DOWN") return; // already positioned: hold
  }
  if (chair.lean !== "UP" && chair.lean !== "DOWN") {
    e.lastCall = { ticker: snap.ticker, close_time: snap.close_time, lean: chair.lean };
    return;
  }
  const cents = markSide(snap, chair.lean);
  if (!(cents > 0) || !(cents < 100)) return;
  // The book's price floor: the read stands on screen, the fill waits. Nothing
  // is positioned, so a later tick at the floor can still fill this window.
  if (!bookable(cents)) return;
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
  e.lastCall = { ticker: snap.ticker, close_time: snap.close_time, lean: chair.lean };
  notifyCall(chair.lean, Math.round(cents), snap.mins_left, snap.ticker);
}

function settleCallLog(e: Eng, ticker: string, close_time: number, winner: "UP" | "DOWN") {
  e.callLog = e.callLog.map((r) => {
    if (r.settle != null) return r;
    const sameTicker = ticker && r.ticker === ticker;
    const sameClose = close_time > 0 && Math.abs(r.close_time - close_time) < 90_000;
    if (!sameTicker && !sameClose) return r;
    return { ...r, settle: r.lean === winner ? 100 : 0 };
  });
}

function officialHit(snap: Snapshot, ticker: string, close_time: number) {
  return (
    snap.official_settles.find((s) => s.ticker && s.ticker === ticker && (s.lean === "UP" || s.lean === "DOWN")) ??
    snap.official_settles.find(
      (s) => close_time > 0 && Math.abs(s.close_time - close_time) < 90_000 && (s.lean === "UP" || s.lean === "DOWN"),
    )
  );
}

// Permanent research record: one row per graded window. The columns and their
// values are unchanged from before; only the WRITE became durable — built once
// at grade time, then persisted + verified with idempotent retry off the tick.
const LEDGER_COLUMNS =
  "(ticker, close_time, source, winner, chair_lean, chair_conf, score, bar, sit_mass, " +
  "entry_cents, settle_cents, ev_cents, calls, seats, close_dist, close_atr, close_secs, " +
  "settle_avg, settle_last, brti_prints, settle_gap, fair_pre, rule_avg_ok, rule_last_ok, " +
  "settle_feed, settle_feed_n, official_value)";
const LEDGER_INSERT =
  `insert into desk_ledger ${LEDGER_COLUMNS} values ` +
  "($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27) " +
  "on conflict (ticker, close_time) do nothing";

/** Build one graded window's ledger row synchronously, at grade time, from the
 *  state as it is right now — so a later retry records exactly what was decided,
 *  never a recomputation against drifted state. No DB, cannot fail. */
function buildLedgerRow(e: Eng, snap: Snapshot, votes: Vote[], chair: ChairResult, finish: "UP" | "DOWN", source: string): LedgerRow {
  const official = snap.official_settles.find((o) => o.ticker === snap.ticker && o.value != null)?.value ?? null;
  const rc = labSettleReceipt(snap.ticker, snap.close_time, snap.strike, finish, official);
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
  ];
  return { ticker: snap.ticker, close_time: snap.close_time, values };
}

/** The idempotent upsert + read-back verify a durable write needs. */
function ledgerIO(db: Sql): PersistIO {
  return {
    write: async (r) => {
      await db.query(LEDGER_INSERT, r.values);
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
      from desk_ledger
      where (close_time at time zone 'America/Chicago')::date
          = (now() at time zone 'America/Chicago')::date - 1
    `;
    const a = agg[0];
    if (!a || !a.windows) return;
    const dayRows = await db<{ seats: Record<string, { hit?: boolean | null }> }>`
      select seats from desk_ledger
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
    const body = bits.join(" · ").slice(0, 400);
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

function applyGrade(e: Eng, snap: Snapshot, votes: Vote[], chair: ChairResult, finish: "UP" | "DOWN", source: string) {
  e.lastGradeAt = Date.now();
  e.learner.settle_tape = e.learner.settle_tape.filter((l) => !l.startsWith("PENDING "));
  const gr = gradeWindow(e.learner, snap, votes, chair, finish);
  e.learner = gr.learner;
  settleAll(e.learner, finish);
  reviewSeats(e.learner);
  if (e.learner.settle_tape[0]) e.learner.settle_tape[0] = `${e.learner.settle_tape[0]} · ${source}`;
  settleCallLog(e, snap.ticker, snap.close_time, finish);
  // Enqueue the ledger row (built now, from this window's state) for a durable,
  // verified write off the tick. lastLedgerOkAt only advances once it lands.
  e.ledgerQueue = enqueueLedger(e.ledgerQueue, buildLedgerRow(e, snap, votes, chair, finish, source), Date.now());
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
  void recordReplay(snap.ticker, finish).catch((err) => {
    e.lastError = `replay: ${err instanceof Error ? err.message : String(err)}`;
  });
  if (windowsHuddleDue(e.learner) || chicagoHuddleDue(e.learner.last_huddle)) {
    e.learner = runHuddle(e.learner).learner;
  }
  e.learner.window_memory.entry_spot = 0;
  void persistState(e, true);
}

function markPending(e: Eng, snap: Snapshot) {
  const hhmm = new Date(snap.close_time).toISOString().slice(11, 16);
  const line = `PENDING ${hhmm} ${snap.ticker} · awaiting Kalshi result — bots not taught`;
  e.learner.settle_tape = [line, ...e.learner.settle_tape.filter((l) => !l.startsWith("PENDING "))].slice(0, 48);
}

function resolvePending(e: Eng, snap: Snapshot) {
  if (!e.pending.length) return;
  // Every pending window whose official result has arrived grades now; the rest
  // stay pending. Resolving one can no longer drop the others (the G5 fix).
  const { resolved, remaining } = partitionResolved(e.pending, (p) => Boolean(officialHit(snap, p.ticker, p.close_time)));
  if (!resolved.length) return;
  e.pending = remaining;
  for (const p of resolved) {
    const hit = officialHit(snap, p.ticker, p.close_time);
    if (hit) applyGrade(e, p.snap, p.votes, p.chair, hit.lean, "kalshi-result");
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

/** A window settles on a death tick (≤0.4s left) or — the common case with a
 *  4s poll against a 3s bundle cache — on ROLLOVER: the first tick whose
 *  close_time moved past the previous window. Without the rollover path,
 *  grading depends on a tick landing inside the final 400ms, which is luck. */
function settleIfNeeded(
  e: Eng,
  snap: Snapshot,
  votes: Vote[],
  chair: ChairResult,
  prev: { snap: Snapshot | null; votes: Vote[]; chair: ChairResult | null },
) {
  resolvePending(e, snap);
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
  const hit = officialHit(snap, w.ticker, w.close_time);
  if (hit) {
    applyGrade(e, s.snap, s.votes, s.chair, hit.lean, "kalshi-result");
    e.pending = removeKeyed(e.pending, w.ticker, w.close_time); // clear only this window, not others
    return;
  }
  e.pending = addKeyed(
    e.pending,
    { ticker: w.ticker, close_time: w.close_time, snap: s.snap, votes: s.votes, chair: s.chair },
    PENDING_CAP,
  );
  markPending(e, s.snap);
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
  return snap;
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
    const chair = decideChair(e, votes, snap, lastSide(e, snap));
    onLean(e.learner, CHAIR_SCALP, chair.lean, snap);
    noteCall(e, snap, chair);
    noteReplay(snap, votes, chair, e.callLog.some((r) => r.ticker === snap.ticker), labFairNow(snap.ticker));
    noteV2(e, snap, votes, chair);
    noteTaker(e, snap, chair);
    // Settle BEFORE rolling the grade candidate and prev pointers: on a window
    // rollover the OLD window grades from its own last live-book tick.
    const prev = { snap: e.prevSnap, votes: e.lastVotes, chair: e.lastChair };
    settleIfNeeded(e, snap, votes, chair, prev);
    noteGradeCand(e, snap, votes, chair);
    if (!e.learner.window_memory.entry_lean && chair.lean !== "WAIT") {
      e.learner.window_memory.entry_lean = chair.lean;
    }
    e.prevSnap = snap;
    e.lastVotes = votes;
    e.lastChair = chair;
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
    const rows = await db<{ features: V2Features; winner: string }>`
      select features, winner from desk_samples
      where winner is not null order by close_time desc limit 3000
    `;
    const fitted = fitLogistic(rows.map((r) => ({ x: r.features, y: r.winner === "UP" ? 1 : 0 })));
    if (fitted) {
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
    const a = await db<{
      n_samples: number;
      n_graded: number;
      brier_v2: number | null;
      brier_market: number | null;
      ev_v2: number;
      calls_v2: number;
    }>`
      select
        count(*)::int as n_samples,
        count(winner)::int as n_graded,
        avg(case when winner is not null and v2_p is not null
            then power(v2_p - (case when winner = 'UP' then 1 else 0 end), 2) end) as brier_v2,
        avg(case when winner is not null
            then power((market->>'yes_mid')::float / 100 - (case when winner = 'UP' then 1 else 0 end), 2) end) as brier_market,
        coalesce(sum(v2_ev), 0) as ev_v2,
        (count(*) filter (where v2_lean in ('UP','DOWN') and winner is not null))::int as calls_v2
      from desk_samples
    `;
    const b = await db<{ ev_v1: number; calls_v1: number }>`
      select coalesce(sum(l.ev_cents), 0) as ev_v1,
             (count(*) filter (where l.calls > 0))::int as calls_v1
      from desk_samples s
      join desk_ledger l on l.ticker = s.ticker and l.close_time = s.close_time
      where s.winner is not null
    `;
    const x = a[0];
    if (!x) return;
    e.v2Stats = {
      n_samples: Number(x.n_samples) || 0,
      n_graded: Number(x.n_graded) || 0,
      brier_v2: x.brier_v2 == null ? null : Number(x.brier_v2),
      brier_market: x.brier_market == null ? null : Number(x.brier_market),
      ev_v2: Number(x.ev_v2) || 0,
      ev_v1: Number(b[0]?.ev_v1) || 0,
      calls_v2: Number(x.calls_v2) || 0,
      calls_v1: Number(b[0]?.calls_v1) || 0,
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
      left join desk_ledger l on l.ticker = s.ticker and l.close_time = s.close_time
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
      pulseGet(`${host}/markets?status=open&series_ticker=KXBTC15M&limit=1`),
    ]);
    const spot =
      cb.status === "fulfilled" ? Number((cb.value as { price?: string }).price) : NaN;
    const row =
      mk.status === "fulfilled"
        ? ((mk.value as { markets?: Record<string, unknown>[] }).markets ?? [])[0]
        : undefined;
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
    void persistState(e, true); // persist the updated baseline
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
      recent_errors: e.errors.slice(-5),
    },
  };
}

/** The shared brain's latest snapshot (the Arena books calls against it). */
export function getServerSnap(): Snapshot | null {
  return eng().prevSnap;
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
  }
  await persistState(e, true);
  return { ok: true };
}
