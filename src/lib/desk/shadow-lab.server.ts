/**
 * Shadow-lab observer and receipt writer (server only).
 *
 * WIRED, ENV-GATED, DEFAULT OFF. server/routes/healthz.get.ts kicks
 * `ensureShadowLabObserver` beside the other observers, but it returns
 * "disabled" unless SHADOW_LAB_ENABLED=true, so a deploy alone cannot start
 * collection (docs/ACTIVATION_ROLLBACK_2026-09-22.md, docs/SHADOW_EXPERIMENTS_2026-09-22.md).
 * The tick reads a structuredClone of the engine frame and catches every
 * error into its own health record; a failing database, frame or arm can
 * never reach the Chair, the gate or the paper book (scripts/audit-reconcile-rails.test.mjs).
 *
 * WHAT IT WRITES. Only desk_shadow_receipts and desk_shadow_manifests, both
 * append-only through primary-key ON CONFLICT DO NOTHING; a settle sweep fills
 * in official_winner/net_cents on fill receipts from the official ledger row
 * using the fee already recorded on the receipt. It never touches desk_ledger,
 * desk_state, the learner, a seat or card status, thresholds, the Chair, the
 * paper book, or any promotion.
 *
 * WHAT IT COMPUTES, per tick, inside the 3–10 minute window only:
 *   NULL_FAV_{80,85,88}  the favourite benchmark at T−7:30 (T−5 fallback).
 *   PKG_{80,85,88}, PKG_85_OWNER3  the E1 package: runChair over the unmuted
 *                        votes with a shadow learner, then the full gate vector
 *                        under the arm's floor and quorum with STREAK counted
 *                        as a book read, then the arm's own confirmation latch
 *                        and its own causal day state.
 *   VETO_{8S,15S,30S}    E2: the PKG_85 stream under a post-shock cooldown.
 *   BASIS_{5,7,9}BPS     E3: the PKG_85 stream under a re-priced edge gate.
 * Sub-second availability is not resolvable at a 2 s poll: hittable flags stay
 * null (UNKNOWN); the ask two seconds later is recorded in the payload as a
 * coarse proxy and labelled as such.
 */
import { getSql, type Sql } from "@/lib/db";
import { runChair } from "./chair.ts";
import { chicagoDayOf } from "./economics-book.ts";
import { DEFAULT_FEE_ENGINE, feeCents, realAskCents } from "./fee-engine.ts";
import { DEPLOYED_POLICY, OWNER_REFERENCE_POLICY, gateVector, supporterRows, type AdmissionPolicy } from "./gate-vector.ts";
import type { EntryWatch, SelectiveContext } from "./selective-entry.ts";
import { JUMP_VETO, blankJumpVeto, e1FamilyOf, edgeUnderBasis, nullFavIntention, observeJump, scheduledCheckpoint, unmuteRoster, vetoActive, type JumpVetoState } from "./shadow-arms.ts";
import { INITIAL_SHADOW_COLLECTION_IDS, SHADOW_MANIFESTS, SHADOW_MANIFEST_FINGERPRINTS } from "./shadow-manifests.ts";
import { SHADOW_FEE_FINGERPRINT, receiptKey, type ShadowReceipt } from "./shadow-lab.ts";
import type { CallLogRow, ChairResult, Settings, Snapshot } from "./types";

export const SHADOW_LAB_ENV_FLAG = "SHADOW_LAB_ENABLED";
export const SHADOW_LAB_POLL_MS = 2_000;
export const SHADOW_LAB_SETTLE_EVERY_MS = 60_000;

export function shadowLabEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[SHADOW_LAB_ENV_FLAG] === "true";
}

const buildSha = () => process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? "";

// ---------------------------------------------------------------------------
// Writes: append-only, idempotent.
// ---------------------------------------------------------------------------

/** Insert one receipt; true when the row was new. The primary key is the idempotent key. */
export async function recordShadowReceipt(sql: Sql, r: ShadowReceipt, payload: Record<string, unknown> = {}): Promise<boolean> {
  const rows = await sql<{ experiment: string }>`
    insert into desk_shadow_receipts (experiment, arm, ticker, close_time, kind, decided_at, side, ask_cents, fee_engine, fee_cents, size_at_ask,
      spread_cents, feeds_ok, hittable_150ms, hittable_500ms, official_winner, net_cents, note, payload, build_sha)
    values (${r.experiment}, ${r.arm}, ${r.ticker}, ${new Date(r.close_ms).toISOString()}::timestamptz, ${r.kind}, ${new Date(r.decided_ms).toISOString()}::timestamptz,
      ${r.side}, ${r.ask_cents}, ${r.fee_engine}, ${r.fee_cents}, ${r.size_at_ask}, ${r.spread_cents}, ${r.feeds_ok}, ${r.hittable_150ms}, ${r.hittable_500ms},
      ${r.official_winner}, ${r.net_cents}, ${r.note}, ${JSON.stringify(payload)}::jsonb, ${buildSha()})
    on conflict (experiment, arm, ticker, close_time, kind) do nothing
    returning experiment`;
  return rows.length > 0;
}

/** Register the frozen manifests once. Never rewrites an existing specimen. */
export async function registerShadowManifests(sql: Sql): Promise<number> {
  let inserted = 0;
  for (const m of SHADOW_MANIFESTS) {
    const rows = await sql<{ experiment: string }>`
      insert into desk_shadow_manifests (experiment, experiment_version, fingerprint, manifest, frozen_at, status)
      values (${m.id}, ${m.experiment_version}, ${SHADOW_MANIFEST_FINGERPRINTS[m.id] ?? ""}, ${JSON.stringify(m)}::jsonb, ${m.frozen_at}::timestamptz, ${m.status})
      on conflict (experiment, experiment_version) do nothing returning experiment`;
    inserted += rows.length;
  }
  return inserted;
}


/**
 * Existing rows are allowed only when they are the exact frozen specimen this
 * build knows how to collect. ON CONFLICT DO NOTHING is not permission to
 * continue an older manifest under a new code fingerprint.
 */
export async function verifyShadowManifests(sql: Sql): Promise<void> {
  for (const m of SHADOW_MANIFESTS) {
    const rows = await sql<{ fingerprint: string; fee_fingerprint: string | null }>`
      select fingerprint, manifest #>> '{fingerprints,fee}' as fee_fingerprint
      from desk_shadow_manifests
      where experiment = ${m.id} and experiment_version = ${m.experiment_version}
    `;
    if (rows.length !== 1) throw new Error(`shadow manifest verify failed: ${m.id} row count ${rows.length}`);
    const expected = SHADOW_MANIFEST_FINGERPRINTS[m.id] ?? "";
    if (rows[0]!.fingerprint !== expected) {
      throw new Error(`shadow manifest fingerprint mismatch: ${m.id}`);
    }
    if (rows[0]!.fee_fingerprint !== SHADOW_FEE_FINGERPRINT) {
      throw new Error(`shadow manifest fee fingerprint mismatch: ${m.id}`);
    }
  }
}

/**
 * Atomically establish the first prospective epoch for exactly E1–E3.
 *
 * The single guarded UPDATE is all-or-nothing at statement level: it runs only
 * when all three target manifests are in a coherent pre-start state
 * (CANDIDATE/null) or an already-started state (SHADOW/non-null). MIRROR-35 is
 * not a target. Existing prospective timestamps are preserved, so a restart can
 * never backdate or move the research boundary.
 */
export async function activateInitialShadowCollection(sql: Sql, activatedAtMs: number): Promise<{ active: number; started_at: string[] }> {
  if (!Number.isFinite(activatedAtMs) || activatedAtMs <= 0) throw new Error("invalid shadow activation clock");
  const at = new Date(activatedAtMs).toISOString();
  const [e1, e2, e3] = INITIAL_SHADOW_COLLECTION_IDS;
  if (!e1 || !e2 || !e3 || INITIAL_SHADOW_COLLECTION_IDS.length !== 3) throw new Error("shadow activation target set must contain exactly three manifests");

  const rows = await sql<{ experiment: string; prospective_start_at: string }>`
    with target as (
      select experiment, experiment_version, status, prospective_start_at
      from desk_shadow_manifests
      where experiment in (${e1}, ${e2}, ${e3}) and experiment_version = 1
    ), state as (
      select
        count(*)::int as n,
        count(*) filter (where status = 'CANDIDATE' and prospective_start_at is null)::int as candidates,
        count(*) filter (where status = 'SHADOW' and prospective_start_at is not null)::int as shadows,
        count(distinct prospective_start_at) filter (where status = 'SHADOW' and prospective_start_at is not null)::int as shadow_starts
      from target
    ), allowed as (
      select n = 3 and (candidates = 3 or (shadows = 3 and shadow_starts = 1)) as ok
      from state
    )
    update desk_shadow_manifests m
       set status = 'SHADOW',
           prospective_start_at = coalesce(m.prospective_start_at, ${at}::timestamptz)
     where m.experiment in (${e1}, ${e2}, ${e3})
       and m.experiment_version = 1
       and (select ok from allowed)
    returning m.experiment, m.prospective_start_at::text
  `;

  if (rows.length !== 3) {
    throw new Error(`shadow activation refused: expected one uniform 3-manifest state, got ${rows.length} rows`);
  }
  const starts = [...new Set(rows.map((r) => String(r.prospective_start_at)))].sort();
  if (starts.length !== 1) throw new Error(`shadow activation refused: prospective boundary split across ${starts.length} timestamps`);
  return { active: rows.length, started_at: starts };
}

/**
 * Settle fill receipts from the official ledger row, with the fee the receipt
 * already carries. Touches only desk_shadow_receipts rows that are still open.
 */
export async function settleShadowReceipts(sql: Sql): Promise<number> {
  const rows = await sql<{ experiment: string }>`
    update desk_shadow_receipts r
    set official_winner = l.winner,
        net_cents = case when r.side = l.winner then 100 - r.ask_cents - coalesce(r.fee_cents, 0) else -r.ask_cents - coalesce(r.fee_cents, 0) end
    from desk_ledger_research l
    where r.kind = 'fill' and r.official_winner is null and r.side is not null and r.ask_cents is not null
      and l.ticker = r.ticker and l.close_time = r.close_time and l.winner in ('UP', 'DOWN') and l.source = 'kalshi-result'
    returning r.experiment`;
  return rows.length;
}

// ---------------------------------------------------------------------------
// Arm state (in memory; the database is the record).
// ---------------------------------------------------------------------------

type ArmState = { watch: EntryWatch | null; decided: Set<string>; lastAsk: Map<string, { ask: number; at: number; side: "UP" | "DOWN" }> };
type Observer = { timer: ReturnType<typeof setInterval> | null; starting: boolean; busy: boolean; arms: Map<string, ArmState>; jump: JumpVetoState; lastSettle: number; lastCapture: number | null; error: string | null; activatedAt: number };
const globalRef = globalThis as typeof globalThis & { __shadowLab__?: Observer };
const state = (): Observer => globalRef.__shadowLab__ ??= { timer: null, starting: false, busy: false, arms: new Map(), jump: blankJumpVeto(), lastSettle: 0, lastCapture: null, error: null, activatedAt: 0 };
const armState = (id: string): ArmState => { const st = state(); const cur = st.arms.get(id) ?? { watch: null, decided: new Set(), lastAsk: new Map() }; st.arms.set(id, cur); return cur; };

const E1 = "UNMUTE_DEDUP_SHELF_V1", E2 = "WARDEN_JUMP_VETO_V1", E3 = "SETTLE_BASIS_MEASURED_V1";

function exactSideQuote(snap: Snapshot, side: "UP" | "DOWN") {
  const up = side === "UP";
  const decisionAsk = up ? snap.yes_ask : snap.no_ask;
  const decisionBid = up ? snap.yes_bid : snap.no_bid;
  const decisionSize = up ? snap.no_bid_size : snap.yes_bid_size;
  const askCandidate = up ? snap.yes_ask_exact : snap.no_ask_exact;
  const bidCandidate = up ? snap.yes_bid_exact : snap.no_bid_exact;
  const exactAsk = realAskCents(Number(askCandidate)) ? Number(askCandidate) : decisionAsk;
  const exactBid = realAskCents(Number(bidCandidate)) ? Number(bidCandidate) : decisionBid;
  // YES ask depth lives on the NO bid; DOWN/NO ask depth lives on the YES bid.
  const sizeCandidate = up ? snap.no_bid_size_exact : snap.yes_bid_size_exact;
  const exactSize = Number.isFinite(Number(sizeCandidate)) && Number(sizeCandidate) > 0 ? Number(sizeCandidate) : decisionSize;
  return { decisionAsk, decisionBid, decisionSize, exactAsk, exactBid, exactSize };
}

const receipt = (experiment: string, arm: string, snap: Snapshot, kind: ShadowReceipt["kind"], side: "UP" | "DOWN" | null, ask: number | null, size: number | null, spread: number | null, feedsOk: boolean | null, note: string | null): ShadowReceipt => ({
  experiment, arm, ticker: snap.ticker, close_ms: snap.close_time, kind, decided_ms: snap.as_of, side, ask_cents: ask, fee_engine: DEFAULT_FEE_ENGINE,
  fee_cents: ask != null && realAskCents(ask) ? feeCents(ask) : null, size_at_ask: size, spread_cents: spread, feeds_ok: feedsOk, hittable_150ms: null, hittable_500ms: null,
  official_winner: null, net_cents: null, note,
});

/** The arm's own risk history, from its own fill receipts, as the day-state functions expect it. */
async function armCalls(sql: Sql, experiment: string, arm: string, asOf: number): Promise<CallLogRow[]> {
  const day = chicagoDayOf(asOf);
  const rows = await sql<{ ticker: string; close_ms: number | string; decided_ms: number | string; side: "UP" | "DOWN"; ask_cents: number; net_cents: number | null; official_winner: "UP" | "DOWN" | null }>`
    select ticker, (extract(epoch from close_time) * 1000)::bigint as close_ms, (extract(epoch from decided_at) * 1000)::bigint as decided_ms, side, ask_cents, net_cents, official_winner
    from desk_shadow_receipts where experiment = ${experiment} and arm = ${arm} and kind = 'fill' and close_time > ${new Date(asOf - 48 * 3_600_000).toISOString()}::timestamptz`;
  return rows
    .filter((r) => chicagoDayOf(Number(r.decided_ms)) === day || r.official_winner == null)
    .map((r) => ({ id: `${experiment}|${arm}|${r.ticker}`, ticker: r.ticker, t: Number(r.decided_ms), close_time: Number(r.close_ms), lean: r.side, cents: Number(r.ask_cents), settle: r.official_winner == null ? null : r.official_winner === r.side ? 100 : 0, flipped: false }) as CallLogRow);
}

function armPolicy(base: AdmissionPolicy, floor: number, minSpeaking: number): AdmissionPolicy {
  return { ...base, id: `${base.id}@${floor}c/${minSpeaking}`, params: { ...base.params, floor_cents: floor, min_speaking: minSpeaking } };
}

/** The E1 package decision for one arm: gate vector with the arm's floor/quorum, STREAK counted as book, its own latch. */
function packageDecision(snap: Snapshot, chair: ChairResult, calls: CallLogRow[], arm: ArmState, policy: AdmissionPolicy, start: number) {
  const side = chair.lean === "UP" || chair.lean === "DOWN" ? chair.lean : null;
  const ctx: SelectiveContext = { calls, ready: true, start, watch: arm.watch };
  const v = gateVector(snap, chair, ctx, policy);
  let familiesOk = true;
  if (side) {
    const fams = new Set(supporterRows(chair, side).map((r) => e1FamilyOf(r.seat)));
    familiesOk = fams.size >= policy.params.min_families;
  }
  const eligible = side != null && familiesOk && v.checks.filter((k) => k.id !== "confirmation" && k.id !== "families").every((k) => k.pass === true);
  const p = policy.params;
  const tight = v.mode === "tight";
  const needFrames = tight ? p.tight_confirmation_frames : p.confirmation_frames;
  const needSecs = tight ? p.tight_confirmation_seconds : p.confirmation_seconds;
  let watch: EntryWatch | null = null;
  if (eligible && side) {
    const key = `${snap.ticker}|${snap.close_time}`;
    const old = arm.watch;
    watch = old && old.key === key && old.side === side && old.mode === v.mode && snap.as_of >= old.last && snap.as_of - old.last <= 10_000
      ? { ...old, last: snap.as_of, frames: old.frames + Number(snap.as_of > old.last) }
      : { key, side, since: snap.as_of, last: snap.as_of, frames: 1, mode: v.mode };
  }
  arm.watch = watch;
  const confirmed = !!watch && watch.frames >= needFrames && snap.as_of - watch.since >= needSecs * 1000;
  return { side, eligible, confirmed, vector: v, familiesOk };
}

/** One tick. Exported for the harness; the timer calls it. */
export async function shadowLabTick(now = Date.now()): Promise<void> {
  const st = state();
  if (st.busy) return;
  st.busy = true;
  try {
    const sql = await getSql();
    if (now - st.lastSettle > SHADOW_LAB_SETTLE_EVERY_MS) { st.lastSettle = now; await settleShadowReceipts(sql); }
    const { getServerFrame } = await import("./server-engine");
    const frame = await getServerFrame();
    if (!frame.snap || !frame.chair || frame.snap.demo || !frame.selective.ready) return;
    const { snap, votes, learner, settings } = structuredClone({ snap: frame.snap, votes: frame.votes, learner: frame.learner, settings: frame.settings });
    const secs = (snap.close_time - snap.as_of) / 1000;
    st.jump = observeJump(st.jump, snap.yes_ask, snap.no_ask, snap.as_of);
    if (!(secs >= 180 && secs <= 600)) return;
    const windowKey = `${snap.ticker}|${snap.close_time}`;
    const writes: Array<Promise<boolean>> = [];
    const pending = new Set<string>();
    const once = (r: ShadowReceipt, payload: Record<string, unknown> = {}) => {
      const a = armState(`${r.experiment}|${r.arm}`);
      const k = receiptKey(r);
      if (a.decided.has(k) || pending.has(k)) return;
      pending.add(k);
      writes.push(
        recordShadowReceipt(sql, r, payload)
          .then((inserted) => {
            // A successful insert OR an idempotent DB conflict proves the key is durable.
            a.decided.add(k);
            if (a.decided.size > 2_000) a.decided = new Set([...a.decided].slice(-1_000));
            return inserted;
          })
          .finally(() => pending.delete(k)),
      );
    };

    // NULL_FAV benchmarks at their frozen checkpoints.
    const cp = scheduledCheckpoint(secs);
    for (const floor of [80, 85, 88]) {
      const arm = `NULL_FAV_${floor}`;
      const a = armState(`${E1}|${arm}`);
      if (cp != null && !a.decided.has(`${E1}|${arm}|${windowKey}|fill`)) {
        const i = nullFavIntention(snap, floor);
        if (i) {
          const q = exactSideQuote(snap, i.side);
          once(receipt(E1, arm, snap, "fill", i.side, q.exactAsk, q.exactSize, q.exactAsk - q.exactBid, i.feeds_ok, `checkpoint ${cp}s`), {
            checkpoint: cp, secs_left: secs, execution_qualified: true, hittability: "UNKNOWN at 2s poll",
            qualification_ask_cents: i.ask_cents, exact_ask_cents: q.exactAsk, price_lane: "exact_measurement",
          });
        }
        else if (cp === 300) once(receipt(E1, arm, snap, "no_fill", null, null, null, null, null, "no eligible favourite at 450s or 300s"), { checkpoint: cp });
      }
    }

    // The E1 package: shadow Chair over unmuted votes, no sticky lean (documented).
    const unmuted = unmuteRoster(votes, learner);
    const fullSettings = { ...settings, poll_ms: SHADOW_LAB_POLL_MS, source: "live", show_faded: false, show_shadow: false, tz: "America/Chicago" } as unknown as Settings;
    const chair = runChair(unmuted.votes, snap, unmuted.learner, fullSettings, "WAIT", []);
    const packages: Array<{ arm: string; floor: number; min: number; base: AdmissionPolicy }> = [
      { arm: "PKG_85", floor: 85, min: 2, base: DEPLOYED_POLICY }, { arm: "PKG_80", floor: 80, min: 2, base: DEPLOYED_POLICY },
      { arm: "PKG_88", floor: 88, min: 2, base: DEPLOYED_POLICY }, { arm: "PKG_85_OWNER3", floor: 85, min: 3, base: OWNER_REFERENCE_POLICY },
    ];
    let pkg85: { side: "UP" | "DOWN"; ask: number; size: number; spread: number; filled: boolean; intent: boolean } | null = null;
    for (const p of packages) {
      const a = armState(`${E1}|${p.arm}`);
      const calls = await armCalls(sql, E1, p.arm, snap.as_of);
      const d = packageDecision(snap, chair, calls, a, armPolicy(p.base, p.floor, p.min), st.activatedAt);
      const side = d.side;
      const q = side ? exactSideQuote(snap, side) : null;
      const ask = q?.exactAsk ?? NaN;
      const bid = q?.exactBid ?? NaN;
      const size = q?.exactSize ?? NaN;
      const payload = {
        released: unmuted.released, missing: unmuted.missing,
        vector: d.vector.checks.map((k) => ({ id: k.id, pass: k.pass })),
        binding: d.vector.binding_reason, families_ok: d.familiesOk, secs_left: secs,
        hittability: "UNKNOWN at 2s poll",
        qualification_ask_cents: q?.decisionAsk ?? null,
        exact_ask_cents: q?.exactAsk ?? null,
        price_lane: "exact_measurement",
      };
      if (d.eligible && side) once(receipt(E1, p.arm, snap, "intention", side, ask, size, ask - bid, true, "first eligible tick"), payload);
      const filled = d.eligible && d.confirmed && side != null;
      if (filled) once(receipt(E1, p.arm, snap, "fill", side, ask, size, ask - bid, true, "confirmed"), { ...payload, execution_qualified: true });
      if (p.arm === "PKG_85" && side) pkg85 = { side, ask, size, spread: ask - bid, filled, intent: d.eligible };
    }

    // E2 and E3 derive from the PKG_85 stream on the same tick.
    if (pkg85) {
      const base = pkg85;
      once(receipt(E2, "BASE_NO_VETO", snap, base.filled ? "fill" : "intention", base.side, base.ask, base.size, base.spread, true, "PKG_85 stream"), { secs_left: secs });
      for (const [arm, cooldown] of [["VETO_8S", JUMP_VETO.primary_cooldown_ms], ["VETO_15S", 15_000], ["VETO_30S", 30_000]] as const) {
        if (vetoActive(st.jump, snap.as_of, cooldown)) once(receipt(E2, arm, snap, "veto", base.side, base.ask, base.size, base.spread, true, `shock ${st.jump.last_shock_cents}¢ on ${st.jump.last_shock_side} at ${st.jump.last_shock_ms}`), { cooldown_ms: cooldown, secs_left: secs, base_filled: base.filled });
        else if (base.filled) once(receipt(E2, arm, snap, "fill", base.side, base.ask, base.size, base.spread, true, "PKG_85 fill, no active cooldown"), { cooldown_ms: cooldown, secs_left: secs, execution_qualified: true });
      }
      once(receipt(E3, "BASIS_LIVE_2BPS", snap, base.filled ? "fill" : "intention", base.side, base.ask, base.size, base.spread, true, "PKG_85 stream"), { secs_left: secs, basis_bps: 2 });
      for (const bps of [5, 7, 9]) {
        const arm = `BASIS_${bps}BPS`;
        const edge = edgeUnderBasis(snap, base.side, bps);
        if (base.filled && edge >= 3) once(receipt(E3, arm, snap, "fill", base.side, base.ask, base.size, base.spread, true, `edge ${edge.toFixed(1)}¢ at ${bps}bps`), { basis_bps: bps, edge_cents: edge, execution_qualified: true, secs_left: secs });
        else if (base.filled) once(receipt(E3, arm, snap, "no_fill", base.side, base.ask, base.size, base.spread, true, `edge ${edge.toFixed(1)}¢ at ${bps}bps blocks`), { basis_bps: bps, edge_cents: edge, secs_left: secs });
      }
    }
    await Promise.all(writes);
    if (writes.length) st.lastCapture = now;
    st.error = null;
  } catch (error) {
    st.error = error instanceof Error ? error.message : String(error);
  } finally {
    st.busy = false;
  }
}

/**
 * Start only after the manifest boundary is durably established. A database or
 * manifest inconsistency leaves the observer dark; collection never starts
 * before the prospective timestamp exists.
 */
export function ensureShadowLabObserver(env: Record<string, string | undefined> = process.env): "started" | "already" | "disabled" {
  if (!shadowLabEnabled(env)) return "disabled";
  const st = state();
  if (st.timer || st.starting) return "already";
  st.starting = true;

  void getSql()
    .then(async (sql) => {
      await registerShadowManifests(sql);
      await verifyShadowManifests(sql);
      // Stamp only after the exact frozen specimens are verified. On restart,
      // activateInitialShadowCollection returns the original durable boundary.
      const activation = await activateInitialShadowCollection(sql, Date.now());
      const durableStart = Date.parse(activation.started_at[0] ?? "");
      if (!Number.isFinite(durableStart) || durableStart <= 0) throw new Error("shadow activation returned an invalid durable boundary");
      st.activatedAt = durableStart;
      // The env may have been removed while the bootstrap was in flight.
      if (!shadowLabEnabled(process.env)) return;
      st.timer = setInterval(() => void shadowLabTick(), SHADOW_LAB_POLL_MS);
      void shadowLabTick();
      st.error = null;
    })
    .catch((error) => {
      st.error = error instanceof Error ? error.message : String(error);
    })
    .finally(() => {
      st.starting = false;
    });
  return "started";
}

export function shadowLabHealth(): { enabled: boolean; starting: boolean; running: boolean; last_capture: number | null; error: string | null } {
  const st = globalRef.__shadowLab__;
  return { enabled: shadowLabEnabled(), starting: !!st?.starting, running: !!st?.timer, last_capture: st?.lastCapture ?? null, error: st?.error ?? null };
}
