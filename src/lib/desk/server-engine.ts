/**
 * The shared brain. One engine loop on the server: pulls the live tape,
 * runs the 20 seats and the chair, prints calls, grades every finished
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
import { freshLearner } from "./skills";
import { stickLean, type Stick } from "./stick";
import { softenTimeGates } from "./time-gates";
import { loadBundle } from "./server-feeds";
import { DESK_UPDATES } from "./updates";
import type { CallLogRow, ChairResult, Learner, Lean, SeatId, Settings, Snapshot, Vote } from "./types";

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
  pending: { ticker: string; close_time: number; snap: Snapshot; votes: Vote[]; chair: ChairResult } | null;
  gradeCand: { snap: Snapshot; votes: Vote[]; chair: ChairResult } | null;
  lastClose: number;
  timer: ReturnType<typeof setInterval> | null;
  inFlight: boolean;
  lastPersistAt: number;
  lastDigestCheckAt: number;
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
    pending: null,
    gradeCand: null,
    lastClose: 0,
    timer: null,
    inFlight: false,
    lastPersistAt: 0,
    lastDigestCheckAt: 0,
  };
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
      | { learner?: Partial<Learner>; call_log?: CallLogRow[]; settings?: Partial<Settings>; last_call?: Eng["lastCall"] }
      | undefined;
    if (!raw) return;
    e.learner = mergeLearner(raw.learner ?? null);
    e.callLog = Array.isArray(raw.call_log)
      ? raw.call_log.filter((r) => r && (r.lean === "UP" || r.lean === "DOWN") && r.cents > 0).slice(0, 80)
      : [];
    e.settings = { ...DEFAULT_SERVER_SETTINGS, ...(raw.settings ?? {}), source: "live" };
    e.settings.mutes = (e.settings.mutes ?? []).filter(Boolean);
    e.lastCall = raw.last_call ?? null;
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
  const chair = softenTimeGates(runChair(votes, snap, e.learner, e.settings, lastLean), snap);
  const { lean, st } = stickLean(e.sticks[CHAIR_SCALP], chair.lean, snap.as_of);
  e.sticks[CHAIR_SCALP] = st;
  return lean === chair.lean ? chair : { ...chair, lean };
}

function noteCall(e: Eng, snap: Snapshot, chair: ChairResult) {
  if (e.lastCall && e.lastCall.ticker === snap.ticker && e.lastCall.close_time === snap.close_time) {
    if (e.lastCall.lean === chair.lean && (chair.lean === "UP" || chair.lean === "DOWN")) return;
    if (e.lastCall.lean === "UP" || e.lastCall.lean === "DOWN") {
      const exit = markSide(snap, e.lastCall.lean);
      e.callLog = e.callLog.map((r) => {
        if (r.settle != null) return r;
        if (r.ticker !== snap.ticker || r.close_time !== snap.close_time) return r;
        if (r.lean !== e.lastCall!.lean) return r;
        return { ...r, settle: Math.round(exit * 10) / 10 };
      });
    }
  }
  if (chair.lean !== "UP" && chair.lean !== "DOWN") {
    e.lastCall = { ticker: snap.ticker, close_time: snap.close_time, lean: chair.lean };
    return;
  }
  const cents = markSide(snap, chair.lean);
  if (!(cents > 0) || !(cents < 100)) return;
  const flipped = Boolean(
    e.lastCall &&
      e.lastCall.ticker === snap.ticker &&
      e.lastCall.close_time === snap.close_time &&
      e.lastCall.lean !== chair.lean,
  );
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

/** Permanent research record: one row per graded window, idempotent. */
async function recordLedger(
  e: Eng,
  snap: Snapshot,
  votes: Vote[],
  chair: ChairResult,
  finish: "UP" | "DOWN",
  source: string,
) {
  try {
    const db = await sql();
    const rows = e.callLog.filter(
      (r) => r.ticker === snap.ticker && Math.abs(r.close_time - snap.close_time) < 90_000,
    );
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
    const seats: Record<string, { lean: string; conf: number; hit: boolean | null }> = {};
    for (const v of votes) {
      if (v.seat === "WARDEN") continue;
      seats[v.seat] = {
        lean: v.lean,
        conf: v.confidence,
        hit: v.lean === "UP" || v.lean === "DOWN" ? v.lean === finish : null,
      };
    }
    await db`
      insert into desk_ledger
        (ticker, close_time, source, winner, chair_lean, chair_conf, score, bar, sit_mass,
         entry_cents, settle_cents, ev_cents, calls, seats)
      values
        (${snap.ticker}, ${new Date(snap.close_time).toISOString()}, ${source}, ${finish},
         ${chair.lean}, ${chair.confidence}, ${chair.score}, ${chair.bar}, ${chair.sit_mass},
         ${first?.cents ?? null}, ${first?.settle ?? null}, ${ev}, ${rows.length},
         ${JSON.stringify(seats)}::jsonb)
      on conflict (ticker, close_time) do nothing
    `;
  } catch (err) {
    e.lastError = `ledger: ${err instanceof Error ? err.message : String(err)}`;
  }
}

const DIGEST_CHECK_MS = 15 * 60_000;

/** Yesterday (Chicago) on the floor, posted to the board once, old digests pruned. */
async function maybeDigest(e: Eng) {
  if (Date.now() - e.lastDigestCheckAt < DIGEST_CHECK_MS) return;
  e.lastDigestCheckAt = Date.now();
  try {
    const db = await sql();
    const agg = await db<{ day: string; windows: number; calls: number; wins: number; net_ev: number | null }>`
      select
        to_char((now() at time zone 'America/Chicago')::date - 1, 'YYYY-MM-DD') as day,
        count(*)::int as windows,
        (count(*) filter (where entry_cents is not null))::int as calls,
        (count(*) filter (where entry_cents is not null and chair_lean = winner))::int as wins,
        coalesce(sum(ev_cents), 0) as net_ev
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
    if (best && worst && best[0] !== worst[0]) {
      bits.push(`best seat ${best[0]} ${best[1].hits}/${best[1].n}, toughest ${worst[0]} ${worst[1].hits}/${worst[1].n}`);
    }
    const body = bits.join(" · ").slice(0, 400);
    await db`
      insert into board (who, body, kind, lean, ticker, conf, slug)
      values ('DESK', ${body}, 'update', '', '', 0, ${`digest-${a.day}`})
      on conflict (slug) do nothing
    `;
    await db`
      delete from board
      where kind = 'update' and slug like 'digest-%'
        and created_at < now() - interval '14 days'
    `;
  } catch (err) {
    e.lastError = `digest: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function applyGrade(e: Eng, snap: Snapshot, votes: Vote[], chair: ChairResult, finish: "UP" | "DOWN", source: string) {
  e.learner.settle_tape = e.learner.settle_tape.filter((l) => !l.startsWith("PENDING "));
  const gr = gradeWindow(e.learner, snap, votes, chair, finish);
  e.learner = gr.learner;
  settleAll(e.learner, finish);
  reviewSeats(e.learner);
  if (e.learner.settle_tape[0]) e.learner.settle_tape[0] = `${e.learner.settle_tape[0]} · ${source}`;
  settleCallLog(e, snap.ticker, snap.close_time, finish);
  void recordLedger(e, snap, votes, chair, finish, source);
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
  if (!e.pending) return;
  const hit = officialHit(snap, e.pending.ticker, e.pending.close_time);
  if (!hit) return;
  applyGrade(e, e.pending.snap, e.pending.votes, e.pending.chair, hit.lean, "kalshi-result");
  e.pending = null;
}

function gradeableBook(snap: Snapshot): boolean {
  if (snap.chalk || snap.leftover_cents > 2) return false;
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
    e.pending = null;
    return;
  }
  e.pending = { ticker: w.ticker, close_time: w.close_time, snap: s.snap, votes: s.votes, chair: s.chair };
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
  return bundleToSnapshot(bundle, e.learner.window_memory, e.prevSnap);
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
  } catch (err) {
    e.lastError = err instanceof Error ? err.message : String(err);
    e.lastTickAt = Date.now();
  } finally {
    e.inFlight = false;
  }
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
  e.ready = (async () => {
    await loadState(e);
    await syncUpdates(e);
    restartTimer(e);
    void tick(e);
  })().catch((err) => {
    e.lastError = `boot: ${err instanceof Error ? err.message : String(err)}`;
  });
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
    settling: e.pending != null,
  };
}

/** Internals exposed for the settle-logic harness only. */
export const __test = { freshEng, settleIfNeeded };

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
