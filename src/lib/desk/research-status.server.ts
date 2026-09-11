/**
 * The research board's data (server only). Read-only.
 *
 * One row per thing the desk started measuring in Phase 2, answering the only
 * question that matters before any of it is believed: how much of this sample
 * was recorded AFTER the definition was fixed?
 *
 * The seat watchlist is here too, and it is a watchlist rather than a finding.
 * Six seats produced a first reading on how their objections relate to the
 * market's calibration — two looked informative, four looked backwards. Those
 * are listed so the sample can be watched growing. Nothing is inverted, nothing
 * is rewarded, and the numbers carry the same prospective/retrospective split as
 * every other row.
 */
import { getSql } from "@/lib/db";
import { sessionOf, phaseOf } from "./math";
import {
  FROZEN_AT,
  researchBoard,
  researchRow,
  type ResearchBoard,
  type ResearchRow,
} from "./research-status.ts";
import { QTY_FIX_AT } from "./research-era.ts";
import { MIN_AGAINST, marketSide } from "./seat-signal.ts";
import { isCountable } from "./research-quality.ts";

const TTL_MS = 300_000;

/** The moment the replay began carrying shadow microstructure. */
const REPLAY_SHADOW_SINCE = "2026-09-11T03:02:30Z";
export type ResearchStudy = ResearchBoard & { at: string; authority: { promotes_nothing: true } };

let cache: { at: number; board: ResearchStudy } | null = null;

/** The six seats whose first objection reading was surprising, watched not acted on. */
const WATCHLIST: Record<string, string> = {
  DRIFT: "first read: market overconfident by ~9.5 points when it objects — watching, not rewarded",
  CASCADE:
    "first read: market overconfident by ~7.6 points when it objects — watching, not rewarded",
  CHAIN:
    "first read: market MORE right than it claims when it objects (~11 points) — watching, not inverted",
  TAPE: "first read: market MORE right than it claims when it objects (~8 points) — watching, not inverted",
  WICK: "first read: market MORE right than it claims when it objects (~7 points) — watching, not inverted",
  FADE: "first read: market MORE right than it claims when it objects (~5 points) — watching, not inverted",
};

type ReplayRow = { close_time: string; created_at: string; cols: Record<string, unknown> | null };
type SampleRow = {
  close_time: string;
  mins_left: number | null;
  winner: string | null;
  features: Record<string, unknown> | null;
  market: { yes_mid?: number } | null;
};

const regimeKey = (t: number, mins: number) => `${sessionOf(t)}_${phaseOf(mins)}`;

/** The shadow traces the replay records, and how to read a sample as directional. */
const TRACES: {
  col: string;
  id: string;
  family: string;
  note: string;
  restarted?: boolean;
  why?: string;
}[] = [
  { col: "imb", id: "TAPE2.imb_l5", family: "TAPE 2.0", note: "depth imbalance five levels in" },
  {
    col: "micro",
    id: "TAPE2.micro_minus_mid",
    family: "TAPE 2.0",
    note: "size-weighted price against the midpoint",
  },
  {
    col: "ofi",
    id: "TAPE2.ofi_norm_15s",
    family: "TAPE 2.0",
    note: "normalised order-flow imbalance over 15s",
    restarted: true,
    why:
      "divided by residue levels until the book dropped them at the quantity fix; every earlier record is " +
      "unusable and none is pooled",
  },
  {
    col: "cancel",
    id: "TAPE2.cancel_share",
    family: "TAPE 2.0",
    note: "share of book churn that was cancels",
  },
  {
    col: "tflow",
    id: "TAPE2.trade_imb_15s",
    family: "TAPE 2.0",
    note: "net executed size over 15s",
  },
  {
    col: "resid",
    id: "VEL2.residual_30s",
    family: "VEL 2.0",
    note: "the 30s YES move BTC does not explain",
  },
  {
    col: "lead",
    id: "VEL2.lead_30s",
    family: "VEL 2.0",
    note: "which market moved first over 30s",
  },
];

export async function researchStudy(): Promise<ResearchStudy> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.board;
  const db = await getSql();
  const rows: ResearchRow[] = [];

  // ---- the replay traces -------------------------------------------------
  const replays = await db<ReplayRow>`
    select close_time, created_at, cols from desk_replay
    where winner in ('UP','DOWN') order by close_time
  `;
  for (const t of TRACES) {
    let n = 0;
    let prospective = 0;
    let directional = 0;
    const regimes: Record<string, number> = {};
    for (const r of replays) {
      const arr = r.cols?.[t.col];
      if (!Array.isArray(arr)) continue;
      if (!isCountable(r.close_time)) continue; // a replay of an invalid window is not a trace
      n += 1;
      // A window counts as prospective when its replay was WRITTEN after the
      // clock started — the row is only as new as the code that produced it.
      if (Date.parse(r.created_at) >= Date.parse(REPLAY_SHADOW_SINCE)) {
        prospective += 1;
        const close = Date.parse(r.close_time);
        const k = regimeKey(close, 7.5);
        regimes[k] = (regimes[k] ?? 0) + 1;
      }
      // Directional: the trace said something other than nothing at least once
      // in this window. A feature that is null or flat all window is not evidence.
      if (arr.some((v) => v != null && Number(v) !== 0)) directional += 1;
    }
    rows.push(
      researchRow({
        id: t.id,
        family: t.family,
        n,
        prospective_n: prospective,
        // A corrected measurement's clock is the CORRECTION, not the day recording
        // began. Read from the shared boundary so it cannot drift from the era
        // split the studies use.
        since: t.restarted ? QTY_FIX_AT : REPLAY_SHADOW_SINCE,
        since_why:
          t.why ??
          `recorded from the deploy that added the shadow traces; definitions frozen ${FROZEN_AT}`,
        regime_n: regimes,
        directional,
        result: null,
        note: t.note,
        restarted: t.restarted,
      }),
    );
  }

  // ---- the seat watchlist ------------------------------------------------
  const samples = await db<SampleRow>`
    select close_time, mins_left, winner, features, market
    from desk_samples where winner in ('UP','DOWN') and features is not null
    order by close_time
  `;
  for (const [seat, note] of Object.entries(WATCHLIST)) {
    let against = 0;
    let prospective = 0;
    let spoke = 0;
    const regimes: Record<string, number> = {};
    for (const s of samples) {
      const winner = s.winner === "UP" || s.winner === "DOWN" ? s.winner : null;
      const m = marketSide(Number(s.market?.yes_mid));
      const ev = Number(s.features?.[seat]);
      if (!winner || !m || !Number.isFinite(ev) || ev === 0) continue;
      if (!isCountable(s.close_time)) continue; // the sample table carries no quality column
      spoke += 1;
      const side = ev > 0 ? "UP" : "DOWN";
      if (side === m.side) continue;
      against += 1;
      const close = Date.parse(s.close_time);
      if (close >= Date.parse(`${FROZEN_AT}T00:00:00Z`)) {
        prospective += 1;
        const k = regimeKey(close, Number(s.mins_left) || 7.5);
        regimes[k] = (regimes[k] ?? 0) + 1;
      }
    }
    rows.push(
      researchRow({
        id: `SEAT.${seat}.objection`,
        family: "seat watchlist",
        n: against,
        prospective_n: prospective,
        since: FROZEN_AT,
        since_why:
          "the first reading came from windows before this date and is not evidence for itself",
        regime_n: regimes,
        directional: spoke,
        result: null,
        note,
        // A seat's objection is rarer than a window, so it is held to the same
        // bar the seat-signal study uses rather than the board's default.
        min: MIN_AGAINST,
      }),
    );
  }

  // ---- absorption, the next primary hypothesis --------------------------
  try {
    const abs = await db<{ n: number; post: number; graded: number }>`
      select count(*)::int as n,
             count(*) filter (where era = 'post-qty-fix')::int as post,
             count(*) filter (where era = 'post-qty-fix' and winner in ('UP','DOWN'))::int as graded
      from desk_absorption
    `;
    const a = abs[0] ?? { n: 0, post: 0, graded: 0 };
    const byRegime = await db<{ regime: string; n: number }>`
      select coalesce(regime,'') as regime, count(*)::int as n from desk_absorption
      where era = 'post-qty-fix' group by 1
    `;
    rows.push(
      researchRow({
        id: "WHALE2.absorption",
        family: "WHALE 2.0",
        n: a.n,
        prospective_n: a.graded,
        since: QTY_FIX_AT,
        since_why:
          "every measurement depends on order-book sizes, so only prints recorded after the quantity fix count",
        regime_n: Object.fromEntries(byRegime.filter((r) => r.regime).map((r) => [r.regime, r.n])),
        directional: a.post,
        result: null,
        note:
          "aggressive size crossed and the price did not respond - judged against the market's own implied " +
          "probability, not a hit rate",
      }),
    );
  } catch {
    // The table arrives with migration 0023; before it runs the row is simply
    // absent, rather than a zero that would read as "measured, found nothing".
  }

  const board: ResearchStudy = {
    ...researchBoard(rows),
    at: new Date().toISOString(),
    authority: { promotes_nothing: true },
  };
  cache = { at: Date.now(), board };
  return board;
}
