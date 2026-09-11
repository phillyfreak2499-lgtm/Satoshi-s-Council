import assert from "node:assert/strict";
import test from "node:test";
import { lookupOneWindow, payloadKey, resolveOneWindow } from "./replay-lookup.ts";

// The real 2026-09-10 reuse shape: one ticker, the first two closes it spanned.
const T = "KXBTC15M-26SEP100300-00";
const C1 = "2026-09-10T07:00:00.000Z";
const C2 = "2026-09-10T07:15:00.000Z";

/** A stand-in for the database whose contents can change between calls. */
function fakeDb(initial: string[]) {
  const windows = new Set(initial);
  let probes = 0;
  let fetches = 0;
  return {
    add: (c: string) => windows.add(c),
    get probes() {
      return probes;
    },
    get fetches() {
      return fetches;
    },
    probe: async (_t: string) => {
      probes += 1;
      // `limit 2`: the query never returns more than two, and two is already a refusal.
      return [...windows].sort().slice(0, 2).map((close_time) => ({ close_time }));
    },
    fetchWindow: async (t: string, closeIso: string) => {
      fetches += 1;
      return windows.has(closeIso) ? `${t}@${closeIso}` : null;
    },
  };
}

test("exactly one window resolves; zero and more than one do not", () => {
  assert.equal(resolveOneWindow([{ close_time: C1 }]), C1);
  assert.equal(resolveOneWindow([]), null, "no replay for this ticker");
  assert.equal(resolveOneWindow([{ close_time: C1 }, { close_time: C2 }]), null, "ambiguous");
  // Order cannot matter, because the answer is refusal either way.
  assert.equal(resolveOneWindow([{ close_time: C2 }, { close_time: C1 }]), null);
});

test("one window is returned; none and ambiguous both return null", async () => {
  const cache = new Map<string, string>();
  const one = fakeDb([C1]);
  assert.equal(await lookupOneWindow(T, cache, one.probe, one.fetchWindow), `${T}@${C1}`);

  const none = fakeDb([]);
  const emptyCache = new Map<string, string>();
  assert.equal(await lookupOneWindow(T, emptyCache, none.probe, none.fetchWindow), null);
  assert.equal(none.fetches, 0, "nothing is fetched when there is nothing to fetch");

  const two = fakeDb([C1, C2]);
  const c3 = new Map<string, string>();
  assert.equal(await lookupOneWindow(T, c3, two.probe, two.fetchWindow), null, "fail closed");
  assert.equal(two.fetches, 0, "an ambiguous ticker fetches no payload");
  assert.equal(c3.size, 0, "and caches nothing");
});

test("a cached payload cannot answer a ticker that has become ambiguous", async () => {
  // THE TRANSITION, with no manual cache clearing anywhere in this test.
  const cache = new Map<string, string>();
  const db = fakeDb([C1]);

  // 1-3 · only (T,c1) exists; the lookup returns it and caches the payload.
  assert.equal(await lookupOneWindow(T, cache, db.probe, db.fetchWindow), `${T}@${C1}`);
  assert.equal(cache.size, 1, "the payload is cached");
  assert.equal(cache.get(payloadKey(T, C1)), `${T}@${C1}`, "under its own window's key");
  assert.equal(db.fetches, 1);

  // A second call still serves from cache — the cache is genuinely in use, so the
  // next step is a real test of the probe and not of a disabled cache.
  assert.equal(await lookupOneWindow(T, cache, db.probe, db.fetchWindow), `${T}@${C1}`);
  assert.equal(db.fetches, 1, "served from cache, no second fetch");
  assert.equal(db.probes, 2, "but the identity was probed again");

  // 4 · (T,c2) becomes visible.
  db.add(C2);

  // 5-6 · the same lookup, same cache, must now refuse.
  assert.equal(
    await lookupOneWindow(T, cache, db.probe, db.fetchWindow),
    null,
    "the stale cached payload must not suppress the new ambiguity",
  );
  assert.equal(db.probes, 3, "the probe ran again rather than being skipped");
  // The cached entry is still there and still correct for its own window — it is
  // simply no longer reachable from a ticker that names two.
  assert.equal(cache.get(payloadKey(T, C1)), `${T}@${C1}`);
});

test("a cached payload is never served for a different window of the same ticker", async () => {
  // REACHABLE, not hypothetical: `pruneReplays` deletes rows past 30 days, so a ticker
  // that named c1 can later name only c2. Keyed on the ticker alone the cache would
  // hand back c1's series for c2's window — the identity defect, inside the cache.
  const cache = new Map<string, string>();
  const windows = new Set([C1]);
  const probe = async () => [...windows].sort().slice(0, 2).map((close_time) => ({ close_time }));
  const fetchWindow = async (t: string, closeIso: string) =>
    windows.has(closeIso) ? `${t}@${closeIso}` : null;

  assert.equal(await lookupOneWindow(T, cache, probe, fetchWindow), `${T}@${C1}`);
  assert.equal(cache.size, 1, "c1's payload is cached");

  // c1 ages out and c2 is the ticker's only window now.
  windows.delete(C1);
  windows.add(C2);

  assert.equal(
    await lookupOneWindow(T, cache, probe, fetchWindow),
    `${T}@${C2}`,
    "the new window's series, not the cached one from the old window",
  );
  assert.equal(cache.get(payloadKey(T, C1)), `${T}@${C1}`, "the old entry is still its own");
  assert.equal(cache.get(payloadKey(T, C2)), `${T}@${C2}`, "and the new one is separate");
});

test("the probe runs before the cache, every time", async () => {
  const cache = new Map<string, string>();
  const db = fakeDb([C1]);
  await lookupOneWindow(T, cache, db.probe, db.fetchWindow);
  const after = db.probes;
  await lookupOneWindow(T, cache, db.probe, db.fetchWindow);
  assert.equal(db.probes, after + 1, "a cache hit does not skip the identity probe");
});

test("two windows of one ticker cannot collide in the cache", () => {
  assert.notEqual(payloadKey(T, C1), payloadKey(T, C2));
  assert.equal(payloadKey(T, C1), payloadKey(T, C1));
  const cache = new Map<string, string>();
  cache.set(payloadKey(T, C1), "first");
  cache.set(payloadKey(T, C2), "second");
  assert.equal(cache.size, 2, "both windows live in the cache at once");
  assert.equal(cache.get(payloadKey(T, C1)), "first");
  assert.equal(cache.get(payloadKey(T, C2)), "second");
  // HONEST LIMIT OF THE KEY. It is a join on "|", so it is NOT injective over
  // arbitrary strings: payloadKey("A|1","2") and payloadKey("A","1|2") are both
  // "A|1|2". That collision is unreachable in production rather than impossible in
  // principle — a ticker cannot contain the separator (TICKER_RE admits only
  // [A-Z0-9-]) and the close is always a fixed-shape ISO string. Asserting the real
  // guard rather than pretending the key is injective.
  assert.equal(payloadKey("A|1", "2"), payloadKey("A", "1|2"), "the separator is not escaped");
  const TICKER_RE = /^[A-Z0-9-]{6,40}$/; // the same shape replay.server.ts admits
  assert.doesNotMatch("A|1", TICKER_RE, "a ticker carrying the separator is rejected upstream");
  assert.match(T, TICKER_RE, "a real Kalshi ticker passes and carries no separator");
  assert.doesNotMatch(C1, /\|/, "nor does an ISO close");
});

test("the cache is bounded and a miss that finds nothing caches nothing", async () => {
  const cache = new Map<string, string>();
  for (let i = 0; i < 30; i++) {
    const c = `2026-09-10T07:${String(i).padStart(2, "0")}:00.000Z`;
    const db = fakeDb([c]);
    await lookupOneWindow(`${T}-${i}`, cache, db.probe, db.fetchWindow, 24);
  }
  assert.ok(cache.size <= 25, `cache stayed bounded, got ${cache.size}`);

  // A window the probe names but the payload query cannot produce caches nothing.
  const odd = {
    probe: async () => [{ close_time: C1 }],
    fetchWindow: async () => null,
  };
  const c2 = new Map<string, string>();
  assert.equal(await lookupOneWindow(T, c2, odd.probe, odd.fetchWindow), null);
  assert.equal(c2.size, 0, "no null is cached");
});
