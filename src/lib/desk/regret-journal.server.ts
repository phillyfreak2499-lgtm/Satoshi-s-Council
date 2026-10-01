import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { mkdir, open, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
/** Durable write-ahead journal on the existing Render data disk. Database keys
 * make replay idempotent if a crash occurs before the cursor rename. */
export class RegretJournal<T> {
  private rows: T[] = [];
  private cursor = 0;
  private loaded: Promise<void> | null = null;
  constructor(private root: string) {}
  private load() {
    return (this.loaded ??= (async () => {
      await mkdir(this.root, { recursive: true });
      try {
        this.cursor = Number(await readFile(join(this.root, "regret.cursor"), "utf8"));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      if (!Number.isInteger(this.cursor) || this.cursor < 0)
        throw Error("invalid regret journal cursor");
      let lines = 0;
      try {
        const file = await open(join(this.root, "regret.jsonl"), "r");
        await file.close();
        for await (const line of createInterface({
          input: createReadStream(join(this.root, "regret.jsonl")),
          crlfDelay: Infinity,
        })) {
          if (lines++ >= this.cursor) this.rows.push(JSON.parse(line) as T);
        }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      if (this.cursor > lines) throw Error("regret journal cursor exceeds durable records");
    })());
  }
  async append(row: T) {
    await this.load();
    const f = await open(join(this.root, "regret.jsonl"), "a");
    try {
      await f.writeFile(JSON.stringify(row) + "\n");
      await f.sync();
    } finally {
      await f.close();
    }
    this.rows.push(row);
  }
  async drain(write: (row: T) => Promise<void>) {
    await this.load();
    while (this.rows.length) {
      await write(this.rows[0]!);
      const next = this.cursor + 1;
      const file = join(this.root, "regret.cursor");
      await writeFile(file + ".tmp", String(next));
      await rename(file + ".tmp", file);
      this.cursor = next;
      this.rows.shift();
    }
  }
  get pending() {
    return this.rows.length;
  }
}
