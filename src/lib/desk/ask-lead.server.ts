/**
 * ASK_LEAD_SWAP_V1 prospective observer.
 *
 * Samples live Kalshi asks through the window, confirms lead changes on
 * consecutive snapshots, and writes only desk_ask_lead_windows / swaps.
 * No return path into Chair, learner, entry policy, promotion, or the paper book.
 */
import { getSql } from "@/lib/db";
import {
  ASK_LEAD_MEASUREMENT,
  ASK_LEAD_STUDY,
  ASK_LEAD_VERSION,
  EMPTY_ASK_LEAD_STATE,
  applyAskLeadTick,
  lastLeadMatchesWinner,
  median,
  sessionPocket,
  type AskLead,
  type AskLeadState,
  type AskLeadSwap,
  type SwapBucket,
} from "./ask-lead";
import { tickerAgrees } from "./window-identity";

export const ASK_LEAD_PROSPECTIVE_SINCE = Date.parse("2026-09-21T02:00:00.000Z");
const OBSERVER_MS = 2_000;

type Track = {
  key: string;
  ticker: string;
  close_ms: number;
  state: AskLeadState;
  pendingSwaps: AskLeadSwap[];
  persistedSwaps: number;
};

type Observer = {
  timer: ReturnType<typeof setInterval> | null;
  inFlight: boolean;
  track: Track | null;
  lastError: string | null;
  lastCapturedAt: number;
};

const g = globalThis as typeof globalThis & { __askLeadObserver__?: Observer };

function observer(): Observer {
  return (g.__askLeadObserver__ ??= {
    timer: null,
    inFlight: false,
    track: null,
    lastError: null,
    lastCapturedAt: 0,
  });
}

async function persistWindow(track: Track, finalized: boolean): Promise<void> {
  const db = await getSql();
  const s = track.state;
  const pocket = sessionPocket(track.close_ms);
  await db`
    insert into desk_ask_lead_windows (
      ticker, close_time, study, version, measurement_version,
      samples, ties, invalid, swaps, first_lead, first_lead_secs,
      last_lead, last_lead_secs, first_swap_secs, last_swap_secs,
      b_15_10, b_10_5, b_5_2, b_last_2, session_pocket,
      finalized, updated_at, build_sha
    ) values (
      ${track.ticker},
      ${new Date(track.close_ms).toISOString()}::timestamptz,
      ${ASK_LEAD_STUDY},
      ${ASK_LEAD_VERSION},
      ${ASK_LEAD_MEASUREMENT},
      ${s.snapshots},
      ${s.ties},
      ${s.invalid},
      ${s.swap_count},
      ${s.first_lead},
      ${s.first_lead_secs},
      ${s.last_lead},
      ${s.last_lead_secs},
      ${s.first_swap_secs},
      ${s.last_swap_secs},
      ${s.buckets["15_10"]},
      ${s.buckets["10_5"]},
      ${s.buckets["5_2"]},
      ${s.buckets.last_2},
      ${pocket},
      ${finalized},
      clock_timestamp(),
      ${process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? ""}
    )
    on conflict (ticker, close_time) do update set
      samples = excluded.samples,
      ties = excluded.ties,
      invalid = excluded.invalid,
      swaps = excluded.swaps,
      first_lead = excluded.first_lead,
      first_lead_secs = excluded.first_lead_secs,
      last_lead = excluded.last_lead,
      last_lead_secs = excluded.last_lead_secs,
      first_swap_secs = excluded.first_swap_secs,
      last_swap_secs = excluded.last_swap_secs,
      b_15_10 = excluded.b_15_10,
      b_10_5 = excluded.b_10_5,
      b_5_2 = excluded.b_5_2,
      b_last_2 = excluded.b_last_2,
      session_pocket = excluded.session_pocket,
      finalized = desk_ask_lead_windows.finalized or excluded.finalized,
      updated_at = clock_timestamp()
  `;

  for (const [i, ev] of track.pendingSwaps.entries()) {
    const swapN = track.persistedSwaps + i + 1;
    await db`
      insert into desk_ask_lead_swaps (
        ticker, close_time, swap_n, from_side, to_side, secs_left, bucket,
        yes_ask, no_ask, taken_at
      ) values (
        ${track.ticker},
        ${new Date(track.close_ms).toISOString()}::timestamptz,
        ${swapN},
        ${ev.from},
        ${ev.to},
        ${ev.secs_left},
        ${ev.bucket},
        ${ev.yes_ask},
        ${ev.no_ask},
        ${new Date(ev.as_of_ms).toISOString()}::timestamptz
      )
      on conflict (ticker, close_time, swap_n) do nothing
    `;
  }
  track.persistedSwaps += track.pendingSwaps.length;
  track.pendingSwaps = [];
}

async function captureOnce(): Promise<void> {
  const st = observer();
  if (st.inFlight || Date.now() < ASK_LEAD_PROSPECTIVE_SINCE) return;
  st.inFlight = true;
  try {
    const { getServerFrame } = await import("./server-engine");
    const frame = await getServerFrame();
    const snap = frame.snap;
    if (!snap || snap.demo || snap.as_of < ASK_LEAD_PROSPECTIVE_SINCE) return;
    if (!snap.ticker || tickerAgrees(snap.ticker, snap.close_time) !== true) return;

    const key = `${snap.ticker}|${snap.close_time}`;
    if (st.track && st.track.key !== key) {
      await persistWindow(st.track, true);
      st.track = null;
    }
    if (!st.track) {
      st.track = {
        key,
        ticker: snap.ticker,
        close_ms: Number(snap.close_time),
        state: { ...EMPTY_ASK_LEAD_STATE, buckets: { ...EMPTY_ASK_LEAD_STATE.buckets } },
        pendingSwaps: [],
        persistedSwaps: 0,
      };
    }

    const stepped = applyAskLeadTick(st.track.state, {
      yes_ask: Number(snap.yes_ask),
      no_ask: Number(snap.no_ask),
      secs_left: Number(snap.secs_left),
      as_of_ms: Number(snap.as_of) || Date.now(),
    });
    st.track.state = stepped.state;
    if (stepped.swap) st.track.pendingSwaps.push(stepped.swap);
    await persistWindow(st.track, Number(snap.secs_left) <= 2);
    st.lastCapturedAt = Date.now();
    st.lastError = null;
  } catch (err) {
    st.lastError = err instanceof Error ? err.message : String(err);
  } finally {
    st.inFlight = false;
  }
}

export function ensureAskLeadObserver(): void {
  const st = observer();
  if (st.timer) return;
  st.timer = setInterval(() => void captureOnce(), OBSERVER_MS);
  void captureOnce();
}

export function askLeadHealth() {
  const st = observer();
  return {
    started: Boolean(st.timer),
    last_captured_at: st.lastCapturedAt ? new Date(st.lastCapturedAt).toISOString() : null,
    last_error: st.lastError,
    live_swaps: st.track?.state.swap_count ?? 0,
    live_lead: st.track?.state.last_clear ?? null,
  };
}

const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

export type AskLeadSnapshot = {
  study: typeof ASK_LEAD_STUDY;
  since: string;
  measurement_version: string;
  authority: { live_chair: false; paper_book: false; learner: false; promotion: false };
  windows: number;
  with_lead: number;
  avg_swaps: number | null;
  share_0: number | null;
  share_1: number | null;
  share_2plus: number | null;
  buckets: Record<SwapBucket, number>;
  median_first_swap_secs: number | null;
  median_last_swap_secs: number | null;
  last_lead_n: number;
  last_lead_won: number;
  last_lead_rate: number | null;
  weekend: { n: number; avg_swaps: number | null };
  weekday: { n: number; avg_swaps: number | null };
  health: ReturnType<typeof askLeadHealth>;
};

type Row = {
  swaps: number;
  first_lead: AskLead | null;
  last_lead: AskLead | null;
  first_swap_secs: number | null;
  last_swap_secs: number | null;
  b_15_10: number;
  b_10_5: number;
  b_5_2: number;
  b_last_2: number;
  session_pocket: string | null;
  winner: string | null;
};

export async function askLeadSnapshot(): Promise<AskLeadSnapshot> {
  const db = await getSql();
  const rows = await db<Row>`
    select
      w.swaps, w.first_lead, w.last_lead, w.first_swap_secs, w.last_swap_secs,
      w.b_15_10, w.b_10_5, w.b_5_2, w.b_last_2, w.session_pocket, l.winner
    from desk_ask_lead_windows w
    left join desk_ledger_research l
      on l.ticker = w.ticker and l.close_time = w.close_time and l.source = 'kalshi-result'
    where w.study = ${ASK_LEAD_STUDY}
      and w.version = ${ASK_LEAD_VERSION}
      and w.measurement_version = ${ASK_LEAD_MEASUREMENT}
      and w.close_time >= ${new Date(ASK_LEAD_PROSPECTIVE_SINCE).toISOString()}
    order by w.close_time asc
  `;

  const withLead = rows.filter((r) => r.first_lead === "YES" || r.first_lead === "NO");
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const swaps = withLead.map((r) => Number(r.swaps) || 0);
  const n0 = swaps.filter((n) => n === 0).length;
  const n1 = swaps.filter((n) => n === 1).length;
  const n2 = swaps.filter((n) => n >= 2).length;
  const firstSwapSecs = withLead
    .filter((r) => Number(r.swaps) > 0 && r.first_swap_secs != null)
    .map((r) => Number(r.first_swap_secs));
  const lastSwapSecs = withLead
    .filter((r) => Number(r.swaps) > 0 && r.last_swap_secs != null)
    .map((r) => Number(r.last_swap_secs));
  const graded = withLead.filter((r) => r.winner === "UP" || r.winner === "DOWN");
  const lastWon = graded.reduce((n, r) => {
    const hit = lastLeadMatchesWinner(r.last_lead, r.winner);
    return n + (hit ? 1 : 0);
  }, 0);
  const weekend = withLead.filter((r) => r.session_pocket === "weekend");
  const weekday = withLead.filter((r) => r.session_pocket != null && r.session_pocket !== "weekend");
  const buckets: Record<SwapBucket, number> = {
    "15_10": withLead.reduce((n, r) => n + Number(r.b_15_10 || 0), 0),
    "10_5": withLead.reduce((n, r) => n + Number(r.b_10_5 || 0), 0),
    "5_2": withLead.reduce((n, r) => n + Number(r.b_5_2 || 0), 0),
    last_2: withLead.reduce((n, r) => n + Number(r.b_last_2 || 0), 0),
  };

  return {
    study: ASK_LEAD_STUDY,
    since: new Date(ASK_LEAD_PROSPECTIVE_SINCE).toISOString(),
    measurement_version: ASK_LEAD_MEASUREMENT,
    authority: { live_chair: false, paper_book: false, learner: false, promotion: false },
    windows: rows.length,
    with_lead: withLead.length,
    avg_swaps: swaps.length ? round(avg(swaps) ?? 0) : null,
    share_0: swaps.length ? round(n0 / swaps.length) : null,
    share_1: swaps.length ? round(n1 / swaps.length) : null,
    share_2plus: swaps.length ? round(n2 / swaps.length) : null,
    buckets,
    median_first_swap_secs: median(firstSwapSecs),
    median_last_swap_secs: median(lastSwapSecs),
    last_lead_n: graded.length,
    last_lead_won: lastWon,
    last_lead_rate: graded.length ? round(lastWon / graded.length) : null,
    weekend: { n: weekend.length, avg_swaps: weekend.length ? round(avg(weekend.map((r) => Number(r.swaps) || 0)) ?? 0) : null },
    weekday: { n: weekday.length, avg_swaps: weekday.length ? round(avg(weekday.map((r) => Number(r.swaps) || 0)) ?? 0) : null },
    health: askLeadHealth(),
  };
}
