/** Frozen, prospective measurement only. No entry, tuning or promotion authority. */
import { takerFeeCents } from "./clock.ts";
import { brier, logLoss, V3_MIN_TRAIN, type V3Features, type V3Prediction, type V3Weights } from "./chair-v3.ts";
import { isCountable } from "./research-quality.ts";
import { tickerAgrees } from "./window-identity.ts";
import type { AdmissionAudit, AdmissionCheck } from "./admission-audit";
import type { ChairResult, Snapshot, Vote } from "./types";

export const CALL_QUALITY_STUDY = "entry-time-v1";
export const CALL_QUALITY_HORIZONS = [450, 300, 180] as const;
export const CALL_QUALITY_RULES = Object.freeze({
  checkpoint_band_seconds: 12, max_frame_age_seconds: 10,
  min_train: V3_MIN_TRAIN, train_cap: 1800, min_ask: 80, max_ask_exclusive: 99,
  max_spread: 2, min_edge_after_fee: 3, extra_cost_cents: 1,
  review_windows: 300, review_days: 30, review_priced_calls: 250,
});
type Side = "UP" | "DOWN";
const side = (s: unknown): s is Side => s === "UP" || s === "DOWN";
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;
const avg = (xs: number[]) => xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
// The first deployment had no Chair authority tags. Preserve those receipts,
// but count only their explicit admission checks rather than guess hard/soft.
const failedEntryCheck = (c: AdmissionCheck) => c.pass === false && (c.blocking ?? !c.id.startsWith("chair:"));

/** First observed frame in the 12 seconds BEFORE a checkpoint. No late catch-up. */
export function qualityHorizon(s: Pick<Snapshot, "as_of" | "close_time" | "demo">, now: number): number | null {
  if (s.demo || !finite(s.as_of) || !finite(s.close_time) || !finite(now) ||
      s.as_of > now || now - s.as_of > CALL_QUALITY_RULES.max_frame_age_seconds * 1000 || now >= s.close_time) return null;
  const seconds = (s.close_time - s.as_of) / 1000;
  return CALL_QUALITY_HORIZONS.find(h => seconds >= h && seconds < h + CALL_QUALITY_RULES.checkpoint_band_seconds) ?? null;
}

export type QualityReceipt = {
  quality_issues: string[]; market_p: number | null; model: V3Prediction | null; features: V3Features;
  model_trained_through: number | null;
  model_weights: V3Weights | null;
  chair_lean: string; chair_strength: number; regime: string; session: string;
  audit: AdmissionAudit;
  quotes: { yes_ask: number; yes_bid: number; no_ask: number; no_bid: number; yes_size: number; no_size: number };
  seats: { seat: string; lean: string; strength: number | null; health: string; heard: boolean }[];
  candidate: { side: Side; ask: number; fee: number; edge: number } | null;
};

export function qualityIssues(s: Snapshot): string[] {
  const issues: string[] = [];
  if (!s.ticker || s.close_time % 900_000 !== 0 || tickerAgrees(s.ticker, s.close_time) !== true) issues.push("unverified_market_identity");
  if (!isCountable(s.close_time)) issues.push("excluded_window");
  if (s.health.spot !== "LIVE" || s.health.kalshi !== "LIVE" || !s.health.spot_ok || !s.health.kalshi_ok ||
      s.health.spot_divergent || s.health.basis_wide || s.obs?.gap !== "ok") issues.push("unhealthy_feeds");
  const receiptAge = (s.as_of - s.obs?.receipt_ts) / 1000;
  if (!finite(receiptAge) || receiptAge < 0 || receiptAge > 10 || !finite(s.quote_age_s) || s.quote_age_s < 0 || s.quote_age_s > 10 ||
      !finite(s.spot_age_s) || s.spot_age_s < 0 || s.spot_age_s > 15) issues.push("stale_observation");
  if (![s.yes_bid, s.yes_ask, s.no_bid, s.no_ask, s.yes_bid_size, s.no_bid_size, s.yes_mid].every(finite) ||
      !(s.yes_bid >= 0 && s.yes_bid <= s.yes_ask && s.yes_ask < 100 && s.no_bid >= 0 && s.no_bid <= s.no_ask && s.no_ask < 100 &&
        s.yes_mid > 0 && s.yes_mid < 100 && s.yes_mid >= s.yes_bid && s.yes_mid <= s.yes_ask && s.yes_ask + s.no_ask >= 100 &&
        s.yes_bid_size >= 0 && s.no_bid_size >= 0)) issues.push("invalid_book");
  return issues;
}

/** This is a quoted-cost hypothetical, never a booked fill or execution claim. */
export function qualityCandidate(s: Snapshot, prediction: V3Prediction | null): QualityReceipt["candidate"] {
  if (qualityIssues(s).length || !prediction || prediction.model_n < V3_MIN_TRAIN) return null;
  const options = (["UP", "DOWN"] as const).flatMap(direction => {
    const ask = direction === "UP" ? s.yes_ask : s.no_ask;
    const bid = direction === "UP" ? s.yes_bid : s.no_bid;
    const size = direction === "UP" ? s.no_bid_size : s.yes_bid_size;
    const fee = takerFeeCents(ask);
    const edge = (direction === "UP" ? prediction.p_up : 1 - prediction.p_up) * 100 - ask - fee;
    return ask >= CALL_QUALITY_RULES.min_ask && ask < CALL_QUALITY_RULES.max_ask_exclusive &&
      ask - bid <= CALL_QUALITY_RULES.max_spread && size >= 1 && edge >= CALL_QUALITY_RULES.min_edge_after_fee
      ? [{ side: direction, ask, fee, edge: round(edge) }] : [];
  });
  return options.sort((a, b) => b.edge - a.edge)[0] ?? null;
}

export function captureQuality(s: Snapshot, c: ChairResult, votes: Vote[], audit: AdmissionAudit,
  features: V3Features, model: V3Prediction | null, trainedThrough: number | null, weights: V3Weights | null = null): QualityReceipt {
  const issues = qualityIssues(s);
  const accepted = new Set(c.rows.filter(r => !r.folded && r.health === "LIVE" && side(r.lean) &&
    !["MUTED", "VETO", "DOWN", "UNCALIBRATED", "FOLDED"].includes(r.status)).map(r => r.seat));
  return {
    quality_issues: issues, market_p: finite(s.yes_mid) && s.yes_mid > 0 && s.yes_mid < 100 ? s.yes_mid / 100 : null,
    model: issues.length ? null : model, features, model_trained_through: trainedThrough, model_weights: weights,
    chair_lean: c.lean, chair_strength: c.confidence, regime: s.regime_key, session: s.session, audit,
    quotes: { yes_ask: s.yes_ask, yes_bid: s.yes_bid, no_ask: s.no_ask, no_bid: s.no_bid, yes_size: s.yes_bid_size, no_size: s.no_bid_size },
    seats: votes.map(v => ({ seat: v.seat, lean: v.raw_lean ?? v.lean,
      strength: finite(v.raw_conf ?? v.confidence) ? (v.raw_conf ?? v.confidence) : null,
      health: v.health, heard: accepted.has(v.seat) })),
    candidate: qualityCandidate(s, issues.length ? null : model),
  };
}

export type QualityObservation = {
  ticker: string; close_ms: number; taken_ms: number; recorded_ms: number; horizon: number; entry_policy: string;
  receipt: QualityReceipt; capture_valid: boolean; winner: string | null; source: string | null; research_quality: string | null;
};

/** Recheck late quarantines at read time; missing, unofficial and bad records are never losses or WAITs. */
export function qualityEligibility(r: QualityObservation): "graded" | "pending" | "excluded" {
  if (!r.capture_valid || r.receipt.quality_issues.length || tickerAgrees(r.ticker, r.close_ms) !== true || !isCountable(r.close_ms) ||
      !finite(r.taken_ms) || !finite(r.recorded_ms) || r.recorded_ms < r.taken_ms || r.recorded_ms >= r.close_ms ||
      r.taken_ms > r.close_ms - r.horizon * 1000 || r.taken_ms <= r.close_ms - (r.horizon + 12) * 1000 ||
      (r.research_quality != null && r.research_quality !== "valid")) return "excluded";
  return side(r.winner) && r.source === "kalshi-result" ? "graded" : "pending";
}

export function wilsonInterval(hits: number, n: number): [number, number] | null {
  if (!n) return null;
  const z = 1.96, p = hits / n, denominator = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / denominator;
  const half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denominator;
  return [round(Math.max(0, center - half)), round(Math.min(1, center + half))];
}

export function netSummary(nets: number[]) {
  let net = 0, peak = 0, drawdown = 0;
  for (const n of nets) { net += n; peak = Math.max(peak, net); drawdown = Math.min(drawdown, net - peak); }
  const wins = nets.filter(n => n > 0).length;
  return { n: nets.length, wins, net_cents: round(net, 1), avg_cents: avg(nets), max_drawdown_cents: round(drawdown, 1),
    win_rate: nets.length ? round(wins / nets.length) : null, win_interval: wilsonInterval(wins, nets.length) };
}

/** Coverage starts at the first retained receipt; allow ten seconds for an in-flight save. */
export function checkpointCoverage(rows: QualityObservation[], now: number) {
  if (!rows.length) return { expected: 0, recorded: 0, missing: 0 };
  const first = Math.min(...rows.map(r => r.taken_ms));
  const safeNow = now - 10_000;
  let expected = 0, recorded = 0;
  for (const horizon of CALL_QUALITY_HORIZONS) {
    const firstClose = Math.ceil((first + horizon * 1000) / 900_000) * 900_000;
    const lastClose = Math.floor((safeNow + horizon * 1000) / 900_000) * 900_000;
    expected += Math.max(0, (lastClose - firstClose) / 900_000 + 1);
    recorded += rows.filter(r => r.horizon === horizon && r.close_ms >= firstClose && r.close_ms <= lastClose).length;
  }
  return { expected, recorded, missing: Math.max(0, expected - recorded) };
}

/** Each policy × horizon remains a separate population. Three looks are never pooled as three independent windows. */
export function qualityReport(input: QualityObservation[], now: number) {
  const rows = [...input].sort((a, b) => a.close_ms - b.close_ms);
  const policies = [...new Set(rows.map(r => r.entry_policy))];
  return policies.flatMap(policy => CALL_QUALITY_HORIZONS.map(horizon => {
    const all = rows.filter(r => r.horizon === horizon && r.entry_policy === policy);
    const graded = all.filter(r => qualityEligibility(r) === "graded");
    const modeled = graded.filter(r => r.receipt.model && r.receipt.model.model_n >= V3_MIN_TRAIN && r.receipt.market_p != null);
    const priced = modeled.filter(r => r.receipt.candidate);
    const cents = (r: QualityObservation) => (r.receipt.candidate!.side === r.winner ? 100 : 0) - r.receipt.candidate!.ask - r.receipt.candidate!.fee;
    const mb = modeled.map(r => brier(r.receipt.market_p!, r.winner as Side));
    const vb = modeled.map(r => brier(r.receipt.model!.p_up, r.winner as Side));
    const seats = [...new Set(graded.flatMap(r => r.receipt.seats.map(s => s.seat)))].map(seat => {
      const readings = graded.flatMap(r => {
        const s = r.receipt.seats.find(v => v.seat === seat);
        return s && s.health === "LIVE" && side(s.lean) && r.receipt.market_p != null ? [{ r, s }] : [];
      });
      const hits = readings.filter(({ r, s }) => s.lean === r.winner).length;
      const marketHits = readings.filter(({ r }) => (r.receipt.market_p! >= .5 ? "UP" : "DOWN") === r.winner).length;
      return { seat, n: readings.length, hit_rate: readings.length ? round(hits / readings.length) : null,
        market_hit_rate: readings.length ? round(marketHits / readings.length) : null, interval: wilsonInterval(hits, readings.length) };
    });
    const waits = graded.filter(r => !r.receipt.audit.positioned && !r.receipt.audit.eligible);
    const blockers = [...new Set(waits.flatMap(r => r.receipt.audit.checks.filter(failedEntryCheck).map(c => c.id)))].map(id => {
      const blocked = waits.filter(r => r.receipt.audit.checks.some(c => c.id === id && failedEntryCheck(c)));
      const quoted = blocked.filter(r => r.receipt.candidate);
      return { id, label: blocked[0]!.receipt.audit.checks.find(c => c.id === id)!.label, n: blocked.length,
        candidate_n: quoted.length, candidate_net_cents: quoted.length ? round(quoted.reduce((a, r) => a + cents(r), 0), 1) : null };
    }).sort((a, b) => b.n - a.n);
    const days = modeled.length ? Math.max(0, (now - Math.min(...modeled.map(r => r.taken_ms))) / 86_400_000) : 0;
    return { policy, horizon, captured: all.length, graded: graded.length, paired: modeled.length,
      pending: all.filter(r => qualityEligibility(r) === "pending").length,
      excluded: all.filter(r => qualityEligibility(r) === "excluded").length,
      warmup: graded.length - modeled.length, days: Math.floor(days),
      sample_ready: modeled.length >= CALL_QUALITY_RULES.review_windows && days >= CALL_QUALITY_RULES.review_days && priced.length >= CALL_QUALITY_RULES.review_priced_calls,
      market_brier: avg(mb), model_brier: avg(vb), brier_improvement: avg(mb.map((v, i) => v - vb[i]!)),
      market_log_loss: avg(modeled.map(r => logLoss(r.receipt.market_p!, r.winner as Side))),
      model_log_loss: avg(modeled.map(r => logLoss(r.receipt.model!.p_up, r.winner as Side))),
      quoted: netSummary(priced.map(cents)), stressed: netSummary(priced.map(r => cents(r) - CALL_QUALITY_RULES.extra_cost_cents)),
      calibration: [0, .2, .4, .6, .8].map((lo, i) => {
        const bucket = modeled.filter(r => Math.min(4, Math.floor(r.receipt.model!.p_up * 5)) === i);
        const hits = bucket.filter(r => r.winner === "UP").length;
        return { lo, n: bucket.length, predicted: avg(bucket.map(r => r.receipt.model!.p_up)), observed: bucket.length ? round(hits / bucket.length) : null,
          interval: wilsonInterval(hits, bucket.length) };
      }), seats, blockers,
    };
  }));
}
