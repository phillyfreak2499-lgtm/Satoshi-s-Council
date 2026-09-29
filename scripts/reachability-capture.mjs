#!/usr/bin/env node
/**
 * REACHABILITY-A input capture from the PUBLIC `/frame` feed (no credentials,
 * read-only GETs). Each `/frame` carries the exact Snapshot the last tick used
 * (`snap`), the production sticky votes, the post-entry-mode Chair, and the
 * learner (`sliceLearner`: only settle_tape/huddle_log are truncated), so a
 * contiguous poll is a valid recorded input sequence WITH production outputs for
 * parity checking.
 *
 *   node scripts/reachability-capture.mjs --out input.json \
 *     [--base https://satoshiscouncil.com] [--samples 300] [--interval-ms 3000] \
 *     [--state desk_state_state.json] [--build-sha <sha>]
 *
 * `/frame` does not publish risk_calls or the deployed build. Without `--state`
 * (a primary desk_state.state export) risk history is recorded as UNAVAILABLE
 * (risk_calls: null), and the harness will not issue a current-state verdict.
 * `--build-sha` is operator-asserted from deploy evidence: it is stamped on every
 * frame, so the capture must not span a deploy.
 */
import { readFile, writeFile } from "node:fs/promises";

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const base = String(arg("--base", "https://satoshiscouncil.com")).replace(/\/$/, "");
const samples = Math.max(1, Number(arg("--samples", "300")));
const interval = Math.max(1000, Number(arg("--interval-ms", "3000")));
const out = arg("--out");
const statePath = arg("--state");
const buildSha = arg("--build-sha", null);
if (!out) { console.error("usage: node scripts/reachability-capture.mjs --out input.json [--samples N] [--interval-ms MS] [--state state.json]"); process.exit(2); }

const frames = [];
let first = null;
let lastAsOf = -1;
for (let i = 0; i < samples; i++) {
  try {
    const res = await fetch(`${base}/frame`, { headers: { accept: "application/json" }, cache: "no-store" });
    if (res.ok) {
      const f = await res.json();
      if (f?.snap && Number.isFinite(f.snap.as_of) && f.snap.as_of > lastAsOf && !f.snap.demo) {
        lastAsOf = f.snap.as_of;
        first ??= f;
        frames.push({ snap: f.snap, votes: f.votes ?? null, chair: f.chair ? { lean: f.chair.lean } : null, build_sha: buildSha });
      }
    } else console.error(`frame ${i}: HTTP ${res.status}`);
  } catch (err) { console.error(`frame ${i}: ${err instanceof Error ? err.message : err}`); }
  if (i < samples - 1) await new Promise((r) => setTimeout(r, interval));
}
if (!first) { console.error("no usable frames captured"); process.exit(2); }

let state;
let kind;
let riskProvenance;
if (statePath) {
  state = JSON.parse(await readFile(statePath, "utf8"));
  kind = "desk_state_row";
  riskProvenance = Array.isArray(state.risk_calls) ? "primary_desk_state" : "unavailable";
} else {
  kind = "public_frame_poll";
  riskProvenance = "unavailable";
  state = {
    // /frame has no risk_calls: record the absence, never an empty history.
    learner: first.learner, settings: first.settings, call_log: first.call_log ?? [], risk_calls: null,
    risk_history_valid: null,
    selective_start: first.selective?.start, selective_policy: first.selective?.policy,
  };
}
const input = {
  schema: "REACHABILITY_A_INPUT_V2",
  mode: kind === "desk_state_row" ? "current_state" : "mechanical",
  risk_provenance: riskProvenance,
  source: {
    kind, captured_at: new Date().toISOString(), build_sha: buildSha,
    note: `${frames.length} distinct /frame snapshots from ${base}` + (statePath ? "; state from primary export" : "; state from the first /frame; risk history UNAVAILABLE") +
      (buildSha ? "; build_sha operator-asserted" : "; no build_sha"),
  },
  state,
  frames,
};
await writeFile(out, JSON.stringify(input));
console.log(`wrote ${out}: ${frames.length} frames, ${new Set(frames.map((f) => `${f.snap.ticker}|${f.snap.close_time}`)).size} window(s)`);
