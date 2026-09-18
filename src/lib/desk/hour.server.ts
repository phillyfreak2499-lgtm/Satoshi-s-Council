/**
 * The hour on the record (server only). Read-only.
 *
 * Lists the open KXBTCD contracts from Kalshi's public market-data hosts, the
 * same unsigned endpoints the 15-minute desk polls, and reads the hourly
 * book from its own table. It never touches desk_ledger, the Chair, the
 * learner, or the 15-minute paper book, and it writes nothing anywhere.
 * Authority: none.
 */
import { buildHourBrief, HOUR_DAYS, HOUR_SERIES, pickHourWindow, type HourBrief, type HourLedgerRow, type HourMarketRow } from "./hour";

const KALSHI_HOSTS = [
  "https://external-api.kalshi.com/trade-api/v2",
  "https://api.elections.kalshi.com/trade-api/v2",
  "https://api.kalshi.com/trade-api/v2",
];
const UA = "SatoshiCouncil/1.0 (paper research)";
const FRAME_WAIT_MS = 2_500;
const CACHE_MS = 30_000;

async function sql() {
  const { getSql } = await import("@/lib/db");
  return getSql();
}

/** Every open contract on the hourly series, from the first host that answers. */
async function openHourMarkets(): Promise<HourMarketRow[] | null> {
  for (const host of KALSHI_HOSTS) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4_000);
    try {
      const res = await fetch(`${host}/markets?status=open&series_ticker=${HOUR_SERIES}&limit=200`, {
        signal: ctrl.signal,
        headers: { accept: "application/json", "user-agent": UA },
      });
      if (!res.ok) continue;
      const json = (await res.json()) as { markets?: HourMarketRow[] };
      if (Array.isArray(json?.markets)) return json.markets;
    } catch {
      /* try the next host */
    } finally {
      clearTimeout(t);
    }
  }
  return null;
}

/** Bitcoin spot as the shared frame last saw it, to choose the rung nearest the price. Read-only. */
async function spotFromFrame(): Promise<number | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Dynamic on purpose: the brain never imports the hourly book, and the hourly
    // book only reads the frame's spot. Nothing flows back.
    const { getServerFrame } = await import("./server-engine");
    const frame = await Promise.race([
      getServerFrame(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), FRAME_WAIT_MS);
      }),
    ]);
    const spot = frame?.snap?.spot;
    return typeof spot === "number" && Number.isFinite(spot) && spot > 0 ? spot : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type Row = Omit<HourLedgerRow, "close_time"> & { close_time: Date | string };
const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());
const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The hourly ledger's last 7 days, or null when the table cannot be read (never an empty record dressed as evidence). */
async function hourRows(): Promise<HourLedgerRow[] | null> {
  try {
    const db = await sql();
    const raw = await db<Row>`
      select ticker, close_time, question, chair_lean, entry_side, entry_cents, entry_fee_cents, ev_cents, result
      from desk_hour_ledger
      where close_time > now() - (${HOUR_DAYS}::int * interval '1 day')
      order by close_time desc
    `;
    return raw.map((r) => ({
      ticker: r.ticker,
      close_time: iso(r.close_time),
      question: r.question ?? "",
      chair_lean: r.chair_lean === "YES" || r.chair_lean === "NO" ? r.chair_lean : "WAIT",
      entry_side: r.entry_side === "YES" || r.entry_side === "NO" ? r.entry_side : null,
      entry_cents: num(r.entry_cents),
      entry_fee_cents: num(r.entry_fee_cents),
      ev_cents: num(r.ev_cents),
      result: r.result === "YES" || r.result === "NO" ? r.result : null,
    }));
  } catch {
    return null;
  }
}

let cache: { at: number; body: HourBrief } | null = null;
let inflight: Promise<HourBrief> | null = null;

async function build(): Promise<HourBrief> {
  const now = Date.now();
  const [markets, spot, rows] = await Promise.all([openHourMarkets(), spotFromFrame(), hourRows()]);
  return buildHourBrief({ now, live: pickHourWindow(markets ?? undefined, now, spot), rows });
}

export async function hourBrief(): Promise<HourBrief> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.body;
  inflight ??= build()
    .then((body) => {
      cache = { at: Date.now(), body };
      return body;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
