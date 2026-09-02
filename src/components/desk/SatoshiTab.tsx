import type { ChairResult, SeatId, Settings, Snapshot } from "@/lib/desk/types";
import { cn } from "@/lib/utils";
import { Field, LeanChip, Mono, Pane, StatusChip } from "./bits";
import { Tip } from "./Tip";

export function SatoshiTab({
  snap,
  chair,
  settings,
  onJump,
}: {
  snap: Snapshot;
  chair: ChairResult;
  settings: Settings;
  onJump: (seat: SeatId) => void;
}) {
  return (
    <div className="flex flex-col gap-3 p-3">
      <div data-tour="tour-satoshi" className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[72rem] text-left">
          <thead className="bg-surface-2 font-mono text-micro uppercase tracking-wider text-subtle">
            <tr>
              {(
                [
                  ["Rank", "col.rank"],
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
                  <td className="px-2 py-1 font-mono text-data text-fg">
                    <Tip k={`seat.${r.seat}`} mark={false}>
                      {r.seat}
                    </Tip>
                  </td>
                  <td className="px-2 py-1 font-mono text-data text-muted">{r.callsign}</td>
                  <td className="px-2 py-1">
                    <LeanChip lean={r.lean} />
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
                            "absolute inset-y-0",
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
                      {r.shadow_lean ? <LeanChip lean={r.shadow_lean} /> : <span className="text-subtle">—</span>}
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
            <div>
              full-call conf min(92, round(50+|score|×55)) = {chair.full_conf_raw}
              {chair.lean === "WAIT" ? " · WAIT uses gate conf" : ""} → {chair.confidence}
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
}: {
  chair: ChairResult | null;
  law_wrongs: number;
  lockdown: boolean;
  lockdown_until: number;
  tape: string[];
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
          {tape[0]}
        </div>
      )}
    </div>
  );
}

