/** Kalshi books are bid-only. Arrays are cheapest→best. Asks are the complement. */

export type KalshiQuote = {
  yes_bid: number;
  yes_ask: number;
  no_bid: number;
  no_ask: number;
  yes_bid_size: number;
  no_bid_size: number;
  /**
   * MEASUREMENT ONLY. Exact venue price lane kept beside the legacy whole-cent
   * fields above. No Chair/seat/gate consumer reads these fields.
   */
  yes_bid_exact?: number;
  yes_ask_exact?: number;
  no_bid_exact?: number;
  no_ask_exact?: number;
  yes_bid_size_exact?: number;
  no_bid_size_exact?: number;
};

function cents(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n <= 1.5) return Math.round(n * 100);
  return Math.round(n);
}

/** Venue price in cents without the legacy whole-cent coercion. */
export function exactKalshiCents(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const c = n <= 1.5 ? n * 100 : n;
  if (!(c > 0 && c < 100)) return 0;
  return Math.round(c * 1000) / 1000;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

type Level = { px: number; px_exact: number; sz: number };

function parseLevels(rows: unknown): Level[] {
  if (!Array.isArray(rows)) return [];
  const out: Level[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const px = cents(row[0]);
    const px_exact = exactKalshiCents(row[0]);
    const sz = num(row[1]);
    if (px >= 1 && px <= 99 && px_exact > 0 && sz > 0) out.push({ px, px_exact, sz });
  }
  return out;
}

/** Legacy chooser: deliberately compares rounded cents to preserve Chair behavior. */
function bestBid(levels: Level[]): Level | null {
  if (!levels.length) return null;
  let best = levels[0]!;
  for (const l of levels) if (l.px > best.px) best = l;
  return best;
}

/** Measurement chooser: actual venue top of book, including deci-cent differences. */
function bestBidExact(levels: Level[]): Level | null {
  if (!levels.length) return null;
  let best = levels[0]!;
  for (const l of levels) if (l.px_exact > best.px_exact) best = l;
  return best;
}

function clampC(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(1, Math.min(99, Math.round(n)));
}

function clampExactC(n: number): number {
  if (!Number.isFinite(n) || !(n > 0 && n < 100)) return 0;
  return Math.round(n * 1000) / 1000;
}

/** Venue sequence if present. 0 = not available. Never synthesize from a clock. */
export function readSeq(raw: unknown): number {
  if (!raw || typeof raw !== "object") return 0;
  const nodes: unknown[] = [raw];
  const rec = raw as Record<string, unknown>;
  if (rec.msg) nodes.push(rec.msg);
  if (rec.orderbook) nodes.push(rec.orderbook);
  if (rec.orderbook_fp) nodes.push(rec.orderbook_fp);
  if (rec.data) nodes.push(rec.data);
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const n = Number(
      (node as Record<string, unknown>).seq ??
        (node as Record<string, unknown>).sequence ??
        (node as Record<string, unknown>).lastUpdateId ??
        (node as Record<string, unknown>).u,
    );
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 0;
}

/**
 * Interpret a Kalshi GET /markets/{ticker}/orderbook payload.
 *
 * The API returns bids only (`yes_dollars` / `no_dollars`, or legacy `yes` / `no`).
 * A YES bid at X is a NO ask at 100−X, and a NO bid at Y is a YES ask at 100−Y.
 * Levels are sorted ascending; the best bid is the max price, not [0].
 */
export function interpretKalshiBook(
  raw: unknown,
  ticker: Pick<KalshiQuote, "yes_bid" | "yes_ask" | "no_bid" | "no_ask"> &
    Partial<Pick<KalshiQuote, "yes_bid_exact" | "yes_ask_exact" | "no_bid_exact" | "no_ask_exact">>,
): KalshiQuote {
  const root = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const book =
    (root?.orderbook_fp as Record<string, unknown> | undefined) ??
    (root?.orderbook as Record<string, unknown> | undefined) ??
    root;
  const yes = parseLevels(book?.yes_dollars ?? book?.yes);
  const no = parseLevels(book?.no_dollars ?? book?.no);
  const y = bestBid(yes);
  const n = bestBid(no);
  const yExact = bestBidExact(yes);
  const nExact = bestBidExact(no);

  // Production lane: unchanged whole-cent semantics.
  const yes_bid = y ? y.px : clampC(ticker.yes_bid);
  const no_bid = n ? n.px : clampC(ticker.no_bid);
  const yes_ask = n ? clampC(100 - n.px) : clampC(ticker.yes_ask);
  const no_ask = y ? clampC(100 - y.px) : clampC(ticker.no_ask);

  // Measurement lane: actual venue price/depth where available.
  const yes_bid_exact = yExact ? yExact.px_exact : clampExactC(ticker.yes_bid_exact ?? ticker.yes_bid);
  const no_bid_exact = nExact ? nExact.px_exact : clampExactC(ticker.no_bid_exact ?? ticker.no_bid);
  const yes_ask_exact = nExact ? clampExactC(100 - nExact.px_exact) : clampExactC(ticker.yes_ask_exact ?? ticker.yes_ask);
  const no_ask_exact = yExact ? clampExactC(100 - yExact.px_exact) : clampExactC(ticker.no_ask_exact ?? ticker.no_ask);

  return {
    yes_bid,
    yes_ask,
    no_bid,
    no_ask,
    yes_bid_size: y?.sz ?? 0,
    no_bid_size: n?.sz ?? 0,
    yes_bid_exact,
    yes_ask_exact,
    no_bid_exact,
    no_ask_exact,
    yes_bid_size_exact: yExact?.sz ?? 0,
    no_bid_size_exact: nExact?.sz ?? 0,
  };
}
