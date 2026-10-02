/** Measurement-only durable replay rows. No decision reads this journal. */
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { ReplayCols } from "./replay";

type Row = {
  ticker: string;
  close: number;
  at: number;
  strike: number;
  values: Record<string, unknown>;
  seats: Record<string, number>;
};
const validKey = (ticker: string, close: number) =>
  /^[A-Z0-9-]{6,40}$/.test(ticker) && Number.isSafeInteger(close) && close > 0;

export function replayRow(ticker: string, close: number, strike: number, c: ReplayCols, i = c.t.length - 1): Row {
  return {
    ticker,
    close,
    strike,
    at: c.t0 + c.t[i] * 1000,
    values: Object.fromEntries(
      Object.entries(c)
        .filter(([, v]) => Array.isArray(v))
        .filter(([k]) => k !== "t")
        .map(([k, v]) => [k, (v as unknown[])[i]]),
    ),
    seats: Object.fromEntries(Object.entries(c.seats).map(([k, v]) => [k, v[i] ?? 0])),
  };
}

/** Exact identity, ordered absolute times, first observation wins, arrays stay aligned. */
export function restoreReplayRows<C extends ReplayCols>(
  ticker: string,
  close: number,
  rows: readonly Row[],
  fallback: C,
): C {
  const byTime = new Map<number, Row>();
  for (const r of rows) {
    if (
      !r ||
      r.ticker !== ticker ||
      r.close !== close ||
      !Number.isFinite(r.at) ||
      r.at < close - 900_000 ||
      r.at > close + 60_000 ||
      !r.values ||
      !r.seats ||
      !(Number(r.values.spot) > 0)
    )
      continue;
    if (!byTime.has(r.at)) byTime.set(r.at, r);
  }
  for (let i = 0; i < fallback.t.length; i++) {
    const one = replayRow(ticker, close, 0, fallback, i);
    if (!byTime.has(one.at)) byTime.set(one.at, one);
  }
  const ordered = [...byTime.values()].sort((a, b) => a.at - b.at);
  if (!ordered.length) return fallback;
  const keys = new Set(ordered.flatMap((r) => Object.keys(r.values)));
  const seats = new Set(ordered.flatMap((r) => Object.keys(r.seats)));
  return {
    t0: ordered[0].at,
    t: ordered.map((r) => (r.at - ordered[0].at) / 1000),
    ...Object.fromEntries([...keys].map((k) => [k, ordered.map((r) => r.values[k] ?? null)])),
    seats: Object.fromEntries([...seats].map((k) => [k, ordered.map((r) => r.seats[k] ?? 0)])),
  } as C;
}

export class ReplayJournal {
  private pending = new Map<string, string[]>();
  private writing: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | null = null;
  lastError: string | null = null;
  private dir: string;
  constructor(dir: string) {
    this.dir = dir;
  }
  note(row: Row): void {
    if (!validKey(row.ticker, row.close)) return;
    const key = `${row.ticker}_${row.close}.ndjson`;
    const lines = this.pending.get(key) ?? [];
    // Bound disk-outage memory; replay failures must never delay a decision.
    if (lines.length >= 400) return;
    lines.push(JSON.stringify(row));
    this.pending.set(key, lines);
    if (!this.timer) {
      this.timer = setInterval(() => void this.flush(), 1000);
      this.timer.unref?.();
    }
  }
  flush(): Promise<void> {
    const batch = this.pending;
    this.pending = new Map();
    this.writing = this.writing.then(async () => {
      if (!batch.size) return;
      try {
        await mkdir(this.dir, { recursive: true });
        for (const [key, lines] of batch)
          await appendFile(join(this.dir, key), lines.join("\n") + "\n");
      } catch (e) {
        this.lastError = String(e);
      }
    });
    return this.writing;
  }
  async restore<C extends ReplayCols>(ticker: string, close: number, fallback: C): Promise<C> {
    if (!validKey(ticker, close)) return fallback;
    await this.flush();
    try {
      const raw = await readFile(join(this.dir, `${ticker}_${close}.ndjson`), "utf8");
      const rows: Row[] = [];
      for (const line of raw.split("\n")) {
        try {
          if (line) rows.push(JSON.parse(line) as Row);
        } catch {
          /* interrupted final append */
        }
      }
      return restoreReplayRows(ticker, close, rows, fallback);
    } catch {
      return fallback;
    }
  }
  async prune(now: number): Promise<void> {
    try {
      for (const name of await readdir(this.dir)) {
        const match = /^[A-Z0-9-]{6,40}_(\d+)\.ndjson$/.exec(name);
        if (match && now - Number(match[1]) > 30 * 86_400_000) await unlink(join(this.dir, name));
      }
    } catch {
      /* measurement only */
    }
  }
}

const disk = "/opt/render/project/src/data";
export const replayJournal = new ReplayJournal(
  join(
    process.env.DESK_DATA_DIR?.trim() || (existsSync(disk) ? disk : join(process.cwd(), "data")),
    "replay",
  ),
);
