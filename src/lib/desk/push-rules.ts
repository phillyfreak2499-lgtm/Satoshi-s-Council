/** Who gets a settle push. Pure, so it can be tested without a push service. */
export function settleWanted(sub: { token: string | null }, chairCalled: boolean, humans: Map<string, number>): boolean {
  if (chairCalled) return true;
  return Boolean(sub.token && humans.has(sub.token));
}

/**
 * The desk watchdog, pure. The desk grades a window every fifteen minutes
 * around the clock, so a long quiet spell means something is wrong: dead
 * feeds, a stuck tick loop, or Kalshi results that stopped arriving. One
 * alert when the quiet passes WATCHDOG_QUIET_MS, a reminder every
 * WATCHDOG_REPEAT_MS while it lasts, one recovery note when grading resumes.
 */
export const WATCHDOG_QUIET_MS = 20 * 60_000;
export const WATCHDOG_REPEAT_MS = 60 * 60_000;

export type WatchdogState = { alertedAt: number; alerts: number; quietSince: number };
export type WatchdogDecision =
  | { kind: "quiet" }
  | { kind: "alert"; quietMs: number; nth: number }
  | { kind: "recovered"; quietMs: number };

export function freshWatchdog(): WatchdogState {
  return { alertedAt: 0, alerts: 0, quietSince: 0 };
}

export function watchdogDecision(i: {
  now: number;
  lastGradeAt: number;
  state: WatchdogState;
  quietMs?: number;
  repeatMs?: number;
}): WatchdogDecision {
  const quiet = i.quietMs ?? WATCHDOG_QUIET_MS;
  const repeat = i.repeatMs ?? WATCHDOG_REPEAT_MS;
  const since = i.now - i.lastGradeAt;
  const alerted = i.state.alerts > 0;
  if (since < quiet) {
    return alerted ? { kind: "recovered", quietMs: Math.max(0, i.lastGradeAt - i.state.quietSince) } : { kind: "quiet" };
  }
  if (!alerted || i.now - i.state.alertedAt >= repeat) return { kind: "alert", quietMs: since, nth: i.state.alerts + 1 };
  return { kind: "quiet" };
}

/** The state after acting on a decision. */
export function applyWatchdog(state: WatchdogState, d: WatchdogDecision, now: number, lastGradeAt: number): WatchdogState {
  if (d.kind === "alert") {
    return { alertedAt: now, alerts: state.alerts + 1, quietSince: state.alerts === 0 ? lastGradeAt : state.quietSince };
  }
  if (d.kind === "recovered") return freshWatchdog();
  return state;
}

export type WatchdogPayload = { title: string; body: string; tag: string; url: string };

function hhmmUtc(t: number): string {
  return new Date(t).toISOString().slice(11, 16);
}

/** What the owner reads on the phone. Short, specific, and the same tag so a reminder replaces the last one. */
export function watchdogPayload(
  d: Exclude<WatchdogDecision, { kind: "quiet" }>,
  ctx: { lastGradeAt: number; lastError: string | null; feeds: string; tickAgeS: number },
): WatchdogPayload {
  const mins = Math.round(d.quietMs / 60_000);
  if (d.kind === "recovered") {
    return { title: "Desk watchdog", body: `grading again after ${mins} min quiet · last graded ${hhmmUtc(ctx.lastGradeAt)} UTC`, tag: "watchdog", url: "/" };
  }
  const tick = ctx.tickAgeS < 0 ? "no tick yet" : `tick ${ctx.tickAgeS}s ago`;
  const err = ctx.lastError ? ctx.lastError.slice(0, 90) : "no error logged";
  const nth = d.nth > 1 ? ` (reminder ${d.nth})` : "";
  return {
    title: `Desk watchdog${nth}`,
    body: `no window graded for ${mins} min · last ${hhmmUtc(ctx.lastGradeAt)} UTC · ${tick} · ${ctx.feeds} · ${err}`.slice(0, 220),
    tag: "watchdog",
    url: "/",
  };
}
