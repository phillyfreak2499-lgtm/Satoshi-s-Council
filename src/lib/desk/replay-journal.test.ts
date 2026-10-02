import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, appendFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ReplayJournal, replayRow } from "./replay-journal.server.ts";
import type { ReplayCols } from "./replay.ts";

const ticker = "KXBTC15M-TEST";
const close = 2_000_000;
function cols(t0: number, spot: number): ReplayCols {
  return {
    t0,
    t: [0],
    spot: [spot],
    yes_bid: [82],
    yes_ask: [83],
    fair: [89],
    lean: [1],
    conf: [92],
    ups: [2],
    downs: [0],
    booked: [1],
    seats: { INDEX: [2], CHAIN: [2] },
    imb: [-0.3],
  };
}
test("new process restores exact-window prefix, keeps gaps and aligns every lane", async () => {
  const dir = await mkdtemp(join(tmpdir(), "replay-journal-"));
  try {
    const before = new ReplayJournal(dir);
    before.note(replayRow(ticker, close, 100, cols(close - 900_000, 110)));
    before.note(replayRow(ticker, close, 100, cols(close - 896_000, 111)));
    await before.flush();
    await appendFile(join(dir, `${ticker}_${close}.ndjson`), "{broken\n");
    const after = new ReplayJournal(dir);
    const current = cols(close - 400_000, 90);
    after.note(replayRow(ticker, close, 100, current));
    const restored = await after.restore(ticker, close, current);
    assert.deepEqual(restored.t, [0, 4, 500]);
    assert.deepEqual(restored.spot, [110, 111, 90]);
    assert.deepEqual(restored.seats.INDEX, [2, 2, 2]);
    assert.deepEqual(restored.imb, [-0.3, -0.3, -0.3]);
    assert.deepEqual(await after.restore(ticker, close + 1, current), current);
    assert.deepEqual(await after.restore("../wrong", close, current), current);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("journal write failure falls back to memory and never rejects", async () => {
  const dir = await mkdtemp(join(tmpdir(), "replay-failure-"));
  try {
    const file = join(dir, "file");
    await appendFile(file, "not a directory");
    const journal = new ReplayJournal(file);
    const current = cols(close - 1000, 100);
    journal.note(replayRow(ticker, close, 100, current));
    assert.deepEqual(await journal.restore(ticker, close, current), current);
    assert.ok(journal.lastError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
