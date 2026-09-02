/** Convert each venue to USD / 8h / ms BEFORE combining. Never mix native sizes. */

export type SizeUnit = "btc" | "contract" | "usd";
export type ContractKind = "linear" | "inverse" | "spot";

export type VenueSpec = {
  size: SizeUnit;
  kind: ContractKind;
  /** Native contract value (BTC for linear, USD for inverse). */
  ctVal: number;
  /** Venue multiplier (OKX ctMult, usually 1). */
  ctMult: number;
  fundingHours: number;
};

const FALLBACK: VenueSpec = {
  size: "btc",
  kind: "linear",
  ctVal: 1,
  ctMult: 1,
  fundingHours: 8,
};

export const VENUE: Record<string, VenueSpec> = {
  bybit: { size: "btc", kind: "linear", ctVal: 1, ctMult: 1, fundingHours: 8 },
  binance: { size: "btc", kind: "linear", ctVal: 1, ctMult: 1, fundingHours: 8 },
  okx: { size: "contract", kind: "linear", ctVal: 0.01, ctMult: 1, fundingHours: 8 },
  hyperliquid: { size: "btc", kind: "linear", ctVal: 1, ctMult: 1, fundingHours: 1 },
  bitfinex: { size: "btc", kind: "linear", ctVal: 1, ctMult: 1, fundingHours: 8 },
  coinbase: { size: "btc", kind: "spot", ctVal: 1, ctMult: 1, fundingHours: 8 },
  kraken: { size: "btc", kind: "spot", ctVal: 1, ctMult: 1, fundingHours: 8 },
};

export function specOf(venue: string): VenueSpec {
  return VENUE[venue] ?? FALLBACK;
}

export function specTag(venue: string): string {
  const s = specOf(venue);
  return `${s.kind} ${s.ctVal}×${s.ctMult}`;
}

/** Apply a live instrument print (OKX ctVal/ctMult) so we do not guess. */
export function applyInstrument(
  venue: string,
  row: { ctVal?: string | number; ctMult?: string | number; ctValCcy?: string; settleCcy?: string },
): VenueSpec {
  const ctVal = Number(row.ctVal);
  const ctMult = Number(row.ctMult);
  const settle = String(row.settleCcy ?? "").toUpperCase();
  const valCcy = String(row.ctValCcy ?? "").toUpperCase();
  const prev = specOf(venue);
  const kind: ContractKind =
    settle === "USD" || valCcy === "USD" ? "inverse" : settle === "USDT" || settle === "USDC" ? "linear" : prev.kind;
  const size: SizeUnit = kind === "inverse" ? "contract" : ctVal > 0 && ctVal < 1 && valCcy === "BTC" ? "contract" : "btc";
  const next: VenueSpec = {
    ...prev,
    kind,
    size,
    ctVal: Number.isFinite(ctVal) && ctVal > 0 ? ctVal : prev.ctVal,
    ctMult: Number.isFinite(ctMult) && ctMult > 0 ? ctMult : prev.ctMult,
  };
  VENUE[venue] = next;
  return next;
}

const MAX_PRINT_USD = 250_000_000;

export function notionalUsd(sz: number, px: number, venue: string): number {
  if (!(sz > 0)) return 0;
  const s = specOf(venue);
  const m = s.ctVal * s.ctMult;
  let usd = 0;
  if (s.kind === "inverse") usd = sz * m;
  else usd = px > 0 ? sz * m * px : 0;
  if (!Number.isFinite(usd) || usd <= 0 || usd > MAX_PRINT_USD) return 0;
  return usd;
}

/** Bar volume → USD notional. Prefer the venue’s quote volume when present. */
export function volumeUsd(opts: { base?: number; quote?: number; px: number; venue: string }): number {
  const quote = opts.quote ?? 0;
  if (Number.isFinite(quote) && quote > 0) return quote;
  return notionalUsd(opts.base ?? 0, opts.px, opts.venue);
}

export function funding8h(rate: number, venue: string): number {
  if (!Number.isFinite(rate)) return NaN;
  const h = specOf(venue).fundingHours;
  return rate * (8 / h);
}

/** Annualize an 8-hour rate (3 settlements/day × 365). */
export function fundingApr(rate8h: number): number {
  if (!Number.isFinite(rate8h)) return NaN;
  return rate8h * 3 * 365;
}

export type VenueUsdPack = {
  longUsd: number;
  shortUsd: number;
  n: number;
  source: string;
  last_t: number;
};

/** Perp minus spot in basis points. Positive = perp premium. */
export function basisBps(perp: number, spot: number): number {
  if (!(spot > 0 && perp > 0)) return 0;
  return ((perp - spot) / spot) * 10_000;
}
export function pickPrimaryVenue(packs: VenueUsdPack[]): VenueUsdPack | null {
  const live = packs.filter((p) => p.n > 0 && p.longUsd + p.shortUsd > 0);
  if (!live.length) return null;
  live.sort((a, b) => b.longUsd + b.shortUsd - (a.longUsd + a.shortUsd));
  const primary = live[0]!;
  const backup = live[1];
  return backup ? { ...primary, source: `${primary.source}+${backup.source}` } : primary;
}
