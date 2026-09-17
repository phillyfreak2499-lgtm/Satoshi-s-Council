/** Read-only Chair v3 historical research. Nothing here votes, books, grades, or promotes. */
import { getSql } from "@/lib/db";
import { tickerAgrees } from "./window-identity";
import {
  V3_FEATURES,
  V3_MAX_ADJUSTMENT,
  V3_MIN_TRAIN,
  V3_VERSION,
  fitV3,
  v3FeaturesFromStored,
  walkForwardV3,
  type V3FeatureName,
  type V3FitRow,
} from "./chair-v3";

const ROW_CAP = 1800;
const CACHE_MS = 10 * 60_000;

type StoredRow = {
  ticker: string;
  close_ms: number | string;
  winner: string;
  features: Record<string, unknown> | null;
  market: Record<string, unknown> | null;
};

type Bucket = {
  label: string;
  n: number;
  market_brier: number | null;
  v3_brier: number | null;
  delta: number | null;
};

export type ChairV3Snapshot = {
  at: string;
  version: number;
  evidence: "historical-strict-walk-forward";
  authority: { live_chair: false; paper_book: false; promotion: false; writes: false };
  design: {
    prior: "kalshi-mid";
    correction: "ridge-logistic-offset";
    max_adjustment_pp: number;
    min_train: number;
  };
  rows: number;
  scored: number;
  market_brier: number | null;
  v3_brier: number | null;
  brier_delta: number | null;
  market_log_loss: number | null;
  v3_log_loss: number | null;
  avg_abs_adjustment_pp: number | null;
  max_abs_adjustment_pp: number | null;
  adjustment_buckets: Bucket[];
  fitted: null | { n: number; bias: number; weights: { feature: V3FeatureName; weight: number }[] };
  recent: { close_time: string; winner: "UP" | "DOWN"; market_p: number; v3_p: number; adjustment_pp: number }[];
};

let cache: { expiresAt: number; value: ChairV3Snapshot } | null = null;
let pending: Promise<ChairV3Snapshot> | null = null;

const finite = (n: unknown): number | null => {
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
};
const round = (n: number, d = 6) => Math.round(n * 10 ** d) / 10 ** d;

function asFitRow(r: StoredRow): V3FitRow | null {
  if (r.winner !== "UP" && r.winner !== "DOWN") return null;
  const close = finite(r.close_ms);
  const mid = finite(r.market?.yes_mid);
  const fair = finite(r.market?.fair_yes);
  if (close == null || tickerAgrees(r.ticker, close) !== true || mid == null || !(mid > 0 && mid < 100)) return null;
  const marketP = mid / 100;
  return {
    close_time: close,
    winner: r.winner,
    market_p: marketP,
    features: v3FeaturesFromStored(r.features, marketP, fair == null ? null : fair / 100),
  };
}

function bucketReport(points: ReturnType<typeof walkForwardV3>["points"]): Bucket[] {
  const defs: { label: string; lo: number; hi: number }[] = [
    { label: "0-2pp", lo: 0, hi: 2 },
    { label: "2-5pp", lo: 2, hi: 5 },
    { label: "5-8pp", lo: 5, hi: 8 },
    { label: "8-10pp", lo: 8, hi: 10.001 },
  ];
  return defs.map(({ label, lo, hi }) => {
    const xs = points.filter((p) => Math.abs(p.adjustment_pp) >= lo && Math.abs(p.adjustment_pp) < hi);
    if (!xs.length) return { label, n: 0, market_brier: null, v3_brier: null, delta: null };
    const avg = (ys: number[]) => ys.reduce((a, b) => a + b, 0) / ys.length;
    const mb = avg(xs.map((p) => (p.market_p - (p.winner === "UP" ? 1 : 0)) ** 2));
    const vb = avg(xs.map((p) => (p.v3_p - (p.winner === "UP" ? 1 : 0)) ** 2));
    return { label, n: xs.length, market_brier: round(mb), v3_brier: round(vb), delta: round(mb - vb) };
  });
}

async function buildSnapshot(): Promise<ChairV3Snapshot> {
  const sql = await getSql();
  const raw = await sql<StoredRow>`
    select
      ticker,
      (extract(epoch from close_time) * 1000)::bigint as close_ms,
      winner,
      features,
      market
    from (
      select s.ticker, s.close_time, l.winner, s.features, s.market
      from desk_samples s
      join desk_ledger_research l on l.ticker = s.ticker and l.close_time = s.close_time
      where l.winner in ('UP', 'DOWN') and l.source = 'kalshi-result' and s.taken_at < s.close_time
      order by s.close_time desc
      limit ${ROW_CAP}
    ) q
    order by close_time asc
  `;
  const rows = raw.map(asFitRow).filter((r): r is V3FitRow => Boolean(r));
  const wf = walkForwardV3(rows);
  const final = fitV3(rows);
  const recent = wf.points.slice(-16).reverse().map((p) => ({
    close_time: new Date(p.close_time).toISOString(),
    winner: p.winner,
    market_p: round(p.market_p, 4),
    v3_p: round(p.v3_p, 4),
    adjustment_pp: p.adjustment_pp,
  }));
  const value: ChairV3Snapshot = {
    at: new Date().toISOString(),
    version: V3_VERSION,
    evidence: "historical-strict-walk-forward",
    authority: { live_chair: false, paper_book: false, promotion: false, writes: false },
    design: { prior: "kalshi-mid", correction: "ridge-logistic-offset", max_adjustment_pp: V3_MAX_ADJUSTMENT * 100, min_train: V3_MIN_TRAIN },
    rows: rows.length,
    scored: wf.n_scored,
    market_brier: wf.market_brier,
    v3_brier: wf.v3_brier,
    brier_delta: wf.brier_delta,
    market_log_loss: wf.market_log_loss,
    v3_log_loss: wf.v3_log_loss,
    avg_abs_adjustment_pp: wf.avg_abs_adjustment_pp,
    max_abs_adjustment_pp: wf.max_abs_adjustment_pp,
    adjustment_buckets: bucketReport(wf.points),
    fitted: final ? {
      n: final.n,
      bias: round(final.bias, 4),
      weights: V3_FEATURES.map((feature) => ({ feature, weight: round(final.w[feature], 4) })).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)),
    } : null,
    recent,
  };
  cache = { expiresAt: Date.now() + CACHE_MS, value };
  return value;
}

export async function chairV3Snapshot(): Promise<ChairV3Snapshot> {
  if (cache && Date.now() < cache.expiresAt) return cache.value;
  pending ??= buildSnapshot().finally(() => { pending = null; });
  return pending;
}
