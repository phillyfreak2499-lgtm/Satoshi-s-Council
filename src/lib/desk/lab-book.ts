/**
 * A local Kalshi order book rebuilt from the websocket snapshot + deltas.
 * Kalshi books are resting BIDS on each side: a YES bid at p and a NO bid
 * at q, in cents at 0.1¢ resolution (the 15-minute crypto books tick in
 * tenths). The YES ask is 100 − best NO bid; the NO ask is 100 − best YES bid. Wire formats: `yes_dollars_fp` / `no_dollars_fp` rows of
 * [price_dollars, count_fp] strings (older `yes` / `no` cents rows are still
 * accepted); deltas carry `price_dollars`, `delta_fp`, `side`.
 *
 * With `use_yes_price: true` on the subscription, NO-side levels arrive in
 * YES-leg pricing (a NO bid at 30¢ is reported as 0.70). The book converts
 * them back to NO-leg internally so every consumer sees one convention, and
 * a crossed-book sanity check flips the interpretation if the flag was not
 * honoured. Pure module.
 */
export type LabBook = {
  ticker: string;
  yes: Map<number, number>;
  no: Map<number, number>;
  /** NO-side wire prices are YES-leg (use_yes_price) — converted on entry. */
  yesLeg: boolean;
  snap_t: number;
  upd_t: number;
  ok: boolean;
  flips: number;
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

/** Normalize a cents value to Kalshi's 0.1¢ tick so equal prices compare
 *  equal after arithmetic (100 − 92.8 must be the same 7.2 the wire sent). */
export function tenths(cents: number): number {
  return Math.round(cents * 10) / 10;
}

/** Price in cents at 0.1¢ resolution from dollars ("0.0760" → 7.6) or cents (45 → 45). */
export function priceCents(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n) || n <= 0) return 0;
  const c = tenths(n <= 1.5 ? n * 100 : n);
  return c > 0 && c < 100 ? c : 0;
}

export function qtyOf(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function freshBook(ticker: string, yesLeg = true): LabBook {
  return { ticker, yes: new Map(), no: new Map(), yesLeg, snap_t: 0, upd_t: 0, ok: false, flips: 0 };
}

function loadSide(map: Map<number, number>, rows: unknown, convert: boolean): void {
  map.clear();
  if (!Array.isArray(rows)) return;
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2) continue;
    let px = priceCents(row[0]);
    const sz = qtyOf(row[1]);
    if (!px || !sz) continue;
    if (convert) px = tenths(100 - px);
    map.set(px, sz);
  }
}

function crossed(b: LabBook): boolean {
  const [yb] = top(b.yes);
  const [nb] = top(b.no);
  return yb > 0 && nb > 0 && yb + nb > 100;
}

export function applySnapshot(b: LabBook, msg: Record<string, unknown>, t: number): void {
  const yesRows = msg.yes_dollars_fp ?? msg.yes_dollars ?? msg.yes;
  const noRows = msg.no_dollars_fp ?? msg.no_dollars ?? msg.no;
  loadSide(b.yes, yesRows, false);
  loadSide(b.no, noRows, b.yesLeg);
  if (crossed(b)) {
    // The other interpretation must be the right one if it uncrosses the book.
    const alt = new Map<number, number>();
    loadSide(alt, noRows, !b.yesLeg);
    const [yb] = top(b.yes);
    const [nbAlt] = top(alt);
    if (!(yb > 0 && nbAlt > 0 && yb + nbAlt > 100)) {
      b.no = alt;
      b.yesLeg = !b.yesLeg;
      b.flips += 1;
    }
  }
  b.snap_t = t;
  b.upd_t = t;
  b.ok = true;
}

export type DeltaOut = { side: "yes" | "no"; price: number; size: number; delta: number };

export function applyDelta(b: LabBook, msg: Record<string, unknown>, t: number): DeltaOut | null {
  const side = String(msg.side ?? "").toLowerCase();
  let price = priceCents(msg.price_dollars ?? msg.price);
  const delta = Number(msg.delta_fp ?? msg.delta);
  if ((side !== "yes" && side !== "no") || !price || !Number.isFinite(delta)) return null;
  if (side === "no" && b.yesLeg) price = tenths(100 - price);
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
    yes_ask: nb ? tenths(100 - nb) : 0,
    yes_ask_sz: nbs,
    no_ask: yb ? tenths(100 - yb) : 0,
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
