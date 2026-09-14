import { useEffect, useState } from "react";
import { publicLabSnapshot, type PublicLabSnapshot, type PublicLabSpecimen } from "@/lib/desk/lab-public";
import { GlobalHeader } from "./GlobalHeader";
import { evidenceAge, labComparisons } from "@/lib/desk/public-room-view";

function cents(v: number | null): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v}¢`;
}

function pct(v: number | null): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function utcClock(value: string): string {
  try {
    return `${new Date(value).toISOString().slice(11, 19)} UTC`;
  } catch {
    return value;
  }
}

function ageLabel(value: string, asOf: string): string {
  return evidenceAge(value, asOf);
}

function LabSummary({ data }: { data: PublicLabSnapshot }) {
  const { control, candidates, comparisons, reached } = labComparisons(data.specimens, data.control_id);
  const paired = comparisons.filter((item) => item.delta != null).length;
  return (
    <section className="mt-6 rounded-md border border-border bg-surface p-4 sm:p-5" aria-labelledby="lab-summary-title">
      <div className="font-mono text-micro uppercase tracking-[0.18em] text-subtle">Comparison first</div>
      <h2 id="lab-summary-title" className="mt-1 font-sans text-title font-medium text-fg">What the ledger says</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-sm border border-border bg-canvas p-3">
          <div className="font-mono text-micro uppercase tracking-widest text-subtle">Frozen control</div>
          <div className="mt-1 font-sans text-ui text-fg">{control?.label ?? data.control_id}</div>
          <div className="mt-1 font-mono text-micro tabular text-muted">
            {control ? `${cents(control.avg_cents)} / observation · n=${control.sample_n}` : "waiting for control evidence"}
          </div>
        </div>
        <div className="rounded-sm border border-border bg-canvas p-3">
          <div className="font-mono text-micro uppercase tracking-widest text-subtle">Matched comparisons</div>
          <div className="mt-1 font-mono text-data tabular text-fg">{paired} / {candidates.length}</div>
          <div className="mt-1 font-mono text-micro text-muted">candidates with shared-window evidence</div>
        </div>
        <div className="rounded-sm border border-border bg-canvas p-3">
          <div className="font-mono text-micro uppercase tracking-widest text-subtle">Sample gate reached</div>
          <div className="mt-1 font-mono text-data tabular text-fg">{reached} / {candidates.length}</div>
          <div className="mt-1 font-mono text-micro text-muted">candidate count only · not promotion</div>
        </div>
      </div>
      <div className="mt-4 border-t border-border pt-4">
        <div className="font-mono text-micro uppercase tracking-widest text-subtle">
          Paired difference vs {control?.label ?? data.control_id}
        </div>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {comparisons.map(({ row, delta }) => (
            <li key={row.id}>
              <a href={`#lab-specimen-${row.id}`} className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-sm border border-border bg-canvas px-3 py-2 text-muted hover:bg-surface-2 hover:text-fg">
                <span className="font-mono text-ui">{row.label}</span>
                <span className="font-mono text-micro tabular">
                  <span className="text-fg">{cents(delta)}</span>
                  {delta != null ? ` · ${row.paired_n} paired windows` : " · awaiting matched evidence"}
                  <span aria-hidden="true"> ↗</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-3 font-mono text-micro leading-relaxed text-muted">
        Each difference uses only windows shared by that candidate and the control. Separate averages can cover different windows.
        These are observed paper results, not a recommendation or a winner declaration.
      </p>
    </section>
  );
}

function progress(row: PublicLabSpecimen): number {
  if (!(row.sample_gate.required > 0)) return 0;
  return Math.max(0, Math.min(100, (row.sample_gate.current / row.sample_gate.required) * 100));
}

function Specimen({ row, controlId, asOf }: { row: PublicLabSpecimen; controlId: string; asOf: string }) {
  return (
    <article id={`lab-specimen-${row.id}`} className="scroll-mt-20 rounded-md border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-micro uppercase tracking-[0.18em] text-subtle">Specimen · {row.id}</div>
          <h2 className="mt-1 font-sans text-title font-medium text-fg">{row.label}</h2>
        </div>
        <span className="rounded-sm border border-border bg-canvas px-2 py-1 font-mono text-micro font-bold tracking-widest text-muted">
          {row.status}
        </span>
      </div>

      <p className="mt-3 max-w-[72ch] font-sans text-ui leading-relaxed text-muted">{row.hypothesis}</p>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <dt className="font-mono text-micro uppercase tracking-widest text-subtle">Sample</dt>
          <dd className="mt-1 font-mono text-ui tabular text-fg">{row.sample_n}</dd>
        </div>
        <div>
          <dt className="font-mono text-micro uppercase tracking-widest text-subtle">Net</dt>
          <dd className="mt-1 font-mono text-ui tabular text-fg">{cents(row.net_cents)}</dd>
        </div>
        <div>
          <dt className="font-mono text-micro uppercase tracking-widest text-subtle">Avg / obs</dt>
          <dd className="mt-1 font-mono text-ui tabular text-fg">{cents(row.avg_cents)}</dd>
        </div>
        <div>
          <dt className="font-mono text-micro uppercase tracking-widest text-subtle">Worst</dt>
          <dd className="mt-1 font-mono text-ui tabular text-fg">{cents(row.worst_cents)}</dd>
        </div>
      </dl>

      <div className="mt-4 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-3 font-mono text-micro text-subtle">
          <span>Prospective sample gate</span>
          <span className="tabular">{row.sample_gate.current} / {row.sample_gate.required}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-canvas" aria-hidden="true">
          <div className="h-full bg-muted" style={{ width: `${progress(row)}%` }} />
        </div>
      </div>

      <div className="mt-4 grid gap-2 border-t border-border pt-4 font-mono text-micro text-subtle sm:grid-cols-2">
        <div>profitable / losing <span className="text-muted">{row.profitable} / {row.losing}</span></div>
        <div>frozen <span className="text-muted">{ageLabel(row.frozen_at, asOf)}</span></div>
        {!row.control ? (
          <>
            <div>paired vs {controlId} <span className="text-muted">{row.paired_n} windows</span></div>
            <div>paired delta <span className="text-muted">{cents(row.paired_delta)} avg</span></div>
          </>
        ) : null}
      </div>
    </article>
  );
}

function SeatTimingStudy({
  data,
}: {
  data: NonNullable<PublicLabSnapshot["seat_timing"]>;
}) {
  const rows = data.seats.filter((row) =>
    row.horizons.some((horizon) => horizon.raw_n >= 20),
  );

  return (
    <section
      className="mt-6 rounded-md border border-border bg-surface p-4 sm:p-5"
      aria-labelledby="seat-timing-title"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-mono text-micro uppercase tracking-[0.18em] text-subtle">
            Replay study · fixed horizons
          </div>
          <h2 id="seat-timing-title" className="mt-1 font-sans text-title font-medium text-fg">
            Seat timing calibration
          </h2>
        </div>
        <div className="font-mono text-micro tabular text-subtle">
          {data.windows} valid complete replays · latest cap {data.window_cap}
        </div>
      </div>

      <p className="mt-3 max-w-[90ch] font-sans text-ui leading-relaxed text-muted">
        Raw is every directional read the specialist saw, including reads withheld by the whisper filter.
        Heard is only votes that reached the Chair. Accuracy is measured against official settlement.
      </p>
      <p className="mt-2 max-w-[90ch] font-mono text-micro leading-relaxed text-subtle">
        Descriptive replay evidence only; not used by Chair, learner, or promotion.
      </p>

      {rows.length ? (
        <div className="mt-4 overflow-x-auto rounded-sm border border-border">
          <table className="w-full min-w-[960px] border-collapse text-left">
            <thead className="bg-canvas">
              <tr>
                <th
                  scope="col"
                  className="border-b border-border px-3 py-3 font-mono text-micro uppercase tracking-widest text-subtle"
                >
                  Seat
                </th>
                {data.horizons.map((horizon) => (
                  <th
                    key={horizon.seconds}
                    scope="col"
                    className="border-b border-l border-border px-3 py-3 font-mono text-micro font-normal text-subtle"
                  >
                    <span className="block uppercase tracking-widest text-muted">
                      {horizon.label} before close
                    </span>
                    <span className="mt-1 block tabular">n={horizon.sampled_windows} windows sampled</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.seat} className="border-b border-border last:border-b-0">
                  <th scope="row" className="px-3 py-3 font-mono text-ui font-medium text-fg">
                    {row.seat}
                  </th>
                  {row.horizons.map((horizon) => (
                    <td
                      key={horizon.seconds}
                      className="border-l border-border px-3 py-3 font-mono text-micro tabular"
                    >
                      <div className="text-fg">
                        raw {pct(horizon.raw_rate)}
                        <span className="ml-2 text-subtle">n={horizon.raw_n}</span>
                      </div>
                      <div className="mt-1 text-muted">
                        heard {pct(horizon.heard_rate)}
                        <span className="ml-2 text-subtle">n={horizon.heard_n}</span>
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-4 rounded-sm border border-border bg-canvas p-4 font-mono text-micro text-subtle">
          No seat has reached the 20-observation display threshold at a fixed horizon.
        </div>
      )}

      <p className="mt-3 font-mono text-micro leading-relaxed text-subtle">
        Seats appear after at least 20 raw observations at one horizon. This display threshold is not
        a research or promotion gate. As of <time dateTime={data.at}>{new Date(data.at).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC")}</time>.
      </p>
    </section>
  );
}

export function LabRoom({ initial }: { initial?: PublicLabSnapshot | null }) {
  const [data, setData] = useState<PublicLabSnapshot | null>(initial ?? null);
  const [loaded, setLoaded] = useState(initial !== undefined);
  const [refreshFailed, setRefreshFailed] = useState(false);

  useEffect(() => {
    let mounted = true;
    const pull = async () => {
      try {
        const next = await publicLabSnapshot();
        if (mounted) {
          setData(next);
          setRefreshFailed(false);
        }
      } catch {
        if (mounted) setRefreshFailed(true);
      } finally {
        if (mounted) setLoaded(true);
      }
    };
    void pull();
    const timer = window.setInterval(() => void pull(), 30_000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <a href="#lab-main" className="skip-link">Skip to content</a>
      <GlobalHeader />

      <main id="lab-main" className="gutter mx-auto w-full max-w-[var(--max)] py-6 sm:py-8">
        {refreshFailed ? <p role="status" className="mb-4 rounded-md border border-border bg-surface p-3 font-mono text-micro text-wait">{data ? "Refresh paused. Showing the last recorded snapshot; retrying automatically." : "The Lab could not load. Retrying automatically."}</p> : null}
        <section className="border-b border-border pb-6">
          <div className="font-mono text-micro uppercase tracking-[0.2em] text-subtle">ALCHEMIST · prospective research</div>
          <h1 className="mt-2 font-sans text-display font-medium tracking-tight">THE LAB</h1>
          <p className="mt-2 max-w-[70ch] font-sans text-body leading-relaxed text-muted">
            Where frozen ideas compete before they earn any right to challenge the Council. These are real prospective paper-research specimens, measured against the same booked opportunities.
          </p>
          <p className="mt-3 max-w-[78ch] font-mono text-micro leading-relaxed text-subtle">
            Nothing here can change the Chair, enter the Council, alter the paper book, or promote itself. Evidence is collected first; any future authority requires a separate documented review.
          </p>
        </section>

        {!loaded ? (
          <div className="mt-6 rounded-md border border-border bg-surface p-5 font-mono text-ui text-muted">Opening the specimen ledger…</div>
        ) : !data ? (
          <div className="mt-6 rounded-md border border-border bg-surface p-5 font-mono text-ui text-muted">The Lab ledger is unavailable.</div>
        ) : (
          <>
            <section className="mt-6 grid gap-3 sm:grid-cols-3" aria-label="Lab governance">
              <div className="rounded-md border border-border bg-canvas p-4">
                <div className="font-mono text-micro uppercase tracking-widest text-subtle">Champion</div>
                <div className="mt-1 font-mono text-ui text-fg">{data.champion.policy_id} · v{data.champion.version}</div>
              </div>
              <div className="rounded-md border border-border bg-canvas p-4">
                <div className="font-mono text-micro uppercase tracking-widest text-subtle">Minimum sample</div>
                <div className="mt-1 font-mono text-ui tabular text-fg">{data.governance.sample_min} prospective fills</div>
              </div>
              <div className="rounded-md border border-border bg-canvas p-4">
                <div className="font-mono text-micro uppercase tracking-widest text-subtle">Authority</div>
                <div className="mt-1 font-mono text-ui text-fg">paper-only · none</div>
              </div>
            </section>

            <LabSummary data={data} />

            <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="font-mono text-micro uppercase tracking-widest text-subtle">Frozen DNA · live evidence</div>
                <h2 className="mt-1 font-sans text-title font-medium">Specimen ledger</h2>
              </div>
              <div className="font-mono text-micro text-subtle">as of {utcClock(data.at)}</div>
            </div>

            <section className="mt-3 grid gap-4" aria-label="Lab specimens">
              {data.specimens.map((row) => (
                <Specimen key={row.id} row={row} controlId={data.control_id} asOf={data.at} />
              ))}
            </section>

            {data.seat_timing ? (
              <SeatTimingStudy data={data.seat_timing} />
            ) : (
              <section className="mt-6 rounded-md border border-border bg-canvas p-4">
                <div className="font-mono text-micro uppercase tracking-widest text-subtle">
                  Seat timing calibration
                </div>
                <p className="mt-2 font-mono text-micro leading-relaxed text-muted">
                  The optional replay aggregate is temporarily unavailable. The specimen ledger above is unaffected.
                </p>
              </section>
            )}

            <section className="mt-6 rounded-md border border-border bg-canvas p-4 font-mono text-micro leading-relaxed text-subtle">
              Review gates are frozen outside the specimens. Current component minimums include {data.governance.sample_min} prospective fills, {data.governance.days_min} calendar days, and {data.governance.paired_control_losses_min} paired control-loss windows. Meeting a count is not promotion; all applicable evidence gates must be reviewed separately.
            </section>
          </>
        )}
      </main>
    </div>
  );
}
