import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
/** Durable write-ahead journal on the existing Render data disk. Database keys
 * make replay idempotent if a crash occurs before the cursor rename. */
export class RegretJournal<T> {
  private rows: T[] = [];
  private cursor = 0;
  private loaded: Promise<void> | null = null;
  private file = "regret.jsonl";
  private io: Promise<unknown> = Promise.resolve();
  private drains: Promise<unknown> = Promise.resolve();
  constructor(private root: string, private compactAfter = 1000) {}
  private exclusive<R>(fn: () => Promise<R>): Promise<R> {
    const next = this.io.then(fn);
    this.io = next.catch(() => {});
    return next;
  }
  private async checkpoint(file: string, cursor: number) {
    const path = join(this.root, "regret.state.json");
    const temp = await open(path + ".tmp", "w");
    try {
      await temp.writeFile(JSON.stringify({ file, cursor }));
      await temp.sync();
    } finally { await temp.close(); }
    await rename(path + ".tmp", path);
  }
  private async compact() {
    if (this.rows.length || this.cursor < this.compactAfter) return;
    const old = this.file;
    const next = `regret-${randomUUID()}.jsonl`;
    const empty = await open(join(this.root, next), "wx");
    try { await empty.sync(); } finally { await empty.close(); }
    // The manifest switches file and cursor together. A crash before this
    // rename uses the old journal; a crash after it uses the new empty one.
    await this.checkpoint(next, 0);
    this.file = next;
    this.cursor = 0;
    await unlink(join(this.root, old));
  }
  private load() {
    return (this.loaded ??= (async () => {
      await mkdir(this.root, { recursive: true });
      let checkpointed = false;
      try {
        const state = JSON.parse(await readFile(join(this.root, "regret.state.json"), "utf8"));
        if (!/^regret(?:-[a-f0-9-]+)?\.jsonl$/.test(state.file)) throw Error("invalid regret journal file");
        this.file = state.file;
        this.cursor = state.cursor;
        checkpointed = true;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        try {
          this.cursor = Number(await readFile(join(this.root, "regret.cursor"), "utf8"));
        } catch (legacy) {
          if ((legacy as NodeJS.ErrnoException).code !== "ENOENT") throw legacy;
        }
      }
      if (!Number.isInteger(this.cursor) || this.cursor < 0)
        throw Error("invalid regret journal cursor");
      let lines = 0;
      try {
        const file = await open(join(this.root, this.file), "r");
        await file.close();
        for await (const line of createInterface({
          input: createReadStream(join(this.root, this.file)),
          crlfDelay: Infinity,
        })) {
          if (lines++ >= this.cursor) this.rows.push(JSON.parse(line) as T);
        }
      } catch (e) {
        if (checkpointed || (e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      if (this.cursor > lines) throw Error("regret journal cursor exceeds durable records");
    })());
  }
  async append(row: T) {
    await this.load();
    await this.exclusive(async () => {
      const f = await open(join(this.root, this.file), "a");
      try {
        await f.writeFile(JSON.stringify(row) + "\n");
        await f.sync();
      } finally { await f.close(); }
      this.rows.push(row);
    });
  }
  async drain(write: (row: T) => Promise<void>) {
    await this.load();
    const pass = this.drains.then(async () => {
      while (this.rows.length) {
        // SQL/push remain outside the I/O lock so appends keep progressing.
        await write(this.rows[0]!);
        await this.exclusive(async () => {
          const next = this.cursor + 1;
          await this.checkpoint(this.file, next);
          this.cursor = next;
          this.rows.shift();
          await this.compact();
        });
      }
    });
    this.drains = pass.catch(() => {});
    await pass;
  }
  get pending() {
    return this.rows.length;
  }
}
