import { runBots } from "./bots";
import { runChair } from "./chair";
import { demoFinish, demoTick, newDemoWindow, type DemoState } from "./demo";
import { chicagoHuddleDue, gradeWindow, runHuddle, acceptCandidate, windowsHuddleDue } from "./learner";
import { appendPeriod, FUNDING_PERIOD_MS, nativePeriodMs, OI_PERIOD_MS, type HistPoint } from "./hist";
import { bundleToSnapshot } from "./live";
import { DEFAULT_SETTINGS, loadLearner, loadPersisted, savePersisted } from "./persist";
import type { ChairResult, Learner, Settings, Snapshot, Vote } from "./types";

export type DeskFrame = {
  snap: Snapshot | null;
  votes: Vote[];
  chair: ChairResult | null;
  settings: Settings;
  learner: Learner;
  ticking: boolean;
  lastError: string | null;
  settling: boolean;
};

let settings: Settings = { ...DEFAULT_SETTINGS };
let learner: Learner = loadPersisted().learner;
let demo: DemoState | null = null;
let prevSnap: Snapshot | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;
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

const listeners = new Set<(f: DeskFrame) => void>();

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
    ...partial,
  };
  for (const l of listeners) l(frame);
}

let lastVotes: Vote[] = [];
let lastChair: ChairResult | null = null;
let lastError: string | null = null;

function persist() {
  savePersisted({ settings, learner });
}

function ensureDemo(remainingMs?: number) {
  if (!demo) demo = newDemoWindow(learner.window_memory, remainingMs);
}

async function liveSnap(): Promise<Snapshot> {
  const { fetchLiveBundle } = await import("./server-feeds");
  const bundle = await fetchLiveBundle();
  if (bundle.funding_series.length >= 2) {
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
  if (bundle.oi_series.length >= 2) {
    liveHist.oi = bundle.oi_series;
  } else if (bundle.open_interest != null) {
    liveHist.oi = appendPeriod(liveHist.oi, bundle.as_of, bundle.open_interest, OI_PERIOD_MS);
    bundle.oi_series = liveHist.oi;
    bundle.oi_history = liveHist.oi.map((p) => p.v);
  }
  if (bundle.oi_usd_series.length >= 2) {
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
  if (learner.settle_tape[0]) {
    learner.settle_tape[0] = `${learner.settle_tape[0]} · ${source}`;
  }
  if (windowsHuddleDue(learner) || chicagoHuddleDue(learner.last_huddle)) {
    learner = runHuddle(learner).learner;
  }
  learner.window_memory.entry_spot = 0;
  persist();
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

function settleIfNeeded(snap: Snapshot, votes: Vote[], chair: ChairResult) {
  if (settings.source === "demo") {
    if (snap.secs_left > 0.4) return;
    if (lastClose === snap.close_time) return;
    lastClose = snap.close_time;
    applyGrade(snap, votes, chair, demoFinish(demo!), "demo");
    demo = newDemoWindow(learner.window_memory, 15 * 60_000);
    return;
  }
  resolvePending(snap);
  if (snap.secs_left > 0.4) return;
  if (lastClose === snap.close_time) return;
  lastClose = snap.close_time;
  const hit = officialHit(snap, snap.ticker, snap.close_time);
  if (hit) {
    applyGrade(snap, votes, chair, hit.lean, "kalshi-result");
    pending = null;
    return;
  }
  pending = {
    ticker: snap.ticker,
    close_time: snap.close_time,
    snap,
    votes,
    chair,
    since: Date.now(),
  };
  markPending(snap);
}

async function tick() {
  if (inFlight) return;
  inFlight = true;
  try {
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

    const votes = runBots(snap, learner);
    const chair = runChair(votes, snap, learner, settings);
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
    emit();
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
  });
  return () => listeners.delete(fn);
}

function runDemoOnce() {
  ensureDemo();
  const snap = demoTick(demo!, learner.window_memory);
  if (!learner.window_memory.entry_spot) learner.window_memory.entry_spot = snap.spot;
  const votes = runBots(snap, learner);
  const chair = runChair(votes, snap, learner, settings);
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

export function startEngine() {
  const persisted = loadPersisted();
  settings = persisted.settings;
  learner = persisted.learner;
  if (settings.source === "demo") {
    runDemoOnce();
  } else {
    void tick();
  }
  restartTimer();
}

export function stopEngine() {
  if (timer) clearInterval(timer);
  timer = null;
}

function restartTimer() {
  if (timer) clearInterval(timer);
  const ms = settings.beast ? 1500 : settings.poll_ms;
  timer = setInterval(() => void tick(), ms);
}

export function patchSettings(p: Partial<Settings>) {
  const switching = p.source != null && p.source !== settings.source;
  if (switching) persist();
  settings = { ...settings, ...p };
  if (switching && p.source) {
    learner = loadLearner(p.source);
    prevSnap = null;
    demo = null;
    lastClose = 0;
    pending = null;
    lastVotes = [];
    lastChair = null;
    persist();
    emit();
    restartTimer();
    void tick();
    return;
  }
  persist();
  if (prevSnap && lastVotes.length) {
    lastChair = runChair(lastVotes, prevSnap, learner, settings);
  }
  emit();
  restartTimer();
}

export function resetDemoWindow() {
  demo = newDemoWindow(learner.window_memory, 15 * 60_000);
  lastClose = 0;
  pending = null;
  void tick();
}

export function jumpDemo(ms: number) {
  demo = newDemoWindow(learner.window_memory, ms);
  lastClose = 0;
  pending = null;
  void tick();
}

export function huddleNow() {
  const r = runHuddle(learner);
  learner = r.learner;
  persist();
  if (prevSnap && lastVotes.length) {
    lastChair = runChair(lastVotes, prevSnap, learner, settings);
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
  learner = acceptCandidate(learner);
  persist();
  emit();
}

export function dismissCandidate() {
  if (learner.candidate) learner.candidate = { ...learner.candidate, dismissed: true };
  learner.candidate = null;
  persist();
  emit();
}

export function forceBench(id: string) {
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
