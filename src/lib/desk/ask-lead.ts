/**
 * ASK_LEAD_SWAP_V1 — measurement only.
 *
 * Research question: how often does the higher Kalshi ask change sides inside
 * one 15-minute window, and when on the clock does that happen?
 *
 * No 90¢ filter. No bot. No Chair. No paper fill. Authority: none.
 *
 * Lead = the side whose ask is strictly higher.
 * A swap is a confirmed YES↔NO lead change. Ties keep the last clear lead
 * and do not count. A one-snapshot flicker must hold on the next snapshot.
 * The first confirmed lead in a window is the open, not a swap.
 */
export const ASK_LEAD_STUDY = "ASK_LEAD_SWAP_V1" as const;
export const ASK_LEAD_VERSION = 1 as const;
export const ASK_LEAD_MEASUREMENT = "ask-lead-swap-v1" as const;

export type AskLead = "YES" | "NO";
export type AskLeadRead = AskLead | "TIE" | "INVALID";
export type SwapBucket = "15_10" | "10_5" | "5_2" | "last_2";

export type AskLeadTick = {
  yes_ask: number | null;
  no_ask: number | null;
  secs_left: number;
  as_of_ms: number;
};

export type AskLeadSwap = {
  from: AskLead;
  to: AskLead;
  secs_left: number;
  bucket: SwapBucket | null;
  yes_ask: number;
  no_ask: number;
  as_of_ms: number;
};

export type AskLeadState = {
  last_clear: AskLead | null;
  pending: AskLead | null;
  snapshots: number;
  ties: number;
  invalid: number;
  swap_count: number;
  first_lead: AskLead | null;
  first_lead_secs: number | null;
  last_lead: AskLead | null;
  last_lead_secs: number | null;
  first_swap_secs: number | null;
  last_swap_secs: number | null;
  buckets: Record<SwapBucket, number>;
};

export const EMPTY_ASK_LEAD_STATE: AskLeadState = Object.freeze({
  last_clear: null,
  pending: null,
  snapshots: 0,
  ties: 0,
  invalid: 0,
  swap_count: 0,
  first_lead: null,
  first_lead_secs: null,
  last_lead: null,
  last_lead_secs: null,
  first_swap_secs: null,
  last_swap_secs: null,
  buckets: Object.freeze({ "15_10": 0, "10_5": 0, "5_2": 0, last_2: 0 }),
}) as AskLeadState;

export function validAsk(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 100 ? n : null;
}

export function leadFromAsks(yesAsk: number | null, noAsk: number | null): AskLeadRead {
  if (yesAsk == null || noAsk == null) return "INVALID";
  if (yesAsk === noAsk) return "TIE";
  return yesAsk > noAsk ? "YES" : "NO";
}

export function swapBucket(secsLeft: number): SwapBucket | null {
  if (!Number.isFinite(secsLeft) || secsLeft < 0) return null;
  if (secsLeft <= 120) return "last_2";
  if (secsLeft <= 300) return "5_2";
  if (secsLeft <= 600) return "10_5";
  if (secsLeft <= 900) return "15_10";
  return null;
}

/** America/Chicago pocket so weekend vs weekday hours can be compared later. */
export function sessionPocket(closeMs: number): string {
  if (!Number.isFinite(closeMs)) return "unknown";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(closeMs));
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  if (weekday === "Sat" || weekday === "Sun") return "weekend";
  if (!Number.isFinite(hour)) return "weekday";
  if (hour < 6) return "weekday_night";
  if (hour < 11) return "weekday_us_am";
  if (hour < 14) return "weekday_mid";
  if (hour < 17) return "weekday_us_pm";
  if (hour < 21) return "weekday_eve";
  return "weekday_late";
}

function copyState(s: AskLeadState): AskLeadState {
  return {
    ...s,
    buckets: { ...s.buckets },
  };
}

export function applyAskLeadTick(
  prev: AskLeadState,
  tick: AskLeadTick,
): { state: AskLeadState; swap: AskLeadSwap | null } {
  const state = copyState(prev);
  state.snapshots += 1;
  const yes = validAsk(tick.yes_ask);
  const no = validAsk(tick.no_ask);
  const read = leadFromAsks(yes, no);

  if (read === "INVALID") {
    state.invalid += 1;
    state.pending = null;
    return { state, swap: null };
  }
  if (read === "TIE") {
    state.ties += 1;
    state.pending = null;
    return { state, swap: null };
  }

  if (state.last_clear == null) {
    if (state.pending === read) {
      state.last_clear = read;
      state.first_lead = read;
      state.first_lead_secs = tick.secs_left;
      state.last_lead = read;
      state.last_lead_secs = tick.secs_left;
      state.pending = null;
    } else {
      state.pending = read;
    }
    return { state, swap: null };
  }

  if (read === state.last_clear) {
    state.pending = null;
    state.last_lead = read;
    state.last_lead_secs = tick.secs_left;
    return { state, swap: null };
  }

  if (state.pending !== read) {
    state.pending = read;
    return { state, swap: null };
  }

  const from = state.last_clear;
  const bucket = swapBucket(tick.secs_left);
  state.swap_count += 1;
  if (bucket) state.buckets[bucket] += 1;
  if (state.first_swap_secs == null) state.first_swap_secs = tick.secs_left;
  state.last_swap_secs = tick.secs_left;
  state.last_clear = read;
  state.last_lead = read;
  state.last_lead_secs = tick.secs_left;
  state.pending = null;
  return {
    state,
    swap: {
      from,
      to: read,
      secs_left: tick.secs_left,
      bucket,
      yes_ask: yes as number,
      no_ask: no as number,
      as_of_ms: tick.as_of_ms,
    },
  };
}

export function lastLeadMatchesWinner(lastLead: AskLead | null, winner: "UP" | "DOWN" | string | null): boolean | null {
  if (lastLead == null || (winner !== "UP" && winner !== "DOWN")) return null;
  return (lastLead === "YES" && winner === "UP") || (lastLead === "NO" && winner === "DOWN");
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
