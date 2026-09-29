#!/usr/bin/env node
/**
 * REACHABILITY-A harness — can the current production state book a qualified
 * paper call, and what blocks the recorded frames?
 *
 * Research diagnostic only (authority: NONE). It restores a desk_state row
 * through the production `loadState`, then replays recorded Snapshots through
 * the exact functions `tick` runs, in tick's order:
 *
 *   runBots → stickyVotes → onLean → decideChair(runChair + time gates + stick)
 *   → noteUnfilteredCall → applyEntryMode(selectiveChair) → onLean(CHAIR)
 *   → noteCall(edge/team/selective/confirmation/80¢ floor → risk_calls)
 *
 * Safety: refuses a nonempty DATABASE_URL before Vite or SQL start, so every
 * persistState lands in the process-local in-memory PGlite. It never grades or
 * teaches the learner, never changes settings/bars/cards, and never
 * manufactures a vote: every vote comes from runBots on a recorded Snapshot.
 *
 * Usage:
 *   node scripts/reachability-harness.mjs --input input.json [--out report.json]
 * Input schema: REACHABILITY_A_INPUT_V2 (see src/lib/desk/reachability.ts and
 * docs/REACHABILITY_A.md). Exit codes: 0 report written; 2 missing inputs
 * (explicit diagnostics printed); 3 refused unsafe environment.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export function refuseProductionDatabase(env = process.env) {
  const url = env.DATABASE_URL;
  if (typeof url === "string" && url.trim()) {
    throw new Error("reachability harness refuses nonempty DATABASE_URL before Vite or database startup");
  }
}

refuseProductionDatabase();

const winKey = (s) => `${s.ticker}|${s.close_time}`;

export async function loadHarnessModules(vite) {
  const [tick, bots, scalp, reach, db, selective] = await Promise.all([
    vite.ssrLoadModule("/src/lib/desk/server-engine.ts"),
    vite.ssrLoadModule("/src/lib/desk/bots.ts"),
    vite.ssrLoadModule("/src/lib/desk/scalp.ts"),
    vite.ssrLoadModule("/src/lib/desk/reachability.ts"),
    vite.ssrLoadModule("/src/lib/db.ts"),
    vite.ssrLoadModule("/src/lib/desk/selective-entry.ts"),
  ]);
  if (db.dbSource !== "pglite") throw new Error(`reachability harness requires the disposable PGlite backend, got ${db.dbSource}`);
  return { T: tick.__tickIntegration, runBots: bots.runBots, onLean: scalp.onLean, CHAIR_SCALP: scalp.CHAIR_SCALP, reach, db, selective };
}

/** Write `state` as the desk_state row and run the production loadState on `e` (a fresh engine when omitted). */
async function loadStateInto(m, state, e = m.T.freshEng()) {
  const sql = await m.db.getSql();
  await sql`delete from desk_state where id = 'live'`;
  await sql`insert into desk_state (id, state) values ('live', ${JSON.stringify(state)}::jsonb)`;
  e.lastError = null;
  await m.T.loadState(e);
  if (e.lastError) throw new Error(`loadState failed: ${e.lastError}`);
  return e;
}

/**
 * Replay recorded frames. In current_state mode nothing is substituted: a missing
 * selective_start/policy leaves production's boot default, which refuses every
 * recorded window (fail closed). Only an explicit mechanical/synthetic run may
 * admit windows from the first frame, and that substitution is reported.
 */
export async function runReachability(input, vite, opts = {}) {
  const m = await loadHarnessModules(vite);
  const check = m.reach.validateReachabilityInput(input);
  if (!check.ok) return { status: "MISSING_INPUTS", missing: check.missing, warnings: check.warnings };
  const prov = m.reach.assessProvenance(input);
  const frames = input.frames ?? [];
  const stateBefore = JSON.stringify(input.state);
  const notes = [];
  const e = await loadStateInto(m, input.state);
  const learnerAtLoad = JSON.stringify(e.learner);
  const firstValid = frames.find((f) => m.reach.frameIdentity(f.snap).ok)?.snap ?? null;
  if (!(Number.isFinite(input.state.selective_start) && input.state.selective_policy)) {
    if (input.mode === "mechanical" && firstValid) {
      e.selectiveStart = firstValid.close_time - 900_000;
      notes.push("MECHANICAL substitution: selective_start/policy absent, windows admitted from the first valid frame");
    } else {
      notes.push("selective_start/policy absent: production boot default kept (fails closed for recorded windows)");
    }
  }

  const frameRegimes = [...new Set(frames.map((f) => f.snap.regime_key).filter(Boolean))];
  const asOf = frames[0]?.snap.as_of ?? Date.parse(input.source.captured_at);
  const structural = m.reach.structuralReachability(e.learner, e.settings, { asOf, regimes: frameRegimes });

  // Close times touched by an identity-rejected frame are incomplete for every ticker claiming them.
  const rejectedByClose = new Map();
  for (const f of frames) {
    const id = m.reach.frameIdentity(f.snap);
    if (id.ok) continue;
    const list = rejectedByClose.get(f.snap.close_time) ?? [];
    list.push({ as_of: f.snap.as_of, ticker: f.snap.ticker, close_time: f.snap.close_time, reason: id.reason });
    rejectedByClose.set(f.snap.close_time, list);
  }

  const results = [];
  const windows = new Map();
  let lastKey = "";
  let windowIndex = -1;
  for (const f of frames) {
    if (!m.reach.frameIdentity(f.snap).ok) continue; // never replayed; recorded under its close_time
    const snap = structuredClone(f.snap);
    const key = winKey(snap);
    if (key !== lastKey) {
      windowIndex += 1;
      let fidelity = windowIndex === 0 ? "initial_state" : "none";
      if (lastKey) {
        const ws = input.window_states?.[key];
        if (ws) { await loadStateInto(m, ws, e); fidelity = "window_state"; }
        else {
          // Rollover without grading: reset only the per-window entry memory settle would reset.
          const wm0 = e.learner.window_memory;
          wm0.entry_spot = 0; wm0.path_since_entry = []; wm0.entry_lean = null;
        }
      }
      windows.set(key, { key, ticker: snap.ticker, close_time: snap.close_time, frames_replayed: 0,
        identity_rejected: rejectedByClose.get(snap.close_time) ?? [], state_fidelity: fidelity,
        first_secs_left: (snap.close_time - snap.as_of) / 1000, max_gap_ms: 0, last_as_of: null,
        build_mismatch_frames: 0, parity_checked_frames: 0, parity_missing_frames: 0, parity_mismatch_frames: 0, witness_seen: false });
    }
    lastKey = key;
    const w = windows.get(key);
    // --- tick() decision order, verbatim ---
    const wm = e.learner.window_memory;
    if (!wm.entry_spot) wm.entry_spot = snap.spot;
    wm.path_since_entry = [...wm.path_since_entry, snap.spot - wm.entry_spot].slice(-120);
    const votes = m.T.stickyVotes(e, m.runBots(snap, e.learner), snap);
    for (const v of votes) { if (v.seat !== "WARDEN") m.onLean(e.learner, v.seat, v.lean, snap); }
    const rawChair = m.T.decideChair(e, votes, snap, m.T.lastSide(e, snap));
    m.T.noteUnfilteredCall(e, snap, rawChair);
    const chair = m.T.applyEntryMode(e, snap, rawChair);
    m.onLean(e.learner, m.CHAIR_SCALP, chair.lean, snap);
    const ctx = { calls: e.riskCalls, ready: e.riskReady, start: e.selectiveStart, watch: e.entryWatch };
    const bookedBefore = m.selective.hasPaperPosition(e.riskCalls, snap);
    await m.T.noteCall(e, snap, chair, votes);
    const bookedAfter = m.selective.hasPaperPosition(e.riskCalls, snap);
    if (!wm.entry_lean && chair.lean !== "WAIT") wm.entry_lean = chair.lean;
    e.prevSnap = snap; e.lastVotes = votes; e.lastChair = chair;
    // --- end tick order ---
    const r = m.reach.classifyReplayFrame({ snap, votes, rawChair, chair, ctx, bookedBefore, bookedAfter,
      recorded: f.votes || f.chair ? { votes: f.votes ?? null, chair: f.chair ?? null } : null });
    // Window evidence accumulates only up to and including the first booking (the witness).
    if (!w.witness_seen) {
      w.frames_replayed += 1;
      if (w.last_as_of != null) w.max_gap_ms = Math.max(w.max_gap_ms, snap.as_of - w.last_as_of);
      w.last_as_of = snap.as_of;
      if (!f.build_sha || String(f.build_sha).toLowerCase() !== String(input.source.build_sha ?? "").toLowerCase()) w.build_mismatch_frames += 1;
      if (!f.votes || !f.chair) w.parity_missing_frames += 1;
      else {
        w.parity_checked_frames += 1;
        if (r.parity && (r.parity.vote_lean_mismatch.length || r.parity.chair_lean_match === false)) w.parity_mismatch_frames += 1;
      }
      if (r.booked_now) w.witness_seen = true;
    }
    r.window_key = key;
    if (opts.includeReplayOutputs) { r.replay_votes = votes; r.replay_chair = { lean: chair.lean }; }
    results.push(r);
  }

  const windowEvidence = [...windows.values()].map(({ last_as_of, witness_seen, ...w }) => {
    void last_as_of; void witness_seen;
    return { ...w, diagnostic_reasons: m.reach.judgeWindow(w, prov, input.source.build_sha) };
  });
  const byKey = new Map(windowEvidence.map((w) => [w.key, w]));
  for (const r of results) r.window_class = byKey.get(r.window_key)?.diagnostic_reasons.length ? "DIAGNOSTIC" : "CURRENT_STATE_ELIGIBLE";

  const summary = summarize(results);
  const regimesSeen = frameRegimes.length ? frameRegimes : [e.learner.last_regime].filter(Boolean);
  const byRegime = new Map(structural.regimes.map((r) => [r.regime, r]));
  const tight = frames.length ? m.selective.dailyAdmission(e.riskCalls, frames[0].snap.as_of).tightened : false;
  const structurallyBlocked = regimesSeen.length > 0 && regimesSeen.every((k) => {
    const r = byRegime.get(k);
    return r ? !(tight ? r.tight.possible : r.normal.possible) : false;
  });
  const bookings = results.filter((r) => r.booked_now);
  const booking = bookings[0] ?? null;
  const witnessBooking = prov.current_state_ok
    ? bookings.find((r) => byKey.get(r.window_key)?.diagnostic_reasons.length === 0) ?? null
    : null;
  const witnessWindow = witnessBooking ? byKey.get(witnessBooking.window_key) : null;
  const currentWitness = !!witnessBooking && !!witnessWindow;

  let verdict;
  let basis;
  if (prov.evidence_class === "SYNTHETIC" || input.mode === "mechanical") {
    verdict = "NOT_APPLICABLE";
    basis = `${prov.evidence_class} run: no current-state verdict is issued`;
  } else if (!prov.current_state_ok) {
    verdict = "UNDETERMINED";
    basis = `UNRECONSTRUCTABLE current-state context: ${prov.failures.join("; ")}`;
  } else if (currentWitness) {
    verdict = "REACHABLE";
    basis = `booked on ${witnessBooking.ticker} at ${new Date(witnessBooking.as_of).toISOString()} through the real noteCall; same-build, parity-clean, contiguous frames`;
  } else if (booking) {
    const diagnosticWindow = byKey.get(booking.window_key);
    verdict = "UNDETERMINED";
    basis = `replay booked on ${booking.ticker} but the window is DIAGNOSTIC: ${diagnosticWindow?.diagnostic_reasons.join("; ")}`;
  } else if (structurallyBlocked) {
    verdict = "STRUCTURALLY_BLOCKED";
    basis = `no seat/family combination can meet ${tight ? "tight" : "normal"} admission in regime(s) ${regimesSeen.join(", ")}`;
  } else {
    verdict = "UNDETERMINED";
    basis = frames.length
      ? `no booking witness in ${summary.windows} observed window(s); structural analysis leaves at least one admissible coalition`
      : "no frames supplied; structural analysis leaves at least one admissible coalition";
  }

  return {
    status: "OK",
    version: m.reach.REACHABILITY_VERSION,
    evidence_class: prov.evidence_class,
    verdict,
    verdict_basis: basis,
    witness: currentWitness ? witnessBooking : null,
    mechanical: {
      result: booking ? "BOOKED" : structurallyBlocked ? "STRUCTURALLY_BLOCKED" : "NO_BOOKING",
      booking,
      note: "Mechanical result of the real functions on the supplied inputs; not a current-state claim unless verdict says so.",
    },
    provenance: prov,
    source: input.source,
    input_warnings: check.warnings,
    harness_notes: [...notes,
      "learner is never graded or taught; window rollover resets only entry_spot/path_since_entry/entry_lean unless a per-window primary state is supplied",
      "persistence is the process-local in-memory PGlite; no production database connection is possible"],
    integrity: {
      input_state_unchanged: JSON.stringify(input.state) === stateBefore,
      learner_changed_only_in_memory: JSON.stringify(e.learner) !== learnerAtLoad,
    },
    mode_at_first_frame: tight ? "tight" : "normal",
    identity_rejected_frames: [...rejectedByClose.values()].flat(),
    windows: windowEvidence,
    structural,
    summary,
    frames: results,
  };
}

export function summarize(results) {
  const windows = new Map();
  for (const r of results) {
    const k = `${r.ticker}|${r.close_time}`;
    const w = windows.get(k) ?? { ticker: r.ticker, close_time: r.close_time, frames: 0, in_band_frames: 0, stages: {}, booked: false };
    w.frames += 1;
    if (r.stage !== "outside_band") w.in_band_frames += 1;
    w.stages[r.stage] = (w.stages[r.stage] ?? 0) + 1;
    if (r.booked_now) w.booked = true;
    windows.set(k, w);
  }
  const inBand = results.filter((r) => r.stage !== "outside_band");
  const count = (arr, f) => arr.reduce((acc, x) => { for (const k of f(x)) acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});
  const combos = count(inBand.filter((r) => r.gate_vector.side), (r) => [r.gate_vector.failed.slice().sort().join("+") || "none"]);
  const parity = results.filter((r) => r.parity);
  return {
    windows: windows.size,
    frames: results.length,
    in_band_frames: inBand.length,
    stage_counts: count(results, (r) => [r.stage]),
    in_band_raw_directional_frames: inBand.filter((r) => r.raw_directional.length).length,
    in_band_heard_frames: inBand.filter((r) => r.heard_directional.length).length,
    in_band_quorum_reachable_frames: inBand.filter((r) => r.best_quorum.reachable).length,
    in_band_chair_directional_frames: inBand.filter((r) => r.chair_lean === "UP" || r.chair_lean === "DOWN").length,
    in_band_raw_by_seat: count(inBand, (r) => r.raw_directional.map((d) => `${d.seat}:${d.card}`)),
    in_band_forced_sit_reasons: count(inBand, (r) => Object.entries(r.forced_sit_reasons).map(([s, why]) => `${s}: ${why}`)),
    in_band_side_blocker_sets: combos,
    in_band_wait_side_unknown: inBand.filter((r) => !r.gate_vector.side).length,
    booked_windows: [...windows.values()].filter((w) => w.booked).length,
    parity: parity.length ? {
      frames: parity.length,
      chair_lean_mismatch: parity.filter((r) => r.parity.chair_lean_match === false).length,
      frames_with_vote_mismatch: parity.filter((r) => r.parity.vote_lean_mismatch.length).length,
      first_mismatches: parity.flatMap((r) => r.parity.vote_lean_mismatch.map((x) => `${new Date(r.as_of).toISOString()} ${x}`)).slice(0, 20),
    } : null,
    per_window: [...windows.values()],
  };
}

async function main(argv) {
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const inPath = arg("--input");
  const outPath = arg("--out");
  if (!inPath) { console.error("usage: node scripts/reachability-harness.mjs --input input.json [--out report.json]"); return 2; }
  const input = JSON.parse(await readFile(inPath, "utf8"));
  const { createServer } = await import("vite");
  const vite = await createServer({ envDir: false, logLevel: "error", server: { middlewareMode: true }, appType: "custom" });
  try {
    const report = await runReachability(input, vite);
    const text = JSON.stringify(report, null, 2);
    if (outPath) await writeFile(outPath, text);
    if (report.status === "MISSING_INPUTS") {
      console.error("UNDETERMINED — missing inputs:\n  " + report.missing.join("\n  "));
      if (report.warnings.length) console.error("warnings:\n  " + report.warnings.join("\n  "));
      return 2;
    }
    console.log(`[${report.evidence_class}] ${report.verdict} — ${report.verdict_basis}`);
    console.log(`mechanical: ${report.mechanical.result}`);
    console.log(JSON.stringify({ summary: { ...report.summary, per_window: undefined }, regimes: report.structural.regimes.map((r) => ({ regime: r.regime, verdict: r.verdict, supporters: r.supporters_possible, families: r.families_possible })) }, null, 2));
    return 0;
  } finally {
    await vite.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (err) => { console.error(err); process.exit(3); });
}
