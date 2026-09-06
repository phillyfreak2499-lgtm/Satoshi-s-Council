/**
 * Event-level recorder for the lab: every websocket message lands as one
 * NDJSON line ({t: receipt ms, type, msg}) in a daily file on the persistent
 * disk, gzipped the day after, pruned after 60 days. This is the replay
 * track — a strategy tested against these files sees exactly what the live
 * desk saw. Also keeps the first three raw samples of every message type so
 * unknown schemas can be read off the /lab endpoint and the logs.
 */
import { existsSync, createReadStream, createWriteStream } from "node:fs";
import { appendFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";

const KEEP_DAYS = 60;

export function labDataDir(): string {
  const env = process.env.DESK_DATA_DIR?.trim();
  if (env) return join(env, "lab");
  const render = "/opt/render/project/src/data";
  if (existsSync(render)) return join(render, "lab");
  return join(process.cwd(), "data", "lab");
}

type TypeStat = { n: number; last_t: number; first: unknown[]; last: unknown };

export class Recorder {
  readonly dir: string;
  private queue: string[] = [];
  private day = "";
  private flushing: Promise<void> = Promise.resolve();
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly stats = new Map<string, TypeStat>();
  bytes = 0;
  lines = 0;
  writeErrors = 0;
  lastError: string | null = null;
  ready: Promise<void>;

  constructor(dir = labDataDir()) {
    this.dir = dir;
    this.ready = mkdir(dir, { recursive: true })
      .then(() => this.rotateStale())
      .catch((err) => {
        this.lastError = `mkdir: ${err instanceof Error ? err.message : String(err)}`;
      });
    this.timer = setInterval(() => void this.flush(), 1_000);
    this.timer.unref?.();
  }

  write(type: string, msg: unknown, t: number, extra?: Record<string, unknown>): void {
    let st = this.stats.get(type);
    if (!st) {
      st = { n: 0, last_t: 0, first: [], last: null };
      this.stats.set(type, st);
    }
    st.n += 1;
    st.last_t = t;
    st.last = msg;
    if (st.first.length < 3) {
      st.first.push(msg);
      console.log(`[lab] ${type} sample ${st.first.length}: ${JSON.stringify(msg).slice(0, 700)}`);
    }
    const line = JSON.stringify({ t, type, ...(extra ?? {}), msg });
    this.queue.push(line);
    this.bytes += line.length + 1;
    this.lines += 1;
    if (this.queue.length >= 2_000) void this.flush();
  }

  flush(): Promise<void> {
    if (!this.queue.length) return this.flushing;
    const lines = this.queue;
    this.queue = [];
    const day = new Date().toISOString().slice(0, 10);
    const prevDay = this.day;
    this.day = day;
    this.flushing = this.flushing.then(async () => {
      try {
        await this.ready;
        await appendFile(join(this.dir, `events-${day}.ndjson`), `${lines.join("\n")}\n`);
        if (prevDay && prevDay !== day) void this.rotate(prevDay);
      } catch (err) {
        this.writeErrors += 1;
        this.lastError = `write: ${err instanceof Error ? err.message : String(err)}`;
      }
    });
    return this.flushing;
  }

  private async rotate(day: string): Promise<void> {
    const src = join(this.dir, `events-${day}.ndjson`);
    try {
      await stat(src);
      await pipeline(createReadStream(src), createGzip({ level: 6 }), createWriteStream(`${src}.gz`));
      await unlink(src);
    } catch (err) {
      this.lastError = `rotate: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /** Gzip yesterday's leftovers after a restart; prune archives past KEEP_DAYS. */
  private async rotateStale(): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    let names: string[] = [];
    try {
      names = await readdir(this.dir);
    } catch {
      return;
    }
    for (const name of names) {
      const m = /^events-(\d{4}-\d{2}-\d{2})\.ndjson(\.gz)?$/.exec(name);
      if (!m) continue;
      const day = m[1]!;
      if (!m[2] && day < today) await this.rotate(day);
      if (m[2]) {
        const age = (Date.parse(today) - Date.parse(day)) / 86_400_000;
        if (age > KEEP_DAYS) await unlink(join(this.dir, name)).catch(() => {});
      }
    }
  }

  summary(): Record<string, unknown> {
    const types: Record<string, { n: number; last_age_s: number }> = {};
    const now = Date.now();
    for (const [k, v] of this.stats) types[k] = { n: v.n, last_age_s: Math.round((now - v.last_t) / 100) / 10 };
    return {
      dir: this.dir,
      day: this.day,
      lines: this.lines,
      bytes: this.bytes,
      queued: this.queue.length,
      write_errors: this.writeErrors,
      last_error: this.lastError,
      types,
    };
  }

  samples(): Record<string, { first: unknown[]; last: unknown }> {
    const out: Record<string, { first: unknown[]; last: unknown }> = {};
    for (const [k, v] of this.stats) out[k] = { first: v.first, last: v.last };
    return out;
  }
}
