import { runBots } from "./bots";
import { runChair } from "./chair";
import { demoFinish, demoTick, newDemoWindow, type DemoState } from "./demo";
import { chicagoHuddleDue, gradeWindow, reviewSeats, runHuddle, acceptCandidate, windowsHuddleDue } from "./learner";
import { appendPeriod, FUNDING_PERIOD_MS, nativePeriodMs, OI_PERIOD_MS, type HistPoint } from "./hist";
import { bundleToSnapshot } from "./live";
import { DEFAULT_SETTINGS, loadCallLog, loadLearner, loadPersisted, saveCallLog, savePersisted } from "./persist";
import { CHAIR_SCALP, markSide, onLean, settleAll } from "./scalp";
import { stickLean, type Stick } from "./stick";
import { softenTimeGates } from "./time-gates";
import type { ServerFrame } from "./server-engine";
import type { CallLogRow, ChairResult, Learner, Lean, Settings, Snapshot, Vote } from "./types";

export type DeskFrame = {
  snap: Snapshot | null;
  votes: Vote[];
  chair: ChairResult | null;
  settings: Settings;
  learner: Learner;
  ticking: boolean;
  lastError: string | null;
  settling: boolean;
  call_log: CallLogRow[];
  /** Seconds since the shared brain's last server tick (live viewer mode only). */
  brain_age_s: number | null;
};

let settings: Settings = { ...DEFAULT_SETTINGS };
let learner: Learner = loadPersisted().learner;
let demo: DemoState | null = null;
let prevSnap: Snapshot | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;
let flightAt = 0;
let lastClose = 0;
let liveHist = { funding: [] as HistPoint[], oi: [] as HistPoint[], oiUsd: [] as HistPoint[] };
let pending: {
  ticker: string;
  close_time: number;
  snap: Snapshot;
  votes: Vote[];
  chair: ChairResult;
  since: number;
} | null = null;
let gradeCand: { snap: Snapshot; votes: Vote[]; chair: ChairResult } | null = null;
let callLog: CallLogRow[] = loadCallLog(settings.source);
let lastCall: { ticker: string; close_time: number; lean: Lean } | null = null;
let sticks: Partial<Record<string, Stick>> = {};
let stickWindow = "";

const listeners = new Set<(f: DeskFrame) => void>();

/** Live is the shared brain on the server; the browser is a viewer there.
 *  Demo stays a fully local sandbox. */
function liveMode() {
  return settings.source === "live";
}

const ADMIN_KEY_LS = "satoshi-desk-admin-key";

export function getAdminKey(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(ADMIN_KEY_LS) ?? "";
  } catch {
    return "";
  }
}

export function setAdminKey(key: string) {
  try {
    if (key) localStorage.setItem(ADMIN_KEY_LS, key);
    else localStorage.removeItem(ADMIN_KEY_LS);
  } catch {
    /* quota */
  }
  emit();
}

async function postDesk(op: Record<string, unknown>) {
  try {
    const r = await fetch("/desk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: getAdminKey(), ...op }),
      signal: AbortSignal.timeout(12_000),
    });
    const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!r.ok || !j?.ok) {
      lastError =
        r.status === 401
          ? "Admin key rejected — desk controls need the key (Settings)."
          : j?.error || `desk op ${r.status}`;
      emit();
      return;
    }
    void tick();
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    emit();
  }
}

async function pullFrame(): Promise<void> {
  const r = await fetch("/frame", {
    signal: AbortSignal.timeout(12_000),
    headers: { accept: "application/json" },
  });
  if (!r.ok) throw new Error(`desk frame ${r.status}`);
  const f = (await r.json()) as (ServerFrame & { ok?: boolean; error?: string }) | null;
  if (!f || f.ok === false) throw new Error(f?.error || "desk frame bad");
  prevSnap = f.snap;
  lastVotes = f.votes ?? [];
  lastChair = f.chair;
  learner = f.learner;
  callLog = f.call_log ?? [];
  settings = { ...settings, ...f.settings, source: "live" };
  lastError = f.lastError;
  brainAge = typeof f.tick_age_s === "number" && f.tick_age_s >= 0 ? f.tick_age_s : null;
  emit({ settling: f.settling });
}

function windowKey(snap: Snapshot) {
  return `${snap.ticker}:${snap.close_time}`;
}

function stickyVotes(votes: Vote[], snap: Snapshot): Vote[] {
  const k = windowKey(snap);
  if (stickWindow !== k) {
    sticks = {};
    stickWindow = k;
  }
  return votes.map((v) => {
    if (v.seat === "WARDEN") return v;
    const { lean, st } = stickLean(sticks[v.seat], v.lean, snap.as_of);
    sticks[v.seat] = st;
    if (lean === v.lean) return v;
    return {
      ...v,
      lean,
      reasoning: `${v.reasoning} · hold ${st.shown} (${st.pendingN}/2 ${st.pending ?? "—"})`,
    };
  });
}

function lastSide(snap: Snapshot): Lean {
  if (lastChair && prevSnap && windowKey(prevSnap) === windowKey(snap)) return lastChair.lean;
  return "WAIT";
}

function stickyChair(chair: ChairResult, snap: Snapshot): ChairResult {
  const { lean, st } = stickLean(sticks[CHAIR_SCALP], chair.lean, snap.as_of);
  sticks[CHAIR_SCALP] = st;
  if (lean === chair.lean) return chair;
  return { ...chair, lean };
}

function decideChair(votes: Vote[], snap: Snapshot, lastLean: Lean): ChairResult {
  return stickyChair(softenTimeGates(runChair(votes, snap, learner, settings, lastLean), snap), snap);
}

function emit(partial: Partial<DeskFrame> = {}) {
  const frame: DeskFrame = {
    snap: prevSnap,
    votes: lastVotes,
    chair: lastChair,
    settings,
    learner,
    ticking: timer != null,
    lastError: lastError,
    settling: false,
    call_log: callLog,
    brain_age_s: settings.source === "live" ? brainAge : null,
    ...partial,
  };
  for (const l of listeners) l(frame);
}

let lastVotes: Vote[] = [];
let lastChair: ChairResult | null = null;
let lastError: string | null = null;
let brainAge: number | null = null;
let lastPersistAt = 0;
let persistDirty = false;
let visBound = false;

function persist(force = false) {
  persistDirty = true;
  if (!force && Date.now() - lastPersistAt < 8_000) return;
  lastPersistAt = Date.now();
  persistDirty = false;
  savePersisted({ settings, learner });
  saveCallLog(callLog, settings.source);
}

function noteCall(snap: Snapshot, chair: ChairResult) {
  if (
    lastCall &&
    lastCall.ticker === snap.ticker &&
    lastCall.close_time === snap.close_time
  ) {
    if (lastCall.lean === chair.lean) {
      if (chair.lean === "UP" || chair.lean === "DOWN") return;
    }
    if (lastCall.lean === "UP" || lastCall.lean === "DOWN") {
      const exit = markSide(snap, lastCall.lean);
      callLog = callLog.map((r) => {
        if (r.settle != null) return r;
        if (r.ticker !== snap.ticker || r.close_time !== snap.close_time) return r;
        if (r.lean !== lastCall!.lean) return r;
        return { ...r, settle: Math.round(exit * 10) / 10 };
      });
    }
  }
  if (chair.lean !== "UP" && chair.lean !== "DOWN") {
    lastCall = { ticker: snap.ticker, close_time: snap.close_time, lean: chair.lean };
    saveCallLog(callLog, settings.source);
    return;
  }
  const cents = markSide(snap, chair.lean);
  if (!(cents > 0) || !(cents < 100)) return;
  const flipped = Boolean(
    lastCall && lastCall.ticker === snap.ticker && lastCall.close_time === snap.close_time && lastCall.lean !== chair.lean,
  );
  callLog = [
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
    ...callLog,
  ].slice(0, 80);
  lastCall = { ticker: snap.ticker, close_time: snap.close_time, lean: chair.lean };
  saveCallLog(callLog, settings.source);
}

function settleCallLog(ticker: string, close_time: number, winner: "UP" | "DOWN") {
  let n = 0;
  callLog = callLog.map((r) => {
    if (r.settle != null) return r;
    const sameTicker = ticker && r.ticker === ticker;
    const sameClose = close_time > 0 && Math.abs(r.close_time - close_time) < 90_000;
    if (!sameTicker && !sameClose) return r;
    n += 1;
    return { ...r, settle: r.lean === winner ? 100 : 0 };
  });
  if (n) saveCallLog(callLog, settings.source);
}

export function clearCallLog() {
  if (liveMode()) {
    void postDesk({ op: "clear_calls" });
    return;
  }
  callLog = [];
  lastCall = null;
  saveCallLog(callLog, settings.source);
  emit();
}

function ensureDemo(remainingMs?: number) {
  if (!demo) demo = newDemoWindow(learner.window_memory, remainingMs);
}

async function pullBundle() {
  const r = await fetch("/bundle", {
    signal: AbortSignal.timeout(12_000),
    headers: { accept: "application/json" },
  });
  if (!r.ok) throw new Error(`live tape ${r.status}`);
  return r.json();
}

async function liveSnap(): Promise<Snapshot> {
  const bundle = await pullBundle();
  if ((bundle.funding_series?.length ?? 0) >= 2) {
    liveHist.funding = bundle.funding_series;
  } else if (bundle.funding_rate != null && bundle.funding_time) {
    liveHist.funding = appendPeriod(
      liveHist.funding,
      bundle.funding_time,
      bundle.funding_rate,
      nativePeriodMs(liveHist.funding, FUNDING_PERIOD_MS),
    );
    bundle.funding_series = liveHist.funding;
    bundle.funding_history = liveHist.funding.map((p) => p.v);
  }
  if ((bundle.oi_series?.length ?? 0) >= 2) {
    liveHist.oi = bundle.oi_series;
  } else if (bundle.open_interest != null) {
    liveHist.oi = appendPeriod(liveHist.oi, bundle.as_of, bundle.open_interest, OI_PERIOD_MS);
    bundle.oi_series = liveHist.oi;
    bundle.oi_history = liveHist.oi.map((p) => p.v);
  }
  if ((bundle.oi_usd_series?.length ?? 0) >= 2) {
    liveHist.oiUsd = bundle.oi_usd_series;
  } else if (bundle.oi_usd != null) {
    liveHist.oiUsd = appendPeriod(liveHist.oiUsd, bundle.as_of, bundle.oi_usd, OI_PERIOD_MS);
    bundle.oi_usd_series = liveHist.oiUsd;
  }
  return bundleToSnapshot(bundle, learner.window_memory, prevSnap);
}

function maybeHuddle() {
  if (chicagoHuddleDue(learner.last_huddle)) {
    const r = runHuddle(learner);
    learner = r.learner;
  }
}

function applyGrade(
  snap: Snapshot,
  votes: Vote[],
  chair: ChairResult,
  finish: "UP" | "DOWN",
  source: string,
) {
  learner.settle_tape = learner.settle_tape.filter((l) => !l.startsWith("PENDING "));
  const g = gradeWindow(learner, snap, votes, chair, finish);
  learner = g.learner;
  settleAll(learner, finish);
  reviewSeats(learner);
  if (learner.settle_tape[0]) {
    learner.settle_tape[0] = `${learner.settle_tape[0]} · ${source}`;
  }
  settleCallLog(snap.ticker, snap.close_time, finish);
  if (windowsHuddleDue(learner) || chicagoHuddleDue(learner.last_huddle)) {
    learner = runHuddle(learner).learner;
  }
  learner.window_memory.entry_spot = 0;
  persist(true);
}

function officialHit(snap: Snapshot, ticker: string, close_time: number) {
  return (
    snap.official_settles.find(
      (s) => s.ticker && s.ticker === ticker && (s.lean === "UP" || s.lean === "DOWN"),
    ) ??
    snap.official_settles.find(
      (s) =>
        close_time > 0 &&
        Math.abs(s.close_time - close_time) < 90_000 &&
        (s.lean === "UP" || s.lean === "DOWN"),
    )
  );
}

function markPending(snap: Snapshot) {
  const hhmm = new Date(snap.close_time).toISOString().slice(11, 16);
  const line = `PENDING ${hhmm} ${snap.ticker} · awaiting Kalshi result — bots not taught`;
  learner.settle_tape = [line, ...learner.settle_tape.filter((l) => !l.startsWith("PENDING "))].slice(0, 48);
  persist();
}

function resolvePending(snap: Snapshot) {
  if (!pending) return;
  const hit = officialHit(snap, pending.ticker, pending.close_time);
  if (!hit) return;
  applyGrade(pending.snap, pending.votes, pending.chair, hit.lean, "kalshi-result");
  pending = null;
}

/** A window that ends chalk must still teach. Keep the last tick with a live
 *  book so gradeWindow is fed real asks instead of the 99¢ death print. */
function gradeableBook(snap: Snapshot): boolean {
  if (snap.chalk || snap.leftover_cents > 12) return false;
  return !(snap.health.spot === "DOWN" && snap.health.kalshi === "DOWN");
}

function noteGradeCand(snap: Snapshot, votes: Vote[], chair: ChairResult) {
  if (gradeCand && gradeCand.snap.close_time !== snap.close_time) gradeCand = null;
  if (gradeableBook(snap)) gradeCand = { snap, votes, chair };
}

function gradeSource(snap: Snapshot, votes: Vote[], chair: ChairResult) {
  if (!gradeableBook(snap) && gradeCand && gradeCand.snap.close_time === snap.close_time) {
    return gradeCand;
  }
  return { snap, votes, chair };
}

function settleIfNeeded(snap: Snapshot, votes: Vote[], chair: ChairResult) {
  if (settings.source === "demo") {
    if (snap.secs_left > 0.4) return;
    if (lastClose === snap.close_time) return;
    lastClose = snap.close_time;
    const g = gradeSource(snap, votes, chair);
    applyGrade(g.snap, g.votes, g.chair, demoFinish(demo!), "demo");
    demo = newDemoWindow(learner.window_memory, 15 * 60_000);
    return;
  }
  resolvePending(snap);
  if (snap.secs_left > 0.4) return;
  if (lastClose === snap.close_time) return;
  lastClose = snap.close_time;
  const g = gradeSource(snap, votes, chair);
  const hit = officialHit(snap, snap.ticker, snap.close_time);
  if (hit) {
    applyGrade(g.snap, g.votes, g.chair, hit.lean, "kalshi-result");
    pending = null;
    return;
  }
  pending = {
    ticker: snap.ticker,
    close_time: snap.close_time,
    snap: g.snap,
    votes: g.votes,
    chair: g.chair,
    since: Date.now(),
  };
  markPending(snap);
}

async function tick() {
  if (inFlight && Date.now() - flightAt < 15_000) return;
  inFlight = true;
  flightAt = Date.now();
  try {
    if (liveMode()) {
      await pullFrame();
      return;
    }
    maybeHuddle();
    let snap: Snapshot;
    if (settings.source === "demo") {
      ensureDemo();
      snap = demoTick(demo!, learner.window_memory);
    } else {
      snap = await liveSnap();
    }
    if (!learner.window_memory.entry_spot) {
      learner.window_memory.entry_spot = snap.spot;
    }
    learner.window_memory.path_since_entry = [
      ...learner.window_memory.path_since_entry,
      snap.spot - learner.window_memory.entry_spot,
    ].slice(-120);

    const votes = stickyVotes(runBots(snap, learner), snap);
    for (const v of votes) {
      if (v.seat === "WARDEN") continue;
      onLean(learner, v.seat, v.lean, snap);
    }
    const chair = decideChair(votes, snap, lastSide(snap));
    onLean(learner, CHAIR_SCALP, chair.lean, snap);
    noteCall(snap, chair);
    noteGradeCand(snap, votes, chair);
    persist();
    if (!learner.window_memory.entry_lean && chair.lean !== "WAIT") {
      learner.window_memory.entry_lean = chair.lean;
    }
    prevSnap = snap;
    lastVotes = votes;
    lastChair = chair;
    lastError = null;
    settleIfNeeded(snap, votes, chair);
    emit({ settling: pending != null });
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    if (settings.source === "live" && !prevSnap) {
      settings = { ...settings, source: "demo" };
      learner = loadLearner("demo");
      callLog = loadCallLog("demo");
      lastCall = null;
      persist(true);
      restartTimer();
      try {
        runDemoOnce();
        lastError = `${lastError} · live tape down, Demo so the floor ticks`;
        emit();
      } catch {
        emit();
      }
    } else {
      emit();
    }
  } finally {
    inFlight = false;
  }
}

export function subscribe(fn: (f: DeskFrame) => void) {
  listeners.add(fn);
  fn({
    snap: prevSnap,
    votes: lastVotes,
    chair: lastChair,
    settings,
    learner,
    ticking: timer != null,
    lastError,
    settling: false,
    call_log: callLog,
    brain_age_s: settings.source === "live" ? brainAge : null,
  });
  return () => listeners.delete(fn);
}

function runDemoOnce() {
  ensureDemo();
  const snap = demoTick(demo!, learner.window_memory);
  if (!learner.window_memory.entry_spot) learner.window_memory.entry_spot = snap.spot;
  const votes = stickyVotes(runBots(snap, learner), snap);
  for (const v of votes) {
    if (v.seat === "WARDEN") continue;
    onLean(learner, v.seat, v.lean, snap);
  }
  const chair = decideChair(votes, snap, lastSide(snap));
  onLean(learner, CHAIR_SCALP, chair.lean, snap);
  noteCall(snap, chair);
  noteGradeCand(snap, votes, chair);
  persist();
  if (!learner.window_memory.entry_lean && chair.lean !== "WAIT") {
    learner.window_memory.entry_lean = chair.lean;
  }
  prevSnap = snap;
  lastVotes = votes;
  lastChair = chair;
  lastError = null;
  settleIfNeeded(snap, votes, chair);
  emit({ settling: pending != null });
}

function pollMs() {
  if (settings.beast) return 2500;
  if (settings.source === "live") return Math.max(settings.poll_ms, 4000);
  return Math.max(settings.poll_ms, 3000);
}

function onVis() {
  if (typeof document === "undefined") return;
  if (document.hidden) {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (persistDirty) persist(true);
    return;
  }
  restartTimer();
  void tick();
}

export function startEngine() {
  const persisted = loadPersisted();
  settings = persisted.settings;
  learner = persisted.learner;
  callLog = loadCallLog(settings.source);
  lastCall = null;
  if (settings.source === "demo") {
    runDemoOnce();
  } else {
    void tick();
  }
  restartTimer();
  if (!visBound && typeof document !== "undefined") {
    visBound = true;
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", () => persist(true));
  }
}

export function stopEngine() {
  if (timer) clearInterval(timer);
  timer = null;
}

function restartTimer() {
  if (timer) clearInterval(timer);
  if (typeof document !== "undefined" && document.hidden) return;
  timer = setInterval(() => void tick(), pollMs());
}

const DESK_KEYS = new Set<keyof Settings>(["bar_override", "adaptive_bar", "beast", "mutes"]);

export function patchSettings(p: Partial<Settings>) {
  const switching = p.source != null && p.source !== settings.source;
  if (switching) persist(true);
  settings = { ...settings, ...p };
  if (switching && p.source) {
    learner = loadLearner(p.source);
    callLog = loadCallLog(p.source);
    lastCall = null;
    prevSnap = null;
    demo = null;
    lastClose = 0;
    pending = null;
    gradeCand = null;
    lastVotes = [];
    lastChair = null;
    persist(true);
    emit();
    restartTimer();
    void tick();
    return;
  }
  if (liveMode()) {
    // Shared brain: bar/mutes/beast steer the server desk (admin key);
    // everything else is a viewer preference and stays local.
    const desk: Record<string, unknown> = {};
    for (const k of Object.keys(p) as (keyof Settings)[]) {
      if (DESK_KEYS.has(k)) desk[k] = p[k];
    }
    if (Object.keys(desk).length) void postDesk({ op: "settings", patch: desk });
    persist(true);
    emit();
    restartTimer();
    return;
  }
  persist(true);
  if (prevSnap && lastVotes.length) {
    lastChair = decideChair(lastVotes, prevSnap, lastChair?.lean ?? "WAIT");
  }
  emit();
  restartTimer();
}

export function resetDemoWindow() {
  if (liveMode()) return;
  demo = newDemoWindow(learner.window_memory, 15 * 60_000);
  lastClose = 0;
  pending = null;
  void tick();
}

export function jumpDemo(ms: number) {
  if (liveMode()) return;
  demo = newDemoWindow(learner.window_memory, ms);
  lastClose = 0;
  pending = null;
  void tick();
}

export function huddleNow() {
  if (liveMode()) {
    void postDesk({ op: "huddle" });
    return;
  }
  const r = runHuddle(learner);
  learner = r.learner;
  persist();
  if (prevSnap && lastVotes.length) {
    lastChair = decideChair(lastVotes, prevSnap, lastChair?.lean ?? "WAIT");
  }
  emit();
}

export function setMuted(seat: import("./types").SeatId, on: boolean) {
  const mutes = new Set(settings.mutes);
  if (on) mutes.add(seat);
  else mutes.delete(seat);
  patchSettings({ mutes: [...mutes] });
}

export function acceptCandidateNow() {
  if (liveMode()) {
    void postDesk({ op: "accept_candidate" });
    return;
  }
  learner = acceptCandidate(learner);
  persist();
  emit();
}

export function dismissCandidate() {
  if (liveMode()) {
    void postDesk({ op: "dismiss_candidate" });
    return;
  }
  if (learner.candidate) learner.candidate = { ...learner.candidate, dismissed: true };
  learner.candidate = null;
  persist();
  emit();
}

export function forceBench(id: string) {
  if (liveMode()) {
    void postDesk({ op: "force_bench", id });
    return;
  }
  const c = learner.skills[id];
  if (c) c.status = "BENCH";
  persist();
  emit();
}

export function getFrame(): DeskFrame {
  return {
    snap: prevSnap,
    votes: lastVotes,
    chair: lastChair,
    settings,
    learner,
    ticking: timer != null,
    lastError,
    settling: false,
    call_log: callLog,
    brain_age_s: settings.source === "live" ? brainAge : null,
  };
}

if (typeof window !== "undefined") {
  (window as unknown as { __satoshiDesk?: unknown }).__satoshiDesk = {
    jumpDemo,
    huddleNow,
    resetDemoWindow,
    setMuted,
    patchSettings,
    getFrame,
  };
}
