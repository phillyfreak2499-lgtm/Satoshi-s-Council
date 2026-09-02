import { runBots } from "./bots";
import { runChair } from "./chair";
import { demoFinish, demoTick, newDemoWindow, type DemoState } from "./demo";
import { chicagoHuddleDue, gradeWindow, runHuddle, acceptCandidate, windowsHuddleDue } from "./learner";
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
let liveHist = { funding: [] as number[], oi: [] as number[] };

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
  if (bundle.funding_rate != null) {
    liveHist.funding = [...liveHist.funding, bundle.funding_rate].slice(-16);
    bundle.funding_history = liveHist.funding;
  }
  if (bundle.open_interest != null) {
    liveHist.oi = [...liveHist.oi, bundle.open_interest].slice(-16);
    bundle.oi_history = liveHist.oi;
  }
  return bundleToSnapshot(bundle, learner.window_memory, prevSnap);
}

function maybeHuddle() {
  if (chicagoHuddleDue(learner.last_huddle)) {
    const r = runHuddle(learner);
    learner = r.learner;
  }
}

function settleIfNeeded(snap: Snapshot, votes: Vote[], chair: ChairResult) {
  if (snap.secs_left > 0.4) return;
  if (lastClose === snap.close_time) return;
  lastClose = snap.close_time;
  const finish =
    settings.source === "demo" && demo
      ? demoFinish(demo)
      : snap.spot > snap.strike
        ? "UP"
        : "DOWN";
  const g = gradeWindow(learner, snap, votes, chair, finish);
  learner = g.learner;
  if (windowsHuddleDue(learner) || chicagoHuddleDue(learner.last_huddle)) {
    learner = runHuddle(learner).learner;
  }
  learner.window_memory.entry_spot = 0;
  if (settings.source === "demo") {
    demo = newDemoWindow(learner.window_memory, 15 * 60_000);
  }
  persist();
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
    emit();
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
  emit();
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
  void tick();
}

export function jumpDemo(ms: number) {
  demo = newDemoWindow(learner.window_memory, ms);
  lastClose = 0;
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
