# REACHABILITY-A — current-state reachability harness

Research diagnostic, authority **NONE**. Answers: *can the current production
state book a qualified paper call, and what blocks the recorded frames?*

## What it runs

`scripts/reachability-harness.mjs` restores a `desk_state.state` blob through the
production `loadState` (in-memory PGlite), then replays recorded Snapshots
through the functions `tick` runs, in `tick`'s order (pinned by a rail test):

```
runBots → stickyVotes → onLean → decideChair (runChair + softenTimeGates + stickLean)
→ noteUnfilteredCall → applyEntryMode (selectiveChair) → onLean(CHAIR) → noteCall
```

`noteCall` applies the edge guard, team guard, `selectiveBookOk` (supporters,
families, opposition, 3–10 min band, feeds, 80¢ ask/spread/size, model and
settlement-index edge, 3-frame/8-s confirmation) and the 80¢ floor, exactly as
production. Per frame it reports raw / heard / eligible supporters, the best
reachable quorum, the full `gateVector` (deployed policy), and a funnel stage.

It never grades or teaches the learner, never changes settings, bars, cards or
thresholds, and never manufactures a vote. It refuses a nonempty
`DATABASE_URL` before Vite or SQL start.

## Evidence classes and verdicts (fail closed)

Every report carries `evidence_class`, `verdict` and a separate `mechanical` result.

* `CURRENT_STATE` — only when `mode: "current_state"` AND all of: `source.kind`
  `desk_state_row`; `risk_provenance: "primary_desk_state"` with the persisted
  `risk_calls` array and `risk_history_valid: true`; actual `settings`
  (`adaptive_bar`, `bar_override`, `mutes`); a 40-hex `source.build_sha`; the
  active `selective_policy` and its `selective_start`. Any gap is listed as
  `UNRECONSTRUCTABLE …` and the class becomes `MECHANICAL_ONLY`.
* `MECHANICAL_ONLY` / `SYNTHETIC` — the real functions ran, but no current-state
  claim is made: `verdict` is `UNDETERMINED` (current_state requested) or
  `NOT_APPLICABLE` (mechanical/synthetic).

Current-state `verdict`:

* `REACHABLE` — a replayed frame booked through the real `noteCall` AND its
  window is witness-eligible up to that frame: no identity-rejected frame for
  that close time; state fidelity (first window, or a supplied
  `window_states[key]`); coverage from before the entry band; no gap over 10 s;
  every frame `build_sha` equal to `source.build_sha`; every frame carrying
  recorded production votes and Chair with zero replay mismatch.
* `STRUCTURALLY_BLOCKED` — no admissible seat/family coalition in any observed regime.
* `UNDETERMINED` — anything else, with the reasons. A booking in a DIAGNOSTIC
  window is reported under `mechanical.booking`, never as `witness`.

In current-state mode nothing is substituted (a missing `selective_start` keeps
production's boot default, which refuses recorded windows). Only
`mode: "mechanical"` may admit windows from the first frame, and says so.

Identity: a frame whose ticker's embedded close disagrees with `close_time`
(e.g. a stale-rollover pairing), whose close is off the 15-minute grid, or whose
`as_of` is not before close is never replayed and marks that close time
identity-incomplete. Windows after the first are DIAGNOSTIC unless a per-window
primary state is supplied, because the harness never grades the learner.

Mechanical reachability and economic edge are separate: a witness is not a
profitability result.

## Input (`REACHABILITY_A_INPUT_V2`)

```json
{
  "schema": "REACHABILITY_A_INPUT_V2",
  "mode": "current_state | mechanical",
  "risk_provenance": "primary_desk_state | unavailable",
  "source": { "kind": "desk_state_row | public_frame_poll | synthetic | other", "captured_at": "ISO", "build_sha": "40-hex", "note": "" },
  "state": { "learner": {}, "settings": { "adaptive_bar": true, "bar_override": null, "mutes": [] }, "risk_calls": [],
             "risk_history_valid": true, "call_log": [], "selective_start": 0, "selective_policy": "ENTRY_SELECTIVE_V3" },
  "frames": [ { "snap": { "...": "full Snapshot" }, "votes": ["recorded production votes"], "chair": { "lean": "WAIT" }, "build_sha": "40-hex" } ],
  "window_states": { "KXBTC15M-…|<close_ms>": { "...": "desk_state.state at that window's open (optional)" } }
}
```

Missing shape fields → exit 2 with an explicit list; no verdict is printed.

## Commands

```bash
# 1. capture (public /frame, no credentials). Current-state claims need --state (primary export) and --build-sha.
node scripts/reachability-capture.mjs --out input.json --samples 300 --interval-ms 3000 \
  [--state desk_state_state.json] [--build-sha <deployed sha>]
# 2. replay (never with DATABASE_URL set)
env -u DATABASE_URL node scripts/reachability-harness.mjs --input input.json --out report.json
# tests
node --test scripts/reachability-harness.test.mjs
```

## Known limits

* `/frame` does not publish `risk_calls` or the build; without `--state` the
  capture records risk history as unavailable (`risk_calls: null`) and the run is
  MECHANICAL_ONLY. `--build-sha` is operator-asserted and must not span a deploy.
* The `/frame` learner is post-tick. Replay starts from it; the parity block
  (recorded vs replayed votes and Chair lean) shows any drift.
* Window rollover resets only the per-window entry memory; the learner is not
  graded between windows, so multi-hour replays drift from production learning.
