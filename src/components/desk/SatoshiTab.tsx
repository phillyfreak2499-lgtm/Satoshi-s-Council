import type { CallLogRow, ChairResult, Lean, SeatId, Settings, Snapshot } from "@/lib/desk/types";
import { clearCallLog } from "@/lib/desk/engine";
import { cn } from "@/lib/utils";
import { Field, LeanChip, MarketChip, MinsLeft, Mono, Pane, StatusChip } from "./bits";
import { V2_MIN_SAMPLES } from "@/lib/desk/chair-v2";
import type { V2Frame } from "@/lib/desk/server-engine";
import { ChairEyes } from "./Eyes";
import { Tip } from "./Tip";
import { readMarket } from "@/lib/desk/market-hours";
import { FULL_N } from "@/lib/desk/math";

function sideAsk(snap: Snapshot, lean: Lean) {
  if (lean === "UP") return snap.yes_ask || snap.yes_mid;
  if (lean === "DOWN") return snap.no_ask || 100 - (snap.yes_mid || 50);
  return snap.yes_mid;
}

function fmtClock(t: number, tz: string) {
  try {
    return new Date(t).toLocaleTimeString("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return new Date(t).toISOString().slice(11, 19);
  }
}

function ChairBoard({ snap, chair, tz }: { snap: Snapshot; chair: ChairResult; tz: string }) {
  const lean = chair.lean;
  const fill = Math.min(1, Math.abs(chair.score) / Math.max(chair.bar, 0.01));
  const ask = sideAsk(snap, lean);
  const tone = lean === "UP" ? "text-up" : lean === "DOWN" ? "text-down" : "text-wait";
  const barTone = lean === "UP" ? "bg-up" : lean === "DOWN" ? "bg-down" : "bg-wait";
  const edge = lean === "UP" ? snap.edge_up : lean === "DOWN" ? snap.edge_down : 0;
  const market = readMarket(snap.as_of, snap.close_time);
  return (
    <section
      data-tour="tour-satoshi"
      className="rounded-md border border-border bg-surface p-3 sm:p-4"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-micro uppercase tracking-widest text-subtle">
            <Tip k="pane.board">Chair call</Tip>
          </div>
          <div className={cn("font-sans text-hero font-medium leading-none tracking-tight", tone)}>
            {lean === "WAIT" ? "WAIT" : `${lean} ${ask.toFixed(0)}¢`}
          </div>
          <div className="mt-2 font-mono text-ui text-muted">
            {lean === "WAIT" ? (
              "no paper fill"
            ) : (
              <>
                {lean === "UP" ? "YES" : "NO"} ask {ask.toFixed(1)}¢
                {edge ? ` · leftover ${edge >= 0 ? "+" : ""}${edge.toFixed(1)}¢` : ""}
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <div className="font-mono text-micro uppercase tracking-widest text-subtle">
              <Tip k="strip.conf">conf</Tip>
            </div>
            <div className="font-mono text-call tabular leading-none">
              {chair.confidence}
              <span className="text-ui text-subtle"> conf</span>
            </div>
          </div>
          <div>
            <div className="font-mono text-micro uppercase tracking-widest text-subtle">
              <Tip k="strip.size">size</Tip>
            </div>
            <div className="font-mono text-call tabular leading-none">{chair.size}</div>
          </div>
          <div>
            <div className="font-mono text-micro uppercase tracking-widest text-subtle">clock</div>
            <div className="font-mono text-call tabular leading-none">
              <MinsLeft closeTime={snap.close_time} />
            </div>
          </div>
        </div>
      </div>
      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between font-mono text-micro text-subtle">
          <Tip k="strip.score">score vs bar</Tip>
          <span className="tabular">
            {chair.score >= 0 ? "+" : ""}
            {chair.score.toFixed(3)} / {chair.bar.toFixed(2)}
          </span>
        </div>
        <div className="relative h-3 w-full overflow-hidden rounded-sm bg-surface-3">
          <div className="absolute inset-y-0 left-1/2 w-px bg-border-strong" />
          <div
            className={cn("absolute inset-y-0 transition-all duration-500 ease-out", barTone)}
            style={
              chair.score >= 0
                ? { left: "50%", width: `${fill * 50}%` }
                : { right: "50%", width: `${fill * 50}%` }
            }
          />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-micro text-muted">
        <span>YES {snap.yes_ask.toFixed(1)}¢ ask</span>
        <span>NO {snap.no_ask.toFixed(1)}¢ ask</span>
        <span>spot {snap.spot.toFixed(0)}</span>
        <span>K {snap.strike.toFixed(0)}</span>
        <span className="truncate">{snap.ticker}</span>
      </div>
      <div className="mt-2 border-t border-border pt-2">
        <MarketChip m={market} tz={tz} />
      </div>
    </section>
  );
}

function CallTape({ rows, tz }: { rows: CallLogRow[]; tz: string }) {
  const entries = rows.map((r) => r.cents);
  const pnls = rows.filter((r) => r.settle != null).map((r) => (r.settle as number) - r.cents);
  const avgIn = entries.length ? entries.reduce((s, x) => s + x, 0) / entries.length : null;
  const avgPnl = pnls.length ? pnls.reduce((s, x) => s + x, 0) / pnls.length : null;
  return (
    <section className="rounded-md border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h3 className="font-mono text-micro uppercase tracking-widest text-subtle">
          <Tip k="pane.call-log">Call log</Tip>
        </h3>
        <div className="flex flex-wrap items-center gap-3 font-mono text-micro">
          <span className="text-muted">
            avg in {avgIn == null ? "—" : `${avgIn.toFixed(1)}¢`}
          </span>
          <span className={avgPnl == null ? "text-muted" : avgPnl >= 0 ? "text-up" : "text-down"}>
            avg ¢ {avgPnl == null ? "—" : `${avgPnl >= 0 ? "+" : ""}${avgPnl.toFixed(1)}¢`}
          </span>
          <span className="text-subtle">{rows.length} prints</span>
          <button
            type="button"
            onClick={() => clearCallLog()}
            className="min-h-11 rounded-sm border border-border px-3 py-1.5 text-muted hover:bg-surface-2 hover:text-fg sm:min-h-0"
          >
            Clear
          </button>
        </div>
      </div>
      {!rows.length ? (
        <div className="px-3 py-4 font-mono text-ui text-muted">
          No directional call yet. WAIT does not buy. A flip sells the last buy at that side’s current cents. Window end is 100 or 0 vs the last buy.
        </div>
      ) : (
        <div className="max-h-56 overflow-auto">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-surface-2 font-mono text-micro uppercase tracking-wider text-subtle">
              <tr>
                <th className="px-3 py-1.5 font-medium">time</th>
                <th className="px-3 py-1.5 font-medium">call</th>
                <th className="px-3 py-1.5 font-medium">ask</th>
                <th className="px-3 py-1.5 font-medium">end</th>
                <th className="px-3 py-1.5 font-medium">¢</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pnl = r.settle != null ? r.settle - r.cents : null;
                return (
                  <tr key={r.id} className="border-t border-border">
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-micro tabular text-muted">
                      {fmtClock(r.t, tz)}
                      {r.flipped ? <span className="ml-1 text-wait">flip</span> : null}
                    </td>
                    <td className="px-3 py-1.5">
                      <LeanChip lean={r.lean} cents={r.cents} />
                    </td>
                    <td
                      className={cn(
                        "px-3 py-1.5 font-mono text-data tabular",
                        r.lean === "UP" ? "text-up" : "text-down",
                      )}
                    >
                      {r.cents.toFixed(1)}¢
                    </td>
                    <td className="px-3 py-1.5 font-mono text-data tabular text-muted">
                      {r.settle == null ? "open" : `${r.settle}¢`}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-1.5 font-mono text-data tabular",
                        pnl == null ? "text-subtle" : pnl >= 0 ? "text-up" : "text-down",
                      )}
                    >
                      {pnl == null ? "—" : `${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}¢`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function fmtCents(n: number) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}¢`;
}

/** Chair v2 — the probability chair, running in shadow beside the live chair. */
function ShadowChair({ v2 }: { v2: V2Frame }) {
  const live = v2.live;
  const st = v2.stats;
  const learning = v2.weights_n < V2_MIN_SAMPLES;
  const tone =
    live?.lean === "UP" ? "text-up" : live?.lean === "DOWN" ? "text-down" : "text-wait";
  return (
    <section className="rounded-md border border-dashed border-border bg-surface p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-mono text-micro uppercase tracking-widest text-subtle">
          Chair v2 · shadow
        </div>
        <div className="font-mono text-micro text-subtle">
          {learning
            ? `learning the ledger · ${st?.n_graded ?? 0}/${V2_MIN_SAMPLES} windows before it calls`
            : `fit on ${v2.weights_n} windows`}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-x-6 gap-y-2">
        <div>
          <div className="font-mono text-micro text-subtle">P(UP)</div>
          <div className={cn("font-mono text-title tabular leading-none", tone)}>
            {live ? `${Math.round(live.p_up * 100)}%` : "—"}
          </div>
        </div>
        <div>
          <div className="font-mono text-micro text-subtle">shadow call</div>
          <div className={cn("font-mono text-title tabular leading-none", tone)}>
            {!live
              ? "—"
              : live.lean === "WAIT"
                ? "WAIT"
                : `${live.lean} ${(live.entry_cents ?? 0).toFixed(0)}¢`}
          </div>
          {live ? (
            <div className="mt-1 font-mono text-micro text-muted">
              edge {live.edge_cents == null ? "— (no book)" : `${fmtCents(live.edge_cents)} after fee`}
            </div>
          ) : null}
        </div>
        {st ? (
          <div className="font-mono text-micro text-muted">
            <div>
              v2 {st.calls_v2} calls · net {fmtCents(st.ev_v2)} &nbsp;|&nbsp; chair {st.calls_v1} calls · net{" "}
              {fmtCents(st.ev_v1)}
            </div>
            <div>
              Brier v2 {st.brier_v2 == null ? "—" : st.brier_v2.toFixed(3)} · market{" "}
              {st.brier_market == null ? "—" : st.brier_market.toFixed(3)} · {st.n_graded} graded windows
            </div>
          </div>
        ) : null}
      </div>
      {v2.top.length ? (
        <div className="mt-2 truncate font-mono text-micro text-subtle">
          weights · {v2.top.map(([k, w]) => `${k} ${w >= 0 ? "+" : ""}${w.toFixed(2)}`).join(" · ")}
        </div>
      ) : null}
      <p className="mt-2 font-mono text-micro text-subtle">
        Paper only. One probability learned from the ledger — every seat&apos;s honest read plus the
        market — trading only where it beats the ask by more than the fee. It competes with the chair on
        identical windows and is promoted only if it wins.
      </p>
    </section>
  );
}

export function SatoshiTab({
  snap,
  chair,
  settings,
  callLog,
  onJump,
  v2,
}: {
  snap: Snapshot;
  chair: ChairResult;
  settings: Settings;
  callLog: CallLogRow[];
  onJump: (seat: SeatId) => void;
  v2?: V2Frame | null;
}) {
  return (
    <div className="flex flex-col gap-3 p-3">
      <ChairBoard snap={snap} chair={chair} tz={settings.tz} />
      {v2 ? <ShadowChair v2={v2} /> : null}
      <ChairEyes snap={snap} />
      <CallTape rows={callLog} tz={settings.tz} />

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[72rem] text-left">
          <thead className="bg-surface-2 font-mono text-micro uppercase tracking-wider text-subtle">
            <tr>
              {(
                [
                  ["Rank", "col.rank"],
                  ["Avg ¢", "col.scalp"],
                  ["Cal", "col.calib"],
                  ["Calls", "field.calls"],
                  ["Seat", "col.seat"],
                  ["Callsign", "col.callsign"],
                  ["Lean", "col.lean"],
                  ["Conf", "col.conf"],
                  ["Skill used", "col.skill"],
                  ["Base w", "col.base"],
                  ["Listen", "col.listen"],
                  ["Health", "col.health"],
                  ["Signed", "col.signed"],
                  ["Contribution", "col.contrib"],
                  settings.show_shadow ? ["Shadow", "col.shadow"] : null,
                  ["Why", "col.why"],
                  ["Status", "col.status"],
                ] as ([string, string] | null)[]
              )
                .filter(Boolean)
                .map((h) => (
                  <th key={h![0]} className="whitespace-nowrap px-2 py-1.5 font-medium">
                    <Tip k={h![1]}>{h![0]}</Tip>
                  </th>
                ))}
            </tr>
          </thead>
          <tbody>
            {chair.rows.map((r) => {
              const maxC = Math.max(...chair.rows.map((x) => Math.abs(x.contribution)), 0.001);
              const pct = (Math.abs(r.contribution) / maxC) * 50;
              return (
                <tr
                  key={r.seat}
                  onClick={() => onJump(r.seat)}
                  className="cursor-pointer border-t border-border hover:bg-surface-2"
                >
                  <td className="px-2 py-1 font-mono text-data tabular text-muted">
                    {r.rank}
                    {r.wilson_rank !== r.contrib_rank && r.wilson_rank < 90 ? (
                      <span className="text-subtle"> · W{r.wilson_rank}</span>
                    ) : null}
                  </td>
                  <td
                    className={cn(
                      "px-2 py-1 font-mono text-data tabular",
                      r.scalp_avg == null ? "text-subtle" : r.scalp_avg >= 0 ? "text-up" : "text-down",
                    )}
                  >
                    {r.scalp_avg == null ? "—" : `${r.scalp_avg >= 0 ? "+" : ""}${r.scalp_avg.toFixed(1)}`}
                    {r.scalp_n ? <span className="text-subtle"> · {r.scalp_n}</span> : null}
                  </td>
                  <td className="px-2 py-1 font-mono text-data tabular text-muted">
                    {Math.round(r.calib * 100)}%
                    <span className="text-subtle">
                      {" "}
                      {r.calib_n}/{FULL_N}
                    </span>
                  </td>
                  <td className="px-2 py-1 font-mono text-data tabular text-fg">{r.calls}</td>
                  <td className="px-2 py-1 font-mono text-data text-fg">
                    <Tip k={`seat.${r.seat}`} mark={false}>
                      {r.seat}
                    </Tip>
                  </td>
                  <td className="px-2 py-1 font-mono text-data text-muted">{r.callsign}</td>
                  <td className="px-2 py-1">
                    <LeanChip lean={r.lean} cents={sideAsk(snap, r.lean)} />
                  </td>
                  <td className="px-2 py-1 font-mono text-data tabular">{r.conf}</td>
                  <td className="px-2 py-1 font-mono text-micro text-muted">{r.skill_used}</td>
                  <td className="px-2 py-1 font-mono text-micro tabular text-muted">
                    {r.base_w.toFixed(2)}
                  </td>
                  <td className="px-2 py-1 font-mono text-micro tabular text-muted">
                    {r.listen.toFixed(2)}
                  </td>
                  <td className="px-2 py-1 font-mono text-micro text-muted">{r.health}</td>
                  <td
                    className={cn(
                      "px-2 py-1 font-mono text-micro tabular",
                      r.signed > 0 ? "text-up" : r.signed < 0 ? "text-down" : "text-muted",
                    )}
                  >
                    {r.signed >= 0 ? "+" : ""}
                    {r.signed.toFixed(3)}
                  </td>
                  <td className="px-2 py-1">
                    <div className="flex items-center gap-2">
                      <div className="relative h-1.5 w-24 overflow-hidden rounded-sm bg-surface-3">
                        <div className="absolute inset-y-0 left-1/2 w-px bg-border-strong" />
                        <div
                          className={cn(
                            "absolute inset-y-0 transition-all duration-500 ease-out",
                            r.contribution >= 0 ? "bg-up" : "bg-down",
                          )}
                          style={
                            r.contribution >= 0
                              ? { left: "50%", width: `${pct}%` }
                              : { right: "50%", width: `${pct}%` }
                          }
                        />
                      </div>
                      <Mono
                        className={cn(
                          "text-micro",
                          r.contribution > 0 ? "text-up" : r.contribution < 0 ? "text-down" : "text-muted",
                        )}
                      >
                        {r.contribution >= 0 ? "+" : ""}
                        {r.contribution.toFixed(3)}
                      </Mono>
                    </div>
                  </td>
                  {settings.show_shadow && (
                    <td className="px-2 py-1">
                      {r.shadow_lean ? (
                        <LeanChip lean={r.shadow_lean} cents={sideAsk(snap, r.shadow_lean)} />
                      ) : (
                        <span className="text-subtle">—</span>
                      )}
                    </td>
                  )}
                  <td className="max-w-xs truncate px-2 py-1 font-sans text-ui text-muted" title={r.why}>
                    {r.why}
                  </td>
                  <td className="px-2 py-1">
                    <StatusChip s={r.status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Pane title={<Tip k="pane.score">Score math</Tip>}>
          <div className="space-y-1 font-mono text-data">
            <div>
              score = Σ(signed × w) / Σw_dir ={" "}
              <span className={chair.score >= 0 ? "text-up" : "text-down"}>
                {chair.score.toFixed(3)}
              </span>
            </div>
            <div>
              sit-mass {chair.sit_mass.toFixed(2)} → bar +{(0.2 * chair.sit_mass).toFixed(3)}
            </div>
            <div>
              conflict-frac {chair.conflict_frac.toFixed(2)} → ×
              {(1 - 0.7 * chair.conflict_frac).toFixed(3)}
            </div>
            <div>confluence bar {chair.bar.toFixed(2)} (floor 0.24 / ceil 0.72)</div>
            <div>aggressiveness ×{chair.aggressiveness.toFixed(2)}</div>
            <div>diversity ×{chair.diversity.toFixed(2)} ({chair.categories_agree} cats)</div>
            <div>fade / structure / tape {chair.fade_fold}</div>
            <div>
              size {chair.size} · {chair.size_note}
            </div>
            <div>invert cap {chair.invert_cap}</div>
            <div>LAW dimmer {chair.law_dimmer}</div>
            <div className={chair.tax_applied ? "text-wait" : "text-muted"}>
              calibration tax: {chair.tax}
            </div>
            <div>cousins {chair.knn_note}</div>
            <div>{chair.wait_note}</div>
            {chair.walk ? (
              <div>
                walk-forward n={chair.walk.n} · train {Math.round(chair.walk.train_hit * 100)}%{" "}
                {chair.walk.train_ev >= 0 ? "+" : ""}
                {chair.walk.train_ev.toFixed(1)}¢ · later {Math.round(chair.walk.test_hit * 100)}%{" "}
                {chair.walk.test_ev >= 0 ? "+" : ""}
                {chair.walk.test_ev.toFixed(1)}¢
              </div>
            ) : (
              <div>walk-forward needs 16 graded chair calls</div>
            )}
            <div>
              full-call conf min(92, round(50+|score|×55)) = {chair.full_conf_raw}
              {chair.lean === "WAIT" ? " · WAIT uses gate conf" : ""} → {chair.confidence} conf
              {chair.lean !== "WAIT" ? ` · call ${sideAsk(snap, chair.lean).toFixed(0)}¢` : ""}
            </div>
          </div>
        </Pane>
        <Pane title={<Tip k="pane.gates">Gate checklist</Tip>}>
          <ul className="space-y-1">
            {chair.gates.map((g) => (
              <li key={g.id} className="flex items-start justify-between gap-2 font-mono text-data">
                <span className={g.pass ? "text-up" : g.hard ? "text-down" : "text-wait"}>
                  {g.pass ? "PASS" : "FAIL"}
                </span>
                <span className="min-w-0 flex-1 text-muted">
                  {g.label}
                  <span className="block text-micro text-subtle">{g.value}</span>
                </span>
              </li>
            ))}
          </ul>
        </Pane>
        <Pane title={<Tip k="pane.thinking">Chair thinking</Tip>}>
          <div className="space-y-1.5">
            <Field k="phase" v={snap.phase} />
            <Field k="hypothesis" v={chair.hypothesis} />
            <Field
              k="evidence"
              v={
                <ul className="space-y-0.5">
                  {chair.evidence.length ? chair.evidence.map((e) => <li key={e}>{e}</li>) : "—"}
                </ul>
              }
            />
            <Field k="counter" v={chair.counter} />
            <Field k="decision" v={chair.decision} />
            <Field k="invalidate if" v={chair.invalidate_if} />
            <Field k="calc" v={<span className="font-mono text-data">{chair.calc}</span>} />
            <Field k="skill / huddle" v={`${chair.last_settle} / ${chair.huddle_line}`} />
          </div>
        </Pane>
      </div>
    </div>
  );
}

export function MetaFooter({
  chair,
  law_wrongs,
  lockdown,
  lockdown_until,
  tape,
  settling,
}: {
  chair: ChairResult | null;
  law_wrongs: number;
  lockdown: boolean;
  lockdown_until: number;
  tape: string[];
  settling?: boolean;
}) {
  const q = chair?.quorum ?? { up: 0, down: 0, wait: 0 };
  const left = Math.max(0, Math.round((lockdown_until - Date.now()) / 1000));
  return (
    <div className="border-t border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 font-mono text-data">
        <div>
          <span className="text-micro uppercase text-subtle">
            <Tip k="footer.quorum">Quorum </Tip>
          </span>
          <span className="text-up">UP {q.up}</span>
          <span className="text-subtle"> · </span>
          <span className="text-down">DOWN {q.down}</span>
          <span className="text-subtle"> · </span>
          <span className="text-wait">WAIT {q.wait}</span>
        </div>
        <div>
          <span className="text-micro uppercase text-subtle">
            <Tip k="footer.law">Law </Tip>
          </span>
          <span className={lockdown ? "text-down" : "text-muted"}>
            {law_wrongs} consecutive wrongs · lock {lockdown ? "ON" : "off"}
            {lockdown && left > 0 ? ` ${left}s` : ""}
          </span>
        </div>
      </div>
      {tape[0] && (
        <div className="border-t border-border px-3 py-1 font-mono text-micro text-muted">
          <span className="text-subtle">
            <Tip k="footer.tape">SETTLE TAPE</Tip>
            {" · "}
          </span>
          <span className={settling || tape[0].startsWith("PENDING") ? "text-wait" : undefined}>
            {tape[0]}
          </span>
        </div>
      )}
    </div>
  );
}
