import { wilsonLower } from "./math";
import { BOOK_FAMILY, CANDLE_FAMILY, DERIVS_FAMILY, EVIDENCE_OF, type EvidenceFamily } from "./seats";
import { THRESH_SPECS } from "./thresholds";
import type { FeedHealth, Lean, SeatId, SessionName, Snapshot } from "./types";

export type Regime = "QUIET" | "TREND" | "EXPAND" | "CHOP";

export type OrbitRead = {
  regime: Regime;
  quiet: boolean;
  trend: boolean;
  expand: boolean;
  weekend: boolean;
  session: SessionName;
  aggressiveness: number;
};

export type WireRead = {
  fng: number;
  label: string;
  delta7: number;
  extreme: boolean;
  hot: boolean;
  ok: boolean;
  lean: Lean;
};

export type SemanticFail = {
  id: string;
  family: "spot" | "kalshi" | "derivs";
  why: string;
};

export type WardenRead = {
  bothDown: boolean;
  oneDown: boolean;
  seqLost: boolean;
  derivsDown: boolean;
  basisWide: boolean;
  fails: SemanticFail[];
  spotBad: boolean;
  kalshiBad: boolean;
  derivsBad: boolean;
  silent: SeatId[];
  skill: "WARDEN.both_down" | "WARDEN.seq_gap" | "WARDEN.derivs_down" | "WARDEN.semantic" | "SIT";
};

export function isWeekend(ts: number): boolean {
  const d = new Date(ts).getUTCDay();
  return d === 0 || d === 6;
}

export function readOrbit(snap: Snapshot): OrbitRead {
  const atrDead = THRESH_SPECS["atr.dead"]?.base ?? 0.12;
  const volDead = THRESH_SPECS["vol.dead_pct"]?.base ?? 25;
  const atrExp = THRESH_SPECS["atr.expand"]?.base ?? 0.22;
  const volHot = THRESH_SPECS["vol.hot_pct"]?.base ?? 80;
  const quiet = snap.atr_pct < atrDead || snap.vol_percentile < volDead;
  const trend = Math.abs(snap.ret1h) >= 0.012 && snap.vol_percentile >= 60;
  const expand = !quiet && (snap.atr_pct >= atrExp || snap.vol_percentile >= volHot);
  const weekend = isWeekend(snap.as_of);
  const regime: Regime = quiet ? "QUIET" : trend ? "TREND" : expand ? "EXPAND" : "CHOP";
  let aggressiveness = regime === "QUIET" ? 0.35 : regime === "CHOP" ? 0.55 : regime === "TREND" ? 0.85 : 0.8;
  if (weekend) aggressiveness *= 0.85;
  return {
    regime,
    quiet,
    trend,
    expand,
    weekend,
    session: snap.session,
    aggressiveness,
  };
}

export function detectQuiet(snap: Snapshot): boolean {
  return readOrbit(snap).quiet;
}

export function detectTrendDay(snap: Snapshot): boolean {
  return readOrbit(snap).trend;
}

export function readWire(snap: Snapshot): WireRead {
  const fng = snap.fear_greed;
  const ok = Number.isFinite(fng) && snap.fear_greed_label !== "DOWN";
  const hist = snap.fng_history;
  const delta7 = hist.length >= 2 ? hist[hist.length - 1]! - hist[0]! : 0;
  const lo = THRESH_SPECS["fng.lo"]?.base ?? 20;
  const hi = THRESH_SPECS["fng.hi"]?.base ?? 80;
  const extreme = ok && (fng <= lo || fng >= hi);
  const hot = extreme && ((fng >= hi && delta7 >= 0) || (fng <= lo && delta7 <= 0));
  let lean: Lean = "WAIT";
  if (hot) lean = fng >= hi ? "DOWN" : "UP";
  return { fng, label: snap.fear_greed_label, delta7, extreme, hot, ok, lean };
}

function missing1m(snap: Snapshot): boolean {
  const bars = snap.candles_1m.filter((c) => c.closed).slice(-20);
  if (bars.length < 8) return false;
  for (let i = 1; i < bars.length; i++) {
    if (bars[i]!.t - bars[i - 1]!.t > 90_000) return true;
  }
  return false;
}

function frozenOi(snap: Snapshot): boolean {
  const s = snap.oi_series.slice(-4);
  if (s.length < 3) return false;
  const v0 = s[0]!.v;
  if (!(v0 > 0) || s.some((p) => p.v !== v0)) return false;
  return s[s.length - 1]!.t - s[0]!.t >= 8 * 60_000;
}

/**
 * STALE — the spot feed returning fresh timestamps but a frozen value. Four or
 * more consecutive closed 1-minute bars with an identical close, spanning at
 * least four minutes, is a stuck feed, not a quiet market: BTC does not print
 * the same price to the cent for four minutes. Mirrors frozenOi for the tape.
 */
function frozenSpot(snap: Snapshot): boolean {
  const bars = snap.candles_1m.filter((c) => c.closed).slice(-5);
  if (bars.length < 4) return false;
  const c0 = bars[0]!.close;
  if (!(c0 > 0) || bars.some((b) => b.close !== c0)) return false;
  return bars[bars.length - 1]!.t - bars[0]!.t >= 4 * 60_000;
}

export function semanticFails(snap: Snapshot): SemanticFail[] {
  const out: SemanticFail[] = [];
  if (!(snap.spot > 1000) || snap.spot > 500_000) out.push({ id: "px", family: "spot", why: "impossible spot" });
  if (missing1m(snap)) out.push({ id: "gap1m", family: "spot", why: "missing 1m bar" });
  if (!(snap.strike > 1000)) out.push({ id: "strike", family: "kalshi", why: "zero/bad strike" });
  if (snap.yes_bid > 0 && snap.yes_ask > 0 && snap.yes_bid > snap.yes_ask + 0.5) {
    out.push({ id: "crossed", family: "kalshi", why: "crossed YES book" });
  }
  if (snap.no_bid > 0 && snap.no_ask > 0 && snap.no_bid > snap.no_ask + 0.5) {
    out.push({ id: "crossed_no", family: "kalshi", why: "crossed NO book" });
  }
  if (snap.yes_bid > 0 && snap.no_bid > 0 && snap.yes_bid + snap.no_bid > 100.5) {
    out.push({ id: "locked", family: "kalshi", why: "YES+NO bids > 100" });
  }
  if (frozenOi(snap) && snap.health.derivs === "LIVE") {
    out.push({ id: "oi_frozen", family: "derivs", why: "OI frozen ≥ 8m" });
  }
  if (frozenSpot(snap) && snap.health.spot !== "DOWN") {
    out.push({ id: "spot_frozen", family: "spot", why: "spot frozen ≥ 4m" });
  }
  return out;
}

export function isProxyCascade(snap: Snapshot): boolean {
  if (!(snap.liq_n >= 1) || snap.liq_source === "DOWN") return true;
  return /proxy/i.test(snap.liq_source);
}

export function evidenceOf(seat: SeatId, snap: Snapshot): EvidenceFamily {
  if (seat === "CASCADE" && isProxyCascade(snap)) return "candle";
  return EVIDENCE_OF[seat];
}

export function readWarden(snap: Snapshot): WardenRead {
  const bothDown = snap.health.spot === "DOWN" && snap.health.kalshi === "DOWN";
  const oneDown = snap.health.spot === "DOWN" || snap.health.kalshi === "DOWN";
  const seqLost = snap.obs.gap === "gap" || snap.obs.gap === "held" || snap.obs.gap === "reconnect";
  const derivsDown = snap.health.derivs === "DOWN";
  const basisWide = Boolean(snap.health.basis_wide);
  const fails = bothDown ? [] : semanticFails(snap);
  const spotBad = fails.some((f) => f.family === "spot");
  const kalshiBad = fails.some((f) => f.family === "kalshi") || seqLost;
  const derivsBad = fails.some((f) => f.family === "derivs") || derivsDown;
  const silent = new Set<SeatId>();
  if (seqLost || fails.some((f) => f.family === "kalshi")) {
    for (const id of BOOK_FAMILY) silent.add(id);
  }
  if (spotBad) {
    for (const id of CANDLE_FAMILY) silent.add(id);
    silent.add("STRIKE");
    silent.add("VEL");
  }
  if (derivsBad) for (const id of DERIVS_FAMILY) silent.add(id);
  const skill = bothDown
    ? "WARDEN.both_down"
    : seqLost
      ? "WARDEN.seq_gap"
      : fails.length
        ? "WARDEN.semantic"
        : derivsDown
          ? "WARDEN.derivs_down"
          : "SIT";
  return {
    bothDown,
    oneDown,
    seqLost,
    derivsDown,
    basisWide,
    fails,
    spotBad,
    kalshiBad,
    derivsBad,
    silent: [...silent],
    skill,
  };
}

export function clockPrior(
  hits: number,
  n: number,
): { lean: Lean; hit: number; wilson: number } {
  if (n < 8) return { lean: "WAIT", hit: 0.5, wilson: 0 };
  const upW = wilsonLower(hits, n);
  const dnW = wilsonLower(n - hits, n);
  const hit = hits / n;
  if (upW >= 0.55) return { lean: "UP", hit, wilson: upW };
  if (dnW >= 0.55) return { lean: "DOWN", hit, wilson: dnW };
  return { lean: "WAIT", hit, wilson: Math.max(upW, dnW) };
}

export function wireHealth(snap: Snapshot): FeedHealth {
  return readWire(snap).ok ? "LIVE" : "DOWN";
}
