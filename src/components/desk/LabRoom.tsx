import { sampleRate, DISPLAY_SAMPLE_MIN } from "@/lib/desk/display-evidence";
import { PaperDisclaimer } from "./PaperDisclaimer";
import { useEffect, useState } from "react";
import { publicLabSnapshot, type PublicLabSnapshot, type PublicLabSpecimen } from "@/lib/desk/lab-public";
import { GlobalHeader } from "./GlobalHeader";
import { evidenceAge, labComparisons } from "@/lib/desk/public-room-view";
import { CallQualityStudy } from "./CallQualityStudy";

function cents(v: number | null): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v}¢`;
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

function percent(v: number | null): string {
  return v == null ? "—" : `${(v * 100).toFixed(1)}%`;
}

function ResearchRegistry({ data }: { data: PublicLabSnapshot["registry"] }) {
  if (!data) {
    return (
      <section className="mt-6 rounded-md border border-border bg-canvas p-4">
        <div className="font-mono text-micro uppercase tracking-widest text-subtle">Research systems health</div>
        <p className="mt-2 font-mono text-micro leading-relaxed text-muted">
          The aggregate lifecycle registry is temporarily unavailable. Research collectors continue independently.
        </p>
      </section>
    );
  }

  const stale = data.rows.filter((row) => row.health === "stale");
  const fixed = data.rows.filter((row) => row.missing_is_error);
  const unsampledFixed = fixed.filter((row) => row.health === "no-sample");

  return (
    <section className="mt-6 rounded-md border border-border bg-surface p-4 sm:p-5" aria-labelledby="lab-registry-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-micro uppercase tracking-[0.18em] text-subtle">Lifecycle audit</div>
          <h2 id="lab-registry-title" className="mt-1 font-sans text-title font-medium text-fg">
            Research systems health
          </h2>
        </div>
        <span className="rounded-sm border border-border bg-canvas px-2 py-1 font-mono text-micro font-bold uppercase tracking-widest text-muted">
          {stale.length
            ? `${stale.length} stale`
            : unsampledFixed.length
              ? `${unsampledFixed.length} awaiting first sample`
              : "no stale fixed collectors"}
        </span>
      </div>

      <p className="mt-3 max-w-[90ch] font-sans text-ui leading-relaxed text-muted">
        Every active Lab question has one lifecycle row: what it is for, whether it has decision authority,
        how often fresh evidence should arrive, its current sample count, and the latest durable evidence.
        Event-driven and manual studies are never called stale merely because a timer did not fire.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <div className="rounded-sm border border-border bg-canvas p-3">
          <div className="font-mono text-micro uppercase tracking-widest text-subtle">Systems</div>
          <div className="mt-1 font-mono text-data tabular text-fg">{data.rows.length}</div>
        </div>
        <div className="rounded-sm border border-border bg-canvas p-3">
          <div className="font-mono text-micro uppercase tracking-widest text-subtle">Fixed cadence</div>
          <div className="mt-1 font-mono text-data tabular text-fg">{fixed.length}</div>
        </div>
        <div className="rounded-sm border border-border bg-canvas p-3">
          <div className="font-mono text-micro uppercase tracking-widest text-subtle">Collecting</div>
          <div className="mt-1 font-mono text-data tabular text-fg">{data.tally.collecting}</div>
        </div>
        <div className="rounded-sm border border-border bg-canvas p-3">
          <div className="font-mono text-micro uppercase tracking-widest text-subtle">Stale / no sample</div>
          <div className="mt-1 font-mono text-data tabular text-fg">{data.tally.stale} / {unsampledFixed.length}</div>
        </div>
      </div>

      {stale.length ? (
        <div role="status" className="mt-4 rounded-sm border border-border bg-canvas p-3 font-mono text-micro leading-relaxed text-wait">
          Needs attention: {stale.map((row) => row.label).join(" · ")}
        </div>
      ) : unsampledFixed.length ? (
        <div role="status" className="mt-4 rounded-sm border border-border bg-canvas p-3 font-mono text-micro leading-relaxed text-muted">
          Awaiting first durable sample: {unsampledFixed.map((row) => row.label).join(" · ")}
        </div>
      ) : (
        <p className="mt-4 font-mono text-micro leading-relaxed text-subtle">
          No fixed-cadence collector is beyond its freshness allowance as of {utcClock(data.at)}.
        </p>
      )}

      <details className="mt-4 rounded-sm border border-border bg-canvas">
        <summary className="cursor-pointer px-3 py-3 font-mono text-micro uppercase tracking-widest text-muted">
          Full inventory · {data.rows.length} systems
        </summary>
        <div className="grid gap-2 border-t border-border p-3">
          {data.rows.map((row) => {
            const last = row.last_evidence_at
              ? ageLabel(row.last_evidence_at, data.at)
              : row.cadence_kind === "manual"
                ? "on demand"
                : "none recorded";
            return (
              <article key={row.id} className="rounded-sm border border-border bg-surface p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-mono text-ui text-fg">{row.label}</div>
                    <div className="mt-1 font-mono text-micro uppercase tracking-widest text-subtle">
                      {row.type} · authority {row.authority}
                    </div>
                  </div>
                  <span className={`font-mono text-micro uppercase tracking-widest ${row.health === "stale" ? "text-wait" : "text-muted"}`}>
                    {row.health.replace("-", " ")}
                  </span>
                </div>
                <p className="mt-2 font-sans text-ui leading-relaxed text-muted">{row.purpose}</p>
                <div className="mt-2 font-mono text-micro leading-relaxed text-subtle">
                  n={row.sample_n} · source evidence {last} · {row.cadence} · visible in {row.visible_at}
                </div>
              </article>
            );
          })}
        </div>
      </details>

      <p className="mt-3 font-mono text-micro leading-relaxed text-subtle">
        This registry is read-only aggregate telemetry. It cannot change the Chair, paper book, learner, thresholds, or promotion state.
      </p>
    </section>
  );
}

function ForcedV4Study({ data }: { data: PublicLabSnapshot["forced_v4"] }) {
  if (!data) {
    return (
      <section className="mt-6 rounded-md border border-border bg-canvas p-4">
        <div className="font-mono text-micro uppercase tracking-widest text-subtle">Forced direction · V4</div>
        <p className="mt-2 font-mono text-micro leading-relaxed text-muted">
          The V4 scorecard is temporarily unavailable. No live decision path depends on it.
        </p>
      </section>
    );
  }

  const coverage = data.coverage.expected_since_first > 0
    ? `${data.coverage.captured_since_first} / ${data.coverage.expected_since_first}`
    : `${data.captured}`;
  const observer = data.health.last_error
    ? "observer error"
    : data.health.started
      ? "collecting"
      : "not started";

  return (
    <section className="mt-6 rounded-md border border-border bg-surface p-4 sm:p-5" aria-labelledby="forced-v4-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-micro uppercase tracking-[0.18em] text-subtle">
            Shadow decider · T−7:30
          </div>
          <h2 id="forced-v4-title" className="mt-1 font-sans text-title font-medium text-fg">
            Forced direction · V4
          </h2>
        </div>
        <span className="rounded-sm border border-border bg-canvas px-2 py-1 font-mono text-micro font-bold uppercase tracking-widest text-muted">
          {observer}
        </span>
      </div>

      <p className="mt-3 max-w-[90ch] font-sans text-ui leading-relaxed text-muted">
        One immutable UP or DOWN call per captured window. WAIT is not an output. Price, fee, Chair stance,
        confidence, consensus and chalk do not gate the direction; the same-time ask is recorded only after
        the side is frozen so economics can be measured separately.
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div>
          <dt className="font-mono text-micro uppercase tracking-widest text-subtle">Graded</dt>
          <dd className="mt-1 font-mono text-ui tabular text-fg">{data.graded} / {data.captured}</dd>
        </div>
        <div>
          <dt className="font-mono text-micro uppercase tracking-widest text-subtle">V4 accuracy</dt>
          <dd className="mt-1 font-mono text-ui tabular text-fg">{percent(data.accuracy)}</dd>
        </div>
        <div>
          <dt className="font-mono text-micro uppercase tracking-widest text-subtle">Market direction</dt>
          <dd className="mt-1 font-mono text-ui tabular text-fg">{percent(data.market_accuracy)}</dd>
        </div>
        <div>
          <dt className="font-mono text-micro uppercase tracking-widest text-subtle">Chair WAIT cut</dt>
          <dd className="mt-1 font-mono text-ui tabular text-fg">
            {percent(data.when_chair_wait.accuracy)} · n={data.when_chair_wait.n}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-micro uppercase tracking-widest text-subtle">Quoted net</dt>
          <dd className="mt-1 font-mono text-ui tabular text-fg">
            {cents(data.quoted_net_cents)} · n={data.quoted_n}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-micro uppercase tracking-widest text-subtle">Coverage</dt>
          <dd className="mt-1 font-mono text-ui tabular text-fg">{coverage}</dd>
        </div>
      </dl>

      <div className="mt-4 grid gap-2 border-t border-border pt-4 font-mono text-micro leading-relaxed text-subtle sm:grid-cols-2">
        <div>
          Brier: <span className="text-muted">{data.brier == null ? "—" : data.brier.toFixed(4)}</span>
          {" · "}market <span className="text-muted">{data.market_brier == null ? "—" : data.market_brier.toFixed(4)}</span>
        </div>
        <div>
          Missing checkpoints: <span className="text-muted">{data.coverage.missing}</span>
        </div>
      </div>
      <p className="mt-3 font-mono text-micro leading-relaxed text-subtle">
        Directional accuracy and Brier use officially graded, research-valid windows. Quoted net is a
        one-contract paper measurement on windows where the chosen side had a valid same-time ask; it never
        determines whether V4 is allowed to call. Authority: none.
      </p>
      {data.health.last_error ? (
        <p role="status" className="mt-3 font-mono text-micro text-wait">
          Observer: {data.health.last_error}
        </p>
      ) : null}
    </section>
  );
}

function OpenAIShadowStudy({ data }: { data: PublicLabSnapshot["openai_shadow"] }) {
  if (!data) {
    return (
      <section className="mt-6 rounded-md border border-border bg-canvas p-4">
        <div className="font-mono text-micro uppercase tracking-widest text-subtle">OpenAI shadow analyst · V1</div>
        <p className="mt-2 font-mono text-micro leading-relaxed text-muted">
          The OpenAI paper-research scorecard is temporarily unavailable. No live decision path depends on it.
        </p>
      </section>
    );
  }

  const coverage = data.coverage.expected_since_first > 0
    ? `${data.coverage.captured_since_first} / ${data.coverage.expected_since_first}`
    : `${data.captured}`;
  const observer = !data.health.configured
    ? "needs API key"
    : data.health.last_error
      ? "observer error"
      : data.health.started
        ? "collecting"
        : "not started";

  return (
    <section className="mt-6 rounded-md border border-border bg-surface p-4 sm:p-5" aria-labelledby="openai-shadow-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-micro uppercase tracking-[0.18em] text-subtle">
            Paper-only AI research · T−7:30
          </div>
          <h2 id="openai-shadow-title" className="mt-1 font-sans text-title font-medium text-fg">
            OpenAI shadow analyst · V1
          </h2>
        </div>
        <span className="rounded-sm border border-border bg-canvas px-2 py-1 font-mono text-micro font-bold uppercase tracking-widest text-muted">
          {observer}
        </span>
      </div>

      <p className="mt-3 max-w-[90ch] font-sans text-ui leading-relaxed text-muted">
        A frozen same-time packet is sent to {data.model} once per captured window. The model returns a structured
        P(UP), forced direction, evidence labels, contradictions and an optional abstain flag. It has no web tools,
        no order tools and no path into SATOSHI, the learner or the paper book.
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div>
          <dt className="font-mono text-micro uppercase tracking-widest text-subtle">Graded</dt>
          <dd className="mt-1 font-mono text-ui tabular text-fg">{data.graded} / {data.captured}</dd>
        </div>
        <div>
          <dt className="font-mono text-micro uppercase tracking-widest text-subtle">AI accuracy</dt>
          <dd className="mt-1 font-mono text-ui tabular text-fg">{percent(data.accuracy)}</dd>
        </div>
        <div>
          <dt className="font-mono text-micro uppercase tracking-widest text-subtle">AI Brier</dt>
          <dd className="mt-1 font-mono text-ui tabular text-fg">{data.brier == null ? "—" : data.brier.toFixed(4)}</dd>
        </div>
        <div>
          <dt className="font-mono text-micro uppercase tracking-widest text-subtle">Market Brier</dt>
          <dd className="mt-1 font-mono text-ui tabular text-fg">{data.market_brier == null ? "—" : data.market_brier.toFixed(4)}</dd>
        </div>
        <div>
          <dt className="font-mono text-micro uppercase tracking-widest text-subtle">Chair WAIT cut</dt>
          <dd className="mt-1 font-mono text-ui tabular text-fg">
            {percent(data.when_chair_wait.accuracy)} · n={data.when_chair_wait.n}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-micro uppercase tracking-widest text-subtle">Coverage</dt>
          <dd className="mt-1 font-mono text-ui tabular text-fg">{coverage}</dd>
        </div>
      </dl>

      <div className="mt-4 grid gap-2 border-t border-border pt-4 font-mono text-micro leading-relaxed text-subtle sm:grid-cols-3">
        <div>
          Non-abstain: <span className="text-muted">{percent(data.non_abstain.accuracy)} · n={data.non_abstain.n}</span>
        </div>
        <div>
          Abstained: <span className="text-muted">{data.abstain_n} / {data.captured}</span>
        </div>
        <div>
          API tokens: <span className="text-muted">{data.usage.total_tokens.toLocaleString()}</span>
        </div>
      </div>

      <p className="mt-3 font-mono text-micro leading-relaxed text-subtle">
        Prompt {data.prompt_version}. Probability and direction are always scored; the abstain flag is a separate
        research cut. Model conviction is self-rated and is not treated as calibrated probability. Authority: none.
      </p>
      {!data.health.configured ? (
        <p role="status" className="mt-3 font-mono text-micro text-wait">
          OPENAI_API_KEY is not configured on the server yet, so the observer is dormant.
        </p>
      ) : data.health.last_error ? (
        <p role="status" className="mt-3 font-mono text-micro text-wait">
          The last API capture failed; the desk itself is unaffected and the observer will retry on a future checkpoint.
        </p>
      ) : null}
    </section>
  );
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
        Rates appear after 20 observations in each column. Smaller samples remain visible as counts. Descriptive replay evidence only; not used by Chair, learner, or promotion.
      </p>

      {rows.length ? (
        <div className="lab-timing-scroll mt-4 overflow-x-auto rounded-sm border border-border">
          <table role="table" className="lab-timing-table w-full min-w-[960px] border-collapse text-left">
            <caption className="sr-only">Seat timing calibration: raw and heard accuracy at fixed horizons before close.</caption>
            <thead role="rowgroup" className="bg-canvas">
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
            <tbody role="rowgroup">
              {rows.map((row) => (
                <tr role="row" key={row.seat} className="border-b border-border last:border-b-0">
                  <th role="rowheader" scope="row" className="px-3 py-3 font-mono text-ui font-medium text-fg">
                    {row.seat}
                  </th>
                  {row.horizons.map((horizon) => (
                    <td
                      key={horizon.seconds}
                      role="cell"
                      data-label={`${data.horizons.find((h) => h.seconds === horizon.seconds)?.label ?? `${horizon.seconds}s`} before close`}
                      className="border-l border-border px-3 py-3 font-mono text-micro tabular"
                    >
                      <div className="mb-2 text-subtle sm:hidden">
                        n={data.horizons.find((h) => h.seconds === horizon.seconds)?.sampled_windows ?? "—"} windows sampled
                      </div>
                      <div className={horizon.raw_n < DISPLAY_SAMPLE_MIN ? "text-subtle" : "text-fg"}>
                        raw {sampleRate(horizon.raw_rate, horizon.raw_n)}
                      </div>
                      <div className="mt-1 text-muted">
                        heard {sampleRate(horizon.heard_rate, horizon.heard_n)}
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

      <main id="lab-main" className="council-reading-page council-page-wide gutter mx-auto w-full py-6 sm:py-8">
        {refreshFailed ? <p role="status" className="mb-4 rounded-md border border-border bg-surface p-3 font-mono text-micro text-wait">{data ? "Refresh paused. Showing the last recorded snapshot; retrying automatically." : "The Lab could not load. Retrying automatically."}</p> : null}
        <section className="border-b border-border pb-6">
          <div className="font-mono text-micro uppercase tracking-[0.2em] text-subtle">The Lab · Prospective research</div>
          <h1 className="council-page-title mt-2 font-sans text-display font-medium tracking-tight">Research, held to evidence.</h1>
          <p className="mt-2 max-w-[70ch] font-sans text-body leading-relaxed text-muted">
            Follow the experiments being tested alongside the Council. Each candidate is measured against a frozen control using prospective paper-research evidence.
          </p>
          <details className="company-policy"><summary>How research stays separate from live decisions</summary><p className="max-w-[78ch] leading-relaxed">
            Nothing here can change the Chair, enter the Council, alter the paper book, or promote itself. Evidence is collected first; any future authority requires a separate documented review.
          </p></details>
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

            <ResearchRegistry data={data.registry} />
            <CallQualityStudy data={data.call_quality} />
            <ForcedV4Study data={data.forced_v4} />
            <OpenAIShadowStudy data={data.openai_shadow} />
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
      <PaperDisclaimer />
    </div>
  );
}
