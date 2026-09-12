import assert from "node:assert/strict";
import test from "node:test";
import { WindowStore } from "./replay-window.ts";
import { pointsFromReplay, type PricePoint } from "./exit-arena.ts";

// ---------------------------------------------------------------------------
// S2-4 — the Exit Arena must read the replay BEFORE persistence consumes it.
//
// In applyGrade, `recordReplay` removes the graded window's buffer with
// `series.take`, which runs synchronously before its first await. If the arena's
// `replayLive` read is sequenced AFTER that call, it reads null and every graded
// Chair-filled window's exit measurement is lost (desk_policy_observations sat at 0
// in production against 99 eligible fills).
//
// These tests model applyGrade's two consumers over the REAL WindowStore, whose
// `get`/`take` are exactly what `replayLive`/`recordReplay` delegate to, and the REAL
// `pointsFromReplay` transform. The FIXED and OLD orderings are both exercised so the
// suite discriminates the bug rather than merely asserting the source text.
// ---------------------------------------------------------------------------

const T = "KXBTC15M-26SEP111800-00";
const C1 = Date.parse("2026-09-11T22:00:00Z");
const C2 = Date.parse("2026-09-11T22:15:00Z"); // the next close, same ticker

type Cols = {
  t0: number;
  t: number[];
  yes_bid: number[];
  yes_ask: number[];
};

function seed(store: WindowStore<Cols>, ticker: string, closeMs: number, n = 4, tag = 60) {
  const cols: Cols = { t0: closeMs - 600_000, t: [], yes_bid: [], yes_ask: [] };
  for (let i = 0; i < n; i++) {
    cols.t.push(i * 4);
    cols.yes_bid.push(tag + i); // tag distinguishes which window a captured path came from
    cols.yes_ask.push(tag + i + 2);
  }
  store.set(ticker, closeMs, { ticker, close_time: closeMs, strike: 78_100, cols });
}

/** replayLive / recordReplay reduced to what they actually delegate to. */
const replayLive = (st: WindowStore<Cols>, ticker: string, closeMs: number) => st.get(ticker, closeMs);

/**
 * applyGrade's shape. `order: "fixed"` captures the arena path before the destructive
 * take (the S2-4 fix); `order: "old"` takes first (the bug). Returns what the arena
 * saw and whether the buffer survived — nothing else differs between the two.
 */
async function grade(
  st: WindowStore<Cols>,
  ticker: string,
  closeMs: number,
  booked: boolean,
  order: "fixed" | "old",
): Promise<{ arenaPath: PricePoint[] | null; takes: number; survived: boolean }> {
  let takes = 0;
  // recordReplay: take() runs synchronously before the first await, exactly as the real one.
  const recordReplay = (tk: string, cm: number) => {
    const s = st.take(tk, cm);
    takes += 1;
    return (async () => {
      if (!s) return;
      await Promise.resolve(); // stands in for `await sql()`
    })();
  };

  let arenaPath: PricePoint[] | null = null;

  if (order === "fixed") {
    // Capture synchronously, before consumption.
    const cap = booked ? replayLive(st, ticker, closeMs) : null;
    const captured = cap ? pointsFromReplay(cap.cols) : null;
    void recordReplay(ticker, closeMs);
    await (async () => {
      if (!captured || !booked) return;
      await Promise.resolve();
      arenaPath = captured;
    })();
  } else {
    // The bug: recordReplay's sync take() runs first, then the arena reads null.
    void recordReplay(ticker, closeMs);
    await (async () => {
      if (!booked) return;
      const cap = replayLive(st, ticker, closeMs);
      if (!cap) return;
      await Promise.resolve();
      arenaPath = pointsFromReplay(cap.cols);
    })();
  }
  await new Promise((r) => setTimeout(r, 0));
  return { arenaPath, takes, survived: st.get(ticker, closeMs) != null };
}

test("M2 · the arena sees the pre-consumption series under the fixed order", async () => {
  const st = new WindowStore<Cols>();
  seed(st, T, C1, 4, 60);
  const r = await grade(st, T, C1, true, "fixed");
  assert.ok(r.arenaPath, "the arena received a path");
  assert.equal(r.arenaPath!.length, 4, "the full series, not a truncation");
  assert.equal(r.arenaPath![0].yes_bid, 60, "and it is THIS window's series");
  assert.equal(r.takes, 1, "persistence consumed the buffer exactly once");
  assert.equal(r.survived, false, "the buffer is gone afterward");
});

test("M2 · the OLD order loses it — the test discriminates the bug", async () => {
  const st = new WindowStore<Cols>();
  seed(st, T, C1, 4, 60);
  const r = await grade(st, T, C1, true, "old");
  assert.equal(r.arenaPath, null, "recordReplay's sync take() ran first; the arena read null");
  assert.equal(r.takes, 1, "still consumed once — persistence was never the victim");
});

test("M1 · exact identity — the arena reads (ticker, close_time), not the ticker", async () => {
  const st = new WindowStore<Cols>();
  seed(st, T, C1, 4, 60);
  // A different close for the same ticker exists, with a distinguishable tag.
  seed(st, T, C2, 4, 90);
  const r = await grade(st, T, C1, true, "fixed");
  assert.ok(r.arenaPath);
  assert.equal(r.arenaPath![0].yes_bid, 60, "c1's series, never c2's");
});

test("M4 · neighbour isolation — grading c1 never supplies or consumes c2", async () => {
  for (const first of [C1, C2] as const) {
    const st = new WindowStore<Cols>();
    seed(st, T, C1, 4, 60);
    seed(st, T, C2, 4, 90);
    const other = first === C1 ? C2 : first === C2 ? C1 : first;
    const r = await grade(st, T, first, true, "fixed");
    assert.ok(r.arenaPath, `grading ${first} produced a path`);
    const wantTag = first === C1 ? 60 : 90;
    assert.equal(r.arenaPath![0].yes_bid, wantTag, "the graded window's own series");
    assert.ok(st.get(T, other) != null, "the other close was neither consumed nor read");
  }
});

test("M5 · unknown window fails closed — no fallback, no fabrication", async () => {
  const st = new WindowStore<Cols>();
  // Only c2 has a replay; grade c1, which has none.
  seed(st, T, C2, 4, 90);
  const r = await grade(st, T, C1, true, "fixed");
  assert.equal(r.arenaPath, null, "no replay for this exact window → no arena path");
  assert.ok(st.get(T, C2) != null, "the neighbour's replay was not borrowed");
});

test("M7 · a Chair sit-out (unbooked) window writes no arena path", async () => {
  const st = new WindowStore<Cols>();
  seed(st, T, C1, 4, 60);
  const r = await grade(st, T, C1, false, "fixed");
  assert.equal(r.arenaPath, null, "no booked position → nothing captured, nothing written");
  // The buffer is still consumed by persistence, as before — sit-out changes only the arena.
  assert.equal(r.takes, 1);
});

test("M3 · persistence consumes the window exactly once, fixed order or old", async () => {
  for (const order of ["fixed", "old"] as const) {
    const st = new WindowStore<Cols>();
    seed(st, T, C1, 4, 60);
    const r = await grade(st, T, C1, true, order);
    assert.equal(r.takes, 1, `single destructive take under the ${order} order`);
    assert.equal(r.survived, false, "buffer gone once");
  }
});

test("M6 · a short (<3 sample) series is still captured as-is; the transform is unchanged", () => {
  // recordReplay's own <3 persistence guard lives in replay.server and is untouched by
  // S2-4. Here we pin that the arena capture applies the SAME pointsFromReplay to
  // whatever samples exist, without a new length gate of its own.
  const short = pointsFromReplay({ t0: 0, t: [0, 4], yes_bid: [60, 61], yes_ask: [62, 63] });
  assert.equal(short.length, 2, "two points in, two points out — no fabrication, no drop");
  const empty = pointsFromReplay({ t0: 0, t: [], yes_bid: [], yes_ask: [] });
  assert.equal(empty.length, 0, "an empty series yields an empty path");
});
