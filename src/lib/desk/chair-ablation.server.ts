/**
 * Prospective fixed-horizon Chair ablations.
 *
 * This module writes ONLY desk_chair_ablation. It never calls noteCall,
 * applyDeskOp, selectiveBlock, learner writers, or any production actuator.
 * All variants are recomputed from cloned frame data and have authority:none.
 */
import { getSql } from "@/lib/db";
import { runChair } from "./chair";
import { takerFeeCents } from "./clock";
import { qualityHorizon, qualityIssues } from "./call-quality";
import { ledgerCitesFor } from "./ledger-clerk.server";
import { DEFAULT_SETTINGS } from "./persist";
import { softenTimeGates } from "./time-gates";
import {
  CHAIR_ABLATION_STUDY,
  CHAIR_ABLATION_VERSION,
  carryOffWhenChain,
  releaseDirectionalAuthority,
  rescueReviewedPaper,
  reviewedPaperDirectionals,
  tapeOff,
} from "./chair-ablation";
import type { ChairResult, Learner, Settings, Snapshot, Vote } from "./types";

const HORIZONS = [450, 300, 180] as const;
const OBSERVER_MS = 2_000;

type Observer = {
  timer: ReturnType<typeof setInterval> | null;
  busy: boolean;
  seen: Map<string, number>;
  lastCapture: number | null;
  error: string | null;
};

const g = globalThis as typeof globalThis & { __chairAblation__?: Observer };
const state = (): Observer =>
  (g.__chairAblation__ ??= {
    timer: null,
    busy: false,
    seen: new Map(),
    lastCapture: null,
    error: null,
  });

const directional = (lean: unknown): lean is "UP" | "DOWN" => lean === "UP" || lean === "DOWN";
const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

function compactChair(chair: ChairResult) {
  const heard = chair.rows
    .filter(
      (row) =>
        directional(row.lean) &&
        !row.forced_sit &&
        !["MUTED", "VETO", "DOWN", "UNCALIBRATED", "FOLDED"].includes(row.status),
    )
    .map((row) => row.seat);
  return {
    lean: chair.lean,
    confidence: chair.confidence,
    score: round(chair.score),
    bar: round(chair.bar),
    hard_fail: chair.hard_fail,
    quorum: chair.quorum,
    categories_agree: chair.categories_agree,
    sit_mass: round(chair.sit_mass),
    conflict_frac: round(chair.conflict_frac),
    heard,
  };
}

function coreChair(votes: Vote[], snap: Snapshot, learner: Learner, settings: Settings): ChairResult {
  const copiedVotes = votes.map((vote) => ({ ...vote }));
  const cites = ledgerCitesFor(copiedVotes);
  return softenTimeGates(runChair(copiedVotes, snap, learner, settings, "WAIT", cites), snap);
}

async function capture(): Promise<void> {
  const st = state();
  if (st.busy) return;
  st.busy = true;
  try {
    const { getServerFrame, currentSnap } = await import("./server-engine");
    const current = currentSnap();
    if (!current || qualityHorizon(current, Date.now()) == null) return;

    const frame = await getServerFrame();
    const frozen = structuredClone({
      snap: frame.snap,
      votes: frame.votes,
      chair: frame.chair,
      learner: frame.learner,
      settings: frame.settings,
      policy: frame.selective.policy,
    });
    const { snap, votes, chair, learner } = frozen;
    if (!snap || !chair || qualityIssues(snap).length) return;
    const horizon = qualityHorizon(snap, Date.now());
    if (horizon == null) return;

    const key = `${snap.ticker}|${snap.close_time}|${horizon}`;
    for (const [seenKey, close] of st.seen) {
      if (close < Date.now() - 900_000) st.seen.delete(seenKey);
    }
    if (st.seen.has(key)) return;

    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      ...frozen.settings,
      source: "live",
    };

    const control = coreChair(votes, snap, learner, settings);
    const tape = coreChair(tapeOff(votes), snap, learner, settings);
    const carryVotes = carryOffWhenChain(votes);
    const carry = coreChair(carryVotes, snap, learner, settings);

    const authorityRelease = releaseDirectionalAuthority(votes, learner, false);
    const authority = coreChair(authorityRelease.votes, snap, authorityRelease.learner, settings);

    const rawRelease = releaseDirectionalAuthority(votes, learner, true);
    const raw = coreChair(rawRelease.votes, snap, rawRelease.learner, settings);

    const reviewedPaperRescue = rescueReviewedPaper(votes, learner);
    const reviewed = coreChair(
      reviewedPaperRescue.votes,
      snap,
      reviewedPaperRescue.learner,
      settings,
    );

    const baseBySeat = new Map(votes.map((vote) => [vote.seat, vote]));
    const authorityHeld = control.rows
      .filter((row) => row.forced_sit && directional(baseBySeat.get(row.seat)?.lean))
      .map((row) => row.seat);
    const upstreamGagged = votes
      .filter((vote) => vote.lean === "WAIT" && directional(vote.raw_lean))
      .map((vote) => vote.seat);

    // A slow write must not relabel a later checkpoint as this frozen frame.
    if (qualityHorizon(snap, Date.now()) !== horizon) return;

    const variants = {
      control_core: compactChair(control),
      tape_off: compactChair(tape),
      carry_off_when_chain: compactChair(carry),
      authority_release: compactChair(authority),
      raw_release: compactChair(raw),
      reviewed_paper_rescue: compactChair(reviewed),
    };
    const seatState = {
      post_whisper_directional: votes.filter((vote) => directional(vote.lean)).map((vote) => vote.seat),
      raw_directional: votes.filter((vote) => directional(vote.raw_lean)).map((vote) => vote.seat),
      authority_held: authorityHeld,
      upstream_gagged: upstreamGagged,
      authority_release: authorityRelease.released,
      raw_release: rawRelease.released,
      reviewed_paper_directional: reviewedPaperDirectionals(votes),
      reviewed_paper_rescue: reviewedPaperRescue.released,
      chain_directional: votes.some((vote) => vote.seat === "CHAIN" && directional(vote.lean)),
    };
    const market = {
      yes_bid: snap.yes_bid,
      yes_ask: snap.yes_ask,
      no_bid: snap.no_bid,
      no_ask: snap.no_ask,
      yes_mid: snap.yes_mid,
      fair_yes: snap.fair_yes,
      mins_left: snap.mins_left,
      regime: snap.regime_key,
    };

    const db = await getSql();
    await db`
      insert into desk_chair_ablation
        (study, version, ticker, close_time, horizon, taken_at, entry_policy,
         actual_chair, variants, seat_state, market, build_sha)
      values
        (${CHAIR_ABLATION_STUDY}, ${CHAIR_ABLATION_VERSION}, ${snap.ticker},
         ${new Date(snap.close_time).toISOString()}::timestamptz, ${horizon},
         ${new Date(snap.as_of).toISOString()}::timestamptz, ${frozen.policy},
         ${JSON.stringify(compactChair(chair))}::jsonb,
         ${JSON.stringify(variants)}::jsonb,
         ${JSON.stringify(seatState)}::jsonb,
         ${JSON.stringify(market)}::jsonb,
         ${process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? ""})
      on conflict (study, ticker, close_time, horizon) do nothing
    `;
    st.seen.set(key, snap.close_time);
    st.lastCapture = Date.now();
    st.error = null;
  } catch (error) {
    st.error = error instanceof Error ? error.message : String(error);
  } finally {
    st.busy = false;
  }
}

export function ensureChairAblationObserver(): void {
  const st = state();
  if (st.timer) return;
  st.timer = setInterval(() => void capture(), OBSERVER_MS);
  void capture();
}

type Stored = {
  ticker: string;
  close_time: Date | string;
  horizon: number;
  taken_at: Date | string;
  variants: Record<string, ReturnType<typeof compactChair>>;
  seat_state: {
    authority_held?: string[];
    upstream_gagged?: string[];
  };
  market: {
    yes_ask?: number;
    no_ask?: number;
  };
  winner: "UP" | "DOWN";
};

function quotedNet(row: Stored, variant: ReturnType<typeof compactChair>): number | null {
  if (!directional(variant.lean)) return null;
  const ask = Number(variant.lean === "UP" ? row.market?.yes_ask : row.market?.no_ask);
  if (!(ask > 0) || !(ask < 100)) return null;
  return (variant.lean === row.winner ? 100 : 0) - ask - takerFeeCents(ask);
}

function summarize(rows: Stored[], variantId: string) {
  const usable = rows.filter((row) => row.variants?.[variantId]);
  const directionalRows = usable.filter((row) => directional(row.variants[variantId]!.lean));
  const hits = directionalRows.filter((row) => row.variants[variantId]!.lean === row.winner).length;
  const priced = directionalRows.flatMap((row) => {
    const net = quotedNet(row, row.variants[variantId]!);
    return net == null ? [] : [net];
  });
  const changed = usable.filter(
    (row) => row.variants.control_core && row.variants[variantId]!.lean !== row.variants.control_core.lean,
  );
  const waitToDirectional = usable.filter(
    (row) =>
      row.variants.control_core?.lean === "WAIT" &&
      directional(row.variants[variantId]!.lean),
  ).length;
  const directionalToWait = usable.filter(
    (row) =>
      directional(row.variants.control_core?.lean) &&
      row.variants[variantId]!.lean === "WAIT",
  ).length;
  return {
    n: usable.length,
    directional_n: directionalRows.length,
    directional_rate: usable.length ? round(directionalRows.length / usable.length) : null,
    hits,
    accuracy: directionalRows.length ? round(hits / directionalRows.length) : null,
    quoted_n: priced.length,
    quoted_net_cents: priced.length ? round(priced.reduce((a, b) => a + b, 0), 1) : null,
    quoted_avg_cents: priced.length ? round(priced.reduce((a, b) => a + b, 0) / priced.length, 2) : null,
    changed_vs_control: changed.length,
    wait_to_directional: waitToDirectional,
    directional_to_wait: directionalToWait,
  };
}

async function buildSnapshot() {
  const db = await getSql();
  const rows = await db<Stored>`
    select a.ticker, a.close_time, a.horizon, a.taken_at, a.variants, a.seat_state, a.market, l.winner
      from desk_chair_ablation a
      join desk_ledger_research l on l.ticker = a.ticker and l.close_time = a.close_time
     where a.study = ${CHAIR_ABLATION_STUDY}
       and l.winner in ('UP','DOWN')
       and a.close_time >= now() - interval '60 days'
     order by a.close_time, a.horizon desc
  `;
  const variants = ["control_core", "tape_off", "carry_off_when_chain", "authority_release", "raw_release", "reviewed_paper_rescue"];
  const byHorizon = HORIZONS.map((horizon) => {
    const own = rows.filter((row) => Number(row.horizon) === horizon);
    return {
      horizon,
      samples: own.length,
      authority_held_events: own.reduce((n, row) => n + (row.seat_state?.authority_held?.length ?? 0), 0),
      upstream_gagged_events: own.reduce((n, row) => n + (row.seat_state?.upstream_gagged?.length ?? 0), 0),
      variants: Object.fromEntries(variants.map((variant) => [variant, summarize(own, variant)])),
    };
  });
  const st = state();
  return {
    at: new Date().toISOString(),
    study: CHAIR_ABLATION_STUDY,
    version: CHAIR_ABLATION_VERSION,
    authority: "none" as const,
    note: "Chair-core counterfactuals only; quoted economics are not booked fills and do not bypass Floor admission.",
    by_horizon: byHorizon,
    overall: {
      samples: rows.length,
      authority_held_events: rows.reduce((n, row) => n + (row.seat_state?.authority_held?.length ?? 0), 0),
      upstream_gagged_events: rows.reduce((n, row) => n + (row.seat_state?.upstream_gagged?.length ?? 0), 0),
      variants: Object.fromEntries(variants.map((variant) => [variant, summarize(rows, variant)])),
    },
    observer: {
      started: Boolean(st.timer),
      last_capture: st.lastCapture ? new Date(st.lastCapture).toISOString() : null,
      error: st.error,
    },
  };
}

export type ChairAblationSnapshot = Awaited<ReturnType<typeof buildSnapshot>>;

let cache: { at: number; value: ChairAblationSnapshot } | null = null;
let pending: Promise<ChairAblationSnapshot> | null = null;

export async function chairAblationSnapshot(): Promise<ChairAblationSnapshot> {
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  pending ??= buildSnapshot()
    .then((value) => {
      cache = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

export function chairAblationHealth() {
  const st = state();
  return {
    started: Boolean(st.timer),
    last_capture: st.lastCapture,
    error: st.error,
  };
}
