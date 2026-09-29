import assert from "node:assert/strict";
import test from "node:test";
import { AsyncStaleCache } from "./async-stale-cache.ts";

test("coalesces concurrent misses and reuses a fresh value", async () => {
  let now = 1_000;
  let loads = 0;
  let release!: (value: string) => void;
  const cache = new AsyncStaleCache<string, string>(100, 1_000, 8, () => now);
  const load = () => {
    loads += 1;
    return new Promise<string>((resolve) => { release = resolve; });
  };

  const one = cache.get("player", load);
  const two = cache.get("player", load);
  assert.equal(loads, 1);
  release("first");
  assert.deepEqual(await Promise.all([one, two]), ["first", "first"]);

  now += 50;
  assert.equal(await cache.get("player", async () => "wrong"), "first");
  assert.equal(loads, 1);
});

test("serves a bounded stale value when refresh fails", async () => {
  let now = 5_000;
  const cache = new AsyncStaleCache<string, number>(100, 1_000, 8, () => now);
  assert.equal(await cache.get("board", async () => 7), 7);

  now += 101;
  assert.equal(await cache.get("board", async () => { throw new Error("db unavailable"); }), 7);

  now += 1_000;
  await assert.rejects(cache.get("board", async () => { throw new Error("still unavailable"); }), /still unavailable/);
});

test("invalidation forces a new load and the cache stays bounded", async () => {
  const cache = new AsyncStaleCache<string, number>(1_000, 2_000, 2, () => 10_000);
  await cache.get("a", async () => 1);
  await cache.get("b", async () => 2);
  await cache.get("c", async () => 3);

  let loads = 0;
  assert.equal(await cache.get("a", async () => { loads += 1; return 4; }), 4);
  assert.equal(loads, 1, "the oldest entry was evicted");

  cache.invalidate("a");
  assert.equal(await cache.get("a", async () => 5), 5);
  cache.clear();
  assert.equal(await cache.get("a", async () => 6), 6);
});

test("invalidation during a failing refresh prevents a stale fallback", async () => {
  let now = 20_000;
  let reject!: (error: Error) => void;
  const cache = new AsyncStaleCache<string, number>(100, 2_000, 8, () => now);
  await cache.get("player", async () => 1);
  now += 101;

  const refresh = cache.get("player", () => new Promise<number>((_resolve, no) => { reject = no; }));
  cache.invalidate("player");
  reject(new Error("db unavailable"));
  await assert.rejects(refresh, /db unavailable/);
});
