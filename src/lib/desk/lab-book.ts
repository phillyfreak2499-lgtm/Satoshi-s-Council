/**
 * A local Kalshi order book rebuilt from the websocket snapshot + deltas.
 * Kalshi books are resting BIDS on each side in cents: a YES bid at p and a
 * NO bid at q. The YES ask is 100 − best NO bid; the NO ask is 100 − best
 * YES bid. Prices may arrive as cents (45) or dollars ("0.45"); sizes as
 * numbers or fixed-point strings. Pure module.
 */
export type LabBook = {
  ticker: string;
  yes: Map<number, number>;
  no: Map<number, number>;
  snap_t: number;
  upd_t: number;
  ok: boolean;
};

export type Bests = {
  yes_bid: number;
  yes_bid_sz: number;
  no_bid: number;
  no_bid_sz: number;
  yes_ask: number;
  yes_ask_sz: number;
  no_ask: number;
  no_ask_sz: number;
};

export function priceCents(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n) || n <= 0) return 0;
  const c = n <= 1.5 ? Math.round(n * 100) : Math.round(n);
  return c >= 1 && c <= 99 ? c : 0;
}

export function qtyOf(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function freshBook(ticker: string): LabBook {
  return { ticker, yes: new Map(), no: new Map(), snap_t: 0, upd_t: 0, ok: false };
}

function loadSide(map: Map<number, number>, rows: unknown): void {
  map.clear();
  if (!Array.isArray(rows)) return;
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const px = priceCents(row[0]);
    const sz = qtyOf(row[1]);
    if (px && sz) map.set(px, sz);
  }
}

export function applySnapshot(b: LabBook, msg: Record<string, unknown>, t: number): void {
  loadSide(b.yes, msg.yes ?? msg.yes_dollars);
  loadSide(b.no, msg.no ?? msg.no_dollars);
  b.snap_t = t;
  b.upd_t = t;
  b.ok = true;
}

export type DeltaOut = { side: "yes" | "no"; price: number; size: number; delta: number };

export function applyDelta(b: LabBook, msg: Record<string, unknown>, t: number): DeltaOut | null {
  const side = String(msg.side ?? "").toLowerCase();
  const price = priceCents(msg.price ?? msg.price_dollars);
  const delta = Number(msg.delta ?? msg.delta_fp);
  if ((side !== "yes" && side !== "no") || !price || !Number.isFinite(delta)) return null;
  const map = side === "yes" ? b.yes : b.no;
  const size = Math.max(0, (map.get(price) ?? 0) + delta);
  if (size > 0) map.set(price, size);
  else map.delete(price);
  b.upd_t = t;
  return { side, price, size, delta };
}

function top(map: Map<number, number>): [number, number] {
  let px = 0;
  let sz = 0;
  for (const [p, s] of map) {
    if (s > 0 && p > px) {
      px = p;
      sz = s;
    }
  }
  return [px, sz];
}

export function bests(b: LabBook): Bests {
  const [yb, ybs] = top(b.yes);
  const [nb, nbs] = top(b.no);
  return {
    yes_bid: yb,
    yes_bid_sz: ybs,
    no_bid: nb,
    no_bid_sz: nbs,
    yes_ask: nb ? 100 - nb : 0,
    yes_ask_sz: nbs,
    no_ask: yb ? 100 - yb : 0,
    no_ask_sz: ybs,
  };
}

export function sameBests(a: Bests, b: Bests): boolean {
  return (
    a.yes_bid === b.yes_bid &&
    a.no_bid === b.no_bid &&
    a.yes_bid_sz === b.yes_bid_sz &&
    a.no_bid_sz === b.no_bid_sz
  );
}

export function sizeAt(b: LabBook, side: "yes" | "no", price: number): number {
  return (side === "yes" ? b.yes : b.no).get(price) ?? 0;
}

export function levelCount(b: LabBook): number {
  return b.yes.size + b.no.size;
}
