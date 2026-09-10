/**
 * Reading the paper book at size. The desk books one contract; a size view
 * shows what the same fill would have made at n contracts. Two honesty rules:
 *
 * - The fee is Kalshi's schedule at size — 0.07 · n · P · (1 − P), rounded up
 *   once per order — so 100 contracts at 70¢ pay 147¢, not a hundred times
 *   the 2¢ a single contract pays. Worked in integer tenths of a cent so an
 *   exact 147.00 never rounds up to 148 through floating point.
 * - The fill is assumed at the same ask. Real size walks the book, so the
 *   true result at size would be a little worse than shown.
 *
 * Display only; nothing here is booked.
 */
export const GAVEL_SIZES = [1, 10, 25, 50, 100, 250, 500, 1000] as const;
export type GavelSize = (typeof GAVEL_SIZES)[number];

export function isGavelSize(n: number): n is GavelSize {
  return (GAVEL_SIZES as readonly number[]).includes(n);
}

/** Kalshi taker fee in cents for `contracts` contracts at one price, rounded up once per order. */
export function takerFeeCentsAt(priceCents: number, contracts: number): number {
  const n = Math.max(1, Math.floor(contracts));
  const p10 = Math.round(Math.min(99, Math.max(1, priceCents)) * 10); // tenths of a cent, exact
  return Math.ceil((7 * n * p10 * (1000 - p10)) / 1_000_000);
}

/** What one fill would have made at size: contracts × (settle − entry) − the fee at size. */
export function evCentsAt(entryCents: number, settleCents: number, contracts: number): number {
  const n = Math.max(1, Math.floor(contracts));
  return Math.round((n * (settleCents - entryCents) - takerFeeCentsAt(entryCents, n)) * 10) / 10;
}

/** Cents at one contract (the ledger's own unit); dollars at any size above it. */
export function fmtCentsAt(cents: number, contracts: number): string {
  if (contracts <= 1) return `${cents > 0 ? "+" : ""}${cents.toFixed(1)}¢`;
  const dollars = Math.abs(cents) / 100;
  const body = dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${cents > 0 ? "+" : cents < 0 ? "-" : ""}$${body}`;
}
