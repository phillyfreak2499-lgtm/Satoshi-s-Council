/**
 * S2-5 decision-snapshot WRITE ORCHESTRATION (pure; no DB, no feed).
 *
 * This is the part that must be correct under concurrency and failure, so it is
 * kept free of `@/lib/db` and driven through an injected `DecisionStore`. The
 * server adapter (decision-snapshot.server.ts) supplies a store backed by
 * Postgres; tests supply a fake store they can delay and fail deterministically.
 *
 * THREE GUARANTEES beyond the pure event rule:
 *
 *  1. OPENING is the FIRST CAPTURED finalized read, not the first DB winner.
 *     Writes for one window are SERIALIZED through a per-window promise chain, so
 *     a later tick's store call can never run before an earlier tick's finishes.
 *     The first read that the rule calls an opening is FROZEN in memory and it is
 *     that frozen row which is (re)written -- a later tick cannot substitute its
 *     own values even if its store call would have finished first.
 *
 *  2. A transient write failure is OBSERVABLE and RETRYABLE. persistOne never
 *     swallows: a store rejection propagates out of record(), so the engine's
 *     outer `.catch` routes it to noteErr. On failure the window is NOT marked
 *     done, so the next tick retries the SAME frozen row -- OPENING is never
 *     redefined as a later tick because an earlier write failed.
 *
 *  3. FIRST_DIRECTIONAL gets the same treatment: the first directional read after
 *     a durable WAIT opening is frozen and retried, never replaced by a later one.
 *
 * The database's UNIQUE (ticker, close_time, snapshot_kind) remains the durable
 * duplicate guard; restart correctness comes from reading persisted state back
 * through the store before the first write for a window.
 */
import { decisionSnapshotEvents, type DecisionSnapshotRow, type SnapshotKind } from "./decision-snapshot.ts";
import { tickerAgrees } from "./window-identity.ts";
import type { Lean } from "./types.ts";

/** What the store reports about one exact window's persisted rows. */
export type PersistedWindow = {
  openingExists: boolean;
  openingLean: Lean | null;
  firstDirectionalExists: boolean;
};

/** The durable side, injected. Both methods address the EXACT window. */
export type DecisionStore = {
  lookupWindow(ticker: string, closeMs: number): Promise<PersistedWindow>;
  /** Idempotent insert (on conflict do nothing). Rejects on a real write failure. */
  insertSnapshot(row: DecisionSnapshotRow, kind: SnapshotKind): Promise<void>;
};

/** This process's knowledge of one live window. The store is authoritative. */
type WindowMem = {
  openingDone: boolean;
  openingLean: Lean | null;
  /** The frozen first-captured OPENING facts; retried verbatim until durable. */
  openingRow: DecisionSnapshotRow | null;
  firstDirectionalDone: boolean;
  /** The frozen first-captured directional facts after a WAIT opening. */
  firstDirectionalRow: DecisionSnapshotRow | null;
};

const MEM_MAX = 128;
const NOOP = () => {};

function memKey(ticker: string, closeMs: number): string {
  return `${ticker}|${closeMs}`;
}

export type DecisionWriter = {
  /** Persist this tick's decision snapshot if it is one of the two bounded events.
   *  Non-blocking by contract (the caller voids it); rejects on a store failure. */
  record(row: DecisionSnapshotRow): Promise<void>;
  /** Test-only: forget all per-window state. */
  reset(): void;
};

export function createDecisionWriter(store: DecisionStore): DecisionWriter {
  const mem = new Map<string, WindowMem>();
  const chains = new Map<string, Promise<unknown>>();

  function setMem(key: string, st: WindowMem): void {
    mem.set(key, st);
    if (mem.size > MEM_MAX) {
      const oldest = mem.keys().next().value;
      if (oldest !== undefined) mem.delete(oldest);
    }
  }

  async function persistOne(row: DecisionSnapshotRow): Promise<void> {
    const key = memKey(row.ticker, row.close_time_ms);
    let st = mem.get(key);
    if (!st) {
      // First sight this process, or after a restart: the store is authoritative
      // on what the opening read was. Read the exact window back, then cache.
      const seen = await store.lookupWindow(row.ticker, row.close_time_ms);
      st = {
        openingDone: seen.openingExists,
        openingLean: seen.openingLean,
        openingRow: null,
        firstDirectionalDone: seen.firstDirectionalExists,
        firstDirectionalRow: null,
      };
      setMem(key, st);
    }

    // OPENING: freeze the first-captured row and (re)write THAT row until durable.
    const plan = decisionSnapshotEvents({
      openingExists: st.openingDone,
      openingLean: st.openingLean,
      firstDirectionalExists: st.firstDirectionalDone,
      currentLean: row.chair_lean,
    });
    if (plan.insertOpening && !st.openingRow) st.openingRow = row;
    if (st.openingRow && !st.openingDone) {
      await store.insertSnapshot(st.openingRow, "OPENING"); // rejects on failure -> retry next tick
      const back = await store.lookupWindow(row.ticker, row.close_time_ms);
      st.openingDone = back.openingExists;
      st.openingLean = back.openingLean;
      if (back.firstDirectionalExists) st.firstDirectionalDone = true;
    }

    // FIRST_DIRECTIONAL: only after a durable WAIT opening; freeze the first
    // directional read and retry THAT row, never a later one.
    if (st.openingDone && st.openingLean === "WAIT" && !st.firstDirectionalDone) {
      const fd = decisionSnapshotEvents({
        openingExists: true,
        openingLean: "WAIT",
        firstDirectionalExists: false,
        currentLean: row.chair_lean,
      });
      if (fd.insertFirstDirectional && !st.firstDirectionalRow) st.firstDirectionalRow = row;
      if (st.firstDirectionalRow) {
        await store.insertSnapshot(st.firstDirectionalRow, "FIRST_DIRECTIONAL");
        const back = await store.lookupWindow(row.ticker, row.close_time_ms);
        st.firstDirectionalDone = back.firstDirectionalExists;
      }
    }
  }

  function record(row: DecisionSnapshotRow): Promise<void> {
    if (!row.ticker || !Number.isFinite(row.close_time_ms) || row.close_time_ms <= 0) return Promise.resolve();
    if (!Number.isFinite(row.decision_at_ms) || row.decision_at_ms <= 0) return Promise.resolve();
    if (row.ticker.includes("DEMO")) return Promise.resolve();
    // Window-identity guard. At a rollover the close advances to the next window
    // before the feed's ticker catches up, yielding (stale ticker, new close) — a
    // pair window-identity POSITIVELY disagrees with (the same stale-ticker/new-close
    // contradiction matchSettle already fails closed on). Refuse to measure a
    // contradictory window here, before the chain/freeze/insert: no chain, no frozen
    // OPENING, no row. `null` (ticker unparseable) is NOT refused — matching the
    // module's philosophy of failing closed only on a known disagreement — and the
    // real window's tick a few seconds later records normally.
    if (tickerAgrees(row.ticker, row.close_time_ms) === false) return Promise.resolve();

    const key = memKey(row.ticker, row.close_time_ms);
    const prev = chains.get(key) ?? Promise.resolve();
    // Serialize per window: this write runs only after the previous one settles
    // (resolved OR rejected), so DB latency can never reorder which read is OPENING.
    const mine = prev.then(
      () => persistOne(row),
      () => persistOne(row),
    );
    // The chain tail never rejects, so one failed write does not wedge the window.
    chains.set(key, mine.then(NOOP, NOOP));
    if (chains.size > MEM_MAX) {
      const oldest = chains.keys().next().value;
      if (oldest !== undefined && oldest !== key) chains.delete(oldest);
    }
    return mine; // the caller observes a rejection here
  }

  return { record, reset: () => { mem.clear(); chains.clear(); } };
}
