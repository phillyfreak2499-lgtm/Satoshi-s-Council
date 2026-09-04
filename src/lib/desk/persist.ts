import { SKILL_RULES } from "./dsl";
import { freshLearner } from "./skills";
import { mergeThresholds } from "./thresholds";
import type { CallLogRow, DataSource, Learner, SeatId, Settings } from "./types";

const KEY = "satoshi-desk-v1";
const LIVE_KEY = "satoshi-desk-v1-live";
const CALL_KEY = "satoshi-desk-v1-calls";
const LIVE_CALL_KEY = "satoshi-desk-v1-live-calls";

export const DEFAULT_SETTINGS: Settings = {
  poll_ms: 4000,
  source: import.meta.env.PROD ? "live" : "demo",
  bar_override: null,
  adaptive_bar: true,
  mutes: [],
  show_faded: true,
  show_shadow: true,
  tz: "America/Chicago",
  beast: false,
};

export type Persisted = {
  settings: Settings;
  learner: Learner;
};

function sliceLearner(learner: Learner): Learner {
  return {
    ...learner,
    settle_tape: learner.settle_tape.slice(0, 40),
    huddle_log: learner.huddle_log.slice(0, 16),
  };
}

function mergeLearner(saved?: Partial<Learner> | null): Learner {
  const base = freshLearner();
  if (!saved) return base;
  const learner: Learner = { ...base, ...saved };
  const savedSkills = saved.skills ?? {};
  learner.skills = { ...base.skills };
  for (const [id, card] of Object.entries(savedSkills)) {
    const seed = base.skills[id];
    learner.skills[id] = {
      ...(seed ?? card),
      ...card,
      rule: card.rule ?? seed?.rule ?? SKILL_RULES[id],
    };
  }
  learner.seat_recent = { ...base.seat_recent, ...(saved.seat_recent ?? {}) };
  learner.fade_strength = { ...base.fade_strength, ...(saved.fade_strength ?? {}) };
  learner.seat_n = { ...base.seat_n, ...(saved.seat_n ?? {}) };
  learner.seat_hits = { ...base.seat_hits, ...(saved.seat_hits ?? {}) };
  learner.seat_calls = { ...base.seat_calls, ...(saved.seat_calls ?? {}) };
  learner.seat_calib_debt = { ...(saved.seat_calib_debt ?? {}) };
  learner.seat_review_at = { ...(saved.seat_review_at ?? {}) };
  learner.seat_w = { ...base.seat_w, ...(saved.seat_w ?? {}) };
  learner.seat_scalp = saved.seat_scalp ?? {};
  if (learner.lockdown_windows_left == null) learner.lockdown_windows_left = 0;
  learner.thresholds = mergeThresholds(saved.thresholds);
  learner.last_feats = saved.last_feats ?? {};
  learner.last_regime = saved.last_regime ?? "";
  learner.pattern_book = saved.pattern_book ?? {};
  learner.window_patterns = saved.window_patterns ?? [];
  for (const st of Object.values(learner.pattern_book)) {
    if (st.ev_sum == null) st.ev_sum = 0;
    if (st.ev_n == null) st.ev_n = 0;
    if (st.ev == null) st.ev = 0;
    if (!st.last20) st.last20 = [];
    if (st.n > 0) st.wilson = st.wilson || 0;
  }
  if (!learner.last_huddle_n) learner.last_huddle_n = 0;
  if (learner.chair_ev_sum == null) learner.chair_ev_sum = 0;
  if (learner.chair_ev_n == null) learner.chair_ev_n = 0;
  if (learner.chair_wait_n == null) learner.chair_wait_n = 0;
  if (learner.chair_wait_good == null) learner.chair_wait_good = 0;
  if (!learner.wf_chair) learner.wf_chair = [];
  if (!learner.window_memory.tapes) learner.window_memory.tapes = [];
  for (const card of Object.values(learner.skills)) {
    if (card.ev_sum == null) card.ev_sum = 0;
    if (card.ev_n == null) card.ev_n = 0;
    if (card.ev == null) card.ev = 0;
  }
  return learner;
}

function readMain(): Persisted {
  const fallback: Persisted = { settings: { ...DEFAULT_SETTINGS }, learner: freshLearner() };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<Persisted>;
    const settings = { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) };
    settings.mutes = (settings.mutes ?? []).filter(Boolean) as SeatId[];
    return { settings, learner: mergeLearner(p.learner) };
  } catch {
    return fallback;
  }
}

export function loadLearner(source: DataSource): Learner {
  if (source !== "live") return readMain().learner;
  if (typeof window === "undefined") return freshLearner();
  try {
    const raw = localStorage.getItem(LIVE_KEY);
    if (!raw) return freshLearner();
    return mergeLearner(JSON.parse(raw) as Partial<Learner>);
  } catch {
    return freshLearner();
  }
}

export function loadPersisted(): Persisted {
  const main = readMain();
  const unused =
    (main.learner.graded_windows ?? 0) === 0 &&
    Object.values(main.learner.seat_n ?? {}).every((n) => !n);
  if (import.meta.env.PROD && main.settings.source === "demo" && unused) {
    main.settings = { ...main.settings, source: "live" };
  }
  if (main.settings.source === "live") {
    return { settings: main.settings, learner: loadLearner("live") };
  }
  return main;
}

export function savePersisted(p: Persisted) {
  if (typeof window === "undefined") return;
  try {
    const sliced = sliceLearner(p.learner);
    if (p.settings.source === "live") {
      localStorage.setItem(LIVE_KEY, JSON.stringify(sliced));
      const main = readMain();
      localStorage.setItem(
        KEY,
        JSON.stringify({ settings: p.settings, learner: sliceLearner(main.learner) }),
      );
    } else {
      localStorage.setItem(KEY, JSON.stringify({ settings: p.settings, learner: sliced }));
    }
  } catch {
    /* quota */
  }
}

function callKey(source: DataSource) {
  return source === "live" ? LIVE_CALL_KEY : CALL_KEY;
}

export function loadCallLog(source: DataSource = "demo"): CallLogRow[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(callKey(source));
    if (!raw) return [];
    const rows = JSON.parse(raw) as CallLogRow[];
    return Array.isArray(rows) ? rows.filter((r) => r && (r.lean === "UP" || r.lean === "DOWN") && r.cents > 0) : [];
  } catch {
    return [];
  }
}

export function saveCallLog(rows: CallLogRow[], source: DataSource = "demo") {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(callKey(source), JSON.stringify(rows.slice(0, 80)));
  } catch {
    /* quota */
  }
}
