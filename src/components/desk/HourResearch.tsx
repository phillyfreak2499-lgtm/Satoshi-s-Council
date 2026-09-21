/**
 * Hour Research v1 on the page. Read-only, and it says so in words on every
 * panel: this is a shadow read with no authority, not a live hourly rule.
 *
 * Every number rendered here came from the server brief. Nothing is computed
 * from a browser clock, nothing is a placeholder, and a missing feed prints as
 * an em dash with the reason beside it.
 */
import { useCountdownText } from "@/lib/desk/hooks";
import { clockMs } from "@/lib/desk/math";
import { utcStamp } from "@/lib/desk/display-evidence";
import type {
  HourCalibrationBucket,
  HourCheckpointScore,
  HourEvidenceCard,
  HourLadderRow,
  HourRecentRow,
  HourResearchBrief,
  HourTimelineRow,
} from "@/lib/desk/hour-research-brief";

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (p: number | null) => (p == null ? "—" : `${Math.round(p * 100)}%`);
const cents = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}¢`);
const ask = (v: number | null) => (v == null ? "none" : `${Math.round(v)}¢`);
const wide = (n: number) => `${Math.max(0, Math.min(100, n * 100)).toFixed(1)}%`;

function Panel({ n, title, note, children }: { n: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 rounded-md border border-border bg-surface p-4 sm:p-5" aria-labelledby={`hour-${n}`}>
      <div className="font-mono text-micro uppercase tracking-[0.18em] text-subtle">{n}</div>
      <h2 id={`hour-${n}`} className="mt-1 font-sans text-title font-medium text-fg">{title}</h2>
      {note ? <p className="mt-2 max-w-[78ch] font-mono text-micro leading-relaxed text-subtle">{note}</p> : null}
      {children}
    </section>
  );
}

function ShadowTag() {
  return (
    <span className="inline-block rounded-sm border border-warn/40 bg-canvas px-2 py-0.5 font-mono text-micro uppercase tracking-widest text-warn">
      SHADOW READ — NOT A LIVE HOURLY RULE
    </span>
  );
}

// ---------------------------------------------------------------------------
// The clock hero
// ---------------------------------------------------------------------------

function Fresh({ label, age, ok }: { label: string; age: number | null; ok: boolean }) {
  return (
    <span className={`font-mono text-micro ${ok ? "text-subtle" : "text-warn"}`}>
      {label} {age == null ? "age unknown" : `${Math.round(age)}s old`}
    </span>
  );
}

export function HourClockHero({ data }: { data: HourResearchBrief }) {
  const closeMs = data.hour ? Date.parse(data.hour.close_time) : 0;
  const ticking = useCountdownText(closeMs);
  // No browser clock on the server: print the time left as of the brief until it ticks.
  const left = ticking === "—" && data.hour ? clockMs(Math.max(0, closeMs - Date.parse(data.at))) : ticking;
  const focus = data.ladder.find((r) => r.selected) ?? data.ladder.find((r) => r.anchor) ?? null;
  const snap = data.snapshot;
  // The settlement value, or nothing. Exchange spot is shown beside it as
  // context but is never promoted into the settlement slot.
  const reference = snap?.brti ?? null;
  const gap = focus && reference != null ? reference - focus.strike : null;
  return (
    <section className="mt-6 rounded-md border border-border bg-surface p-4 sm:p-5" aria-label="The hour">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="font-mono text-micro uppercase tracking-[0.2em] text-subtle">The hour</div>
        <span className="rounded-sm border border-gold/40 bg-canvas px-2 py-0.5 font-mono text-micro uppercase tracking-widest text-gold">
          SHADOW RESEARCH
        </span>
      </div>
      {!data.hour ? (
        <p className="mt-3 max-w-[72ch] font-sans text-ui leading-relaxed text-muted">
          No open hourly ladder came back from the feed this request. The clock is not guessed.
        </p>
      ) : (
        <>
          <div className="mt-3 font-mono text-display tabular leading-none text-fg">{left}</div>
          <p className="mt-2 font-mono text-micro text-subtle">
            to settlement at {data.hour.close_et} Eastern · {utcStamp(data.hour.close_time)} · {data.hour.event_ticker}
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-sm border border-border bg-canvas p-3">
              <div className="font-mono text-micro uppercase tracking-widest text-subtle">Settlement index</div>
              <div className="mt-1 font-mono text-data tabular text-fg">{reference == null ? "—" : usd(reference)}</div>
              {reference == null ? (
                <div className="font-mono text-micro text-warn">no CF Benchmarks value; the model waits rather than use a venue index</div>
              ) : null}
              <div className="mt-1">
                <Fresh label={snap?.brti_source || "settlement index"} age={snap?.brti_age_s ?? null} ok={data.read?.quality.brti_fresh ?? false} />
              </div>
              {/* Both clocks, because both must pass: a tick we received a
                  moment ago but cannot date at the source is not current. */}
              <div>
                <Fresh
                  label="vendor stamp"
                  age={snap?.brti_source_age_s ?? null}
                  ok={data.read?.quality.brti_fresh ?? false}
                />
              </div>
            </div>
            <div className="rounded-sm border border-border bg-canvas p-3">
              <div className="font-mono text-micro uppercase tracking-widest text-subtle">Strike in focus</div>
              <div className="mt-1 font-mono text-data tabular text-fg">{focus == null ? "—" : usd(focus.strike)}</div>
              <div className="mt-1 font-mono text-micro text-muted">{focus == null ? "no rung priced" : focus.selected ? "the model's candidate" : "nearest expected settlement"}</div>
            </div>
            <div className="rounded-sm border border-border bg-canvas p-3">
              <div className="font-mono text-micro uppercase tracking-widest text-subtle">Distance to strike</div>
              <div className="mt-1 font-mono text-data tabular text-fg">{gap == null ? "—" : `${gap >= 0 ? "+" : "−"}${usd(Math.abs(gap))}`}</div>
              <div className="mt-1 font-mono text-micro text-muted">{snap?.brti_spot_basis == null ? "index-vs-spot unknown" : `index ${usd(Math.abs(snap.brti_spot_basis))} ${snap.brti_spot_basis >= 0 ? "over" : "under"} spot`}</div>
            </div>
            <div className="rounded-sm border border-border bg-canvas p-3">
              <div className="font-mono text-micro uppercase tracking-widest text-subtle">Asks on that rung</div>
              <div className="mt-1 font-mono text-data tabular text-fg">{focus == null ? "—" : `YES ${ask(focus.yes_ask)} / NO ${ask(focus.no_ask)}`}</div>
              <div className="mt-1 font-mono text-micro text-muted">a missing ask is unavailable, never a midpoint</div>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className={`font-mono text-data tabular ${data.read?.decision === "WAIT" || !data.read ? "text-muted" : "text-fg"}`}>
              {data.read ? data.read.decision : "—"}
            </span>
            <ShadowTag />
          </div>
          <p className="mt-2 max-w-[78ch] font-mono text-micro leading-relaxed text-subtle">
            Hourly research authority: {data.authority}. Live hourly rule: {data.live_rule ? "yes" : "no"}. {data.copy.sides}
          </p>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The strike ladder — the centrepiece
// ---------------------------------------------------------------------------

/** Three columns on a phone (the probability pair folds away), four from sm up. */
const LADDER_COLS = "grid grid-cols-[4.75rem_1fr_5.25rem] sm:grid-cols-[6.5rem_1fr_5rem_5rem]";

function LadderRow({ row }: { row: HourLadderRow }) {
  const tone = row.selected ? "border-fg bg-canvas" : row.anchor ? "border-border bg-canvas" : "border-transparent";
  return (
    <div className={`${LADDER_COLS} items-center gap-2 rounded-sm border px-2 py-1.5 ${tone}`}>
      <div className="font-mono text-micro tabular text-fg">
        {usd(row.strike)}
        {row.anchor ? <span className="ml-1 text-subtle" aria-label="nearest expected settlement">·</span> : null}
      </div>
      <div className="relative h-4 rounded-sm bg-canvas" role="img" aria-label={`model ${pct(row.p_model)}, market ${pct(row.p_market)}`}>
        <div className="absolute inset-y-0 left-0 rounded-sm bg-up/30" style={{ width: wide(row.p_model) }} />
        {row.p_market == null ? null : (
          <div className="absolute inset-y-0 w-px bg-fg" style={{ left: wide(row.p_market) }} title="market-implied" />
        )}
      </div>
      <div className="hidden text-right font-mono text-micro tabular text-muted sm:block">
        {pct(row.p_model)}
        <span className="ml-1 text-subtle">/{pct(row.p_market)}</span>
      </div>
      <div className={`text-right font-mono text-micro tabular ${row.best_edge != null && row.best_edge > 0 ? "text-up" : "text-subtle"}`}>
        {row.best_side == null ? "no ask" : `${row.best_side} ${cents(row.best_edge)}`}
      </div>
    </div>
  );
}

function Ladder({ data }: { data: HourResearchBrief }) {
  const note = `Each rung asks whether the official settlement value finishes at or above that strike. The bar is the model's probability; the hairline is what the market implies. ${data.copy.sides}`;
  // The ladder is drawn high strike first, so the reference marker sits after
  // the last rung above it. Null when no expected settlement could be built.
  const marker = data.read?.expected_settlement ?? null;
  const markerAfter = marker == null ? -1 : data.ladder.filter((r) => r.strike > marker).length - 1;
  return (
    <Panel n="02" title="The strike ladder" note={note}>
      <div className="mt-3">
        <ShadowTag />
      </div>
      {!data.ladder.length ? (
        <p className="mt-3 max-w-[72ch] font-sans text-ui leading-relaxed text-muted">
          No ladder could be priced this request — either the hour's rungs did not arrive or no expected settlement value could be
          built from the feeds. Nothing is drawn from a guess.
        </p>
      ) : (
        <>
          <div className={`mt-4 ${LADDER_COLS} gap-2 px-2 font-mono text-micro uppercase tracking-widest text-subtle`}>
            <div>Strike</div>
            <div>Model vs market</div>
            <div className="hidden text-right sm:block">P model/mkt</div>
            <div className="text-right">After-fee edge</div>
          </div>
          <ul className="mt-1 space-y-0.5">
            {data.ladder.map((r, i) => (
                <li key={r.ticker}>
                <LadderRow row={r} />
                {marker != null && i === markerAfter ? (
                  <div className={`${LADDER_COLS} items-center gap-2 border-y border-dashed border-gold/50 px-2 py-1`}>
                    <div className="font-mono text-micro tabular text-gold">{usd(marker)}</div>
                    <div className="font-mono text-micro text-gold">
                      <span aria-hidden="true">●</span> expected settlement{data.read?.expected_source ? ` · ${data.read.expected_source}` : ""}
                    </div>
                    <div />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-3 max-w-[78ch] font-mono text-micro leading-relaxed text-subtle">
            Edge is measured against the real observed ask on that side, after the hourly fee. A rung with no quoted ask reads
            &ldquo;no ask&rdquo;: an unavailable side is never priced off a midpoint.
          </p>
        </>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// The read
// ---------------------------------------------------------------------------

function Read({ data }: { data: HourResearchBrief }) {
  const read = data.read;
  return (
    <Panel
      n="03"
      title="The read"
      note={`Deterministic and versioned (${data.version}). The same frozen snapshot always produces the same read, and the model's authority is ${data.authority}.`}
    >
      <div className="mt-3">
        <ShadowTag />
      </div>
      {!read ? (
        <p className="mt-3 max-w-[72ch] font-sans text-ui leading-relaxed text-muted">
          The model had nothing to read this request. No open hourly ladder was returned by the feed.
        </p>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-sm border border-border bg-canvas p-3">
              <div className="font-mono text-micro uppercase tracking-widest text-subtle">Decision</div>
              <div className={`mt-1 font-mono text-data tabular ${read.decision === "WAIT" ? "text-muted" : "text-fg"}`}>{read.decision}</div>
              <div className="mt-1 font-mono text-micro text-muted">
                {read.decision === "WAIT" ? read.wait_reason?.replace(/_/g, " ") ?? "no reason recorded" : "one candidate, this hour only"}
              </div>
            </div>
            <div className="rounded-sm border border-border bg-canvas p-3">
              <div className="font-mono text-micro uppercase tracking-widest text-subtle">Expected settlement</div>
              <div className="mt-1 font-mono text-data tabular text-fg">{read.expected_settlement == null ? "—" : usd(read.expected_settlement)}</div>
              <div className="mt-1 font-mono text-micro text-muted">source {read.expected_source || "none"}</div>
            </div>
            <div className="rounded-sm border border-border bg-canvas p-3">
              <div className="font-mono text-micro uppercase tracking-widest text-subtle">Candidate</div>
              <div className="mt-1 font-mono text-data tabular text-fg">
                {read.candidate ? `${read.candidate.side} ${ask(read.candidate.ask)}` : "none"}
              </div>
              <div className="mt-1 font-mono text-micro text-muted">
                {read.candidate ? `${usd(read.candidate.strike)} · fee ${Math.round(read.candidate.fee)}¢` : "no rung cleared every gate"}
              </div>
            </div>
            <div className="rounded-sm border border-border bg-canvas p-3">
              <div className="font-mono text-micro uppercase tracking-widest text-subtle">Checkpoint</div>
              <div className="mt-1 font-mono text-data tabular text-fg">{read.checkpoint == null ? "between" : `${read.checkpoint}m`}</div>
              <div className="mt-1 font-mono text-micro text-muted">
                {read.at_checkpoint ? "a frozen research instant" : "preview only; nothing is recorded between checkpoints"}
              </div>
            </div>
          </dl>
          <p className="mt-4 max-w-[78ch] font-sans text-ui leading-relaxed text-fg">{read.explanation}</p>
          <p className="mt-2 max-w-[78ch] font-mono text-micro leading-relaxed text-subtle">
            {data.copy.purpose} The sentence above is built from the stored numbers alone — no language model supplies the
            probability or casts the YES/NO read.
          </p>
        </>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Evidence board
// ---------------------------------------------------------------------------

function Evidence({ cards }: { cards: HourEvidenceCard[] }) {
  return (
    <Panel n="04" title="Evidence board" note="Six families, each reporting what it could see and what it could not. A family with no feed says so; it does not fall back to a default.">
      {!cards.length ? (
        <p className="mt-3 max-w-[72ch] font-sans text-ui leading-relaxed text-muted">No snapshot was frozen this request, so there is no evidence to show.</p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {cards.map((c) => (
            <div key={c.family} className="rounded-sm border border-border bg-canvas p-3">
              <div className="flex items-baseline justify-between gap-2">
                <div className="font-mono text-micro uppercase tracking-widest text-subtle">{c.family}</div>
                <div className={`font-mono text-micro ${c.ok ? "text-subtle" : "text-warn"}`}>{c.ok ? "usable" : "unusable"}</div>
              </div>
              <div className="mt-1 font-mono text-data tabular text-fg">{c.value}</div>
              <p className="mt-1 max-w-[52ch] font-sans text-ui leading-relaxed text-muted">{c.detail}</p>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Checkpoint timeline
// ---------------------------------------------------------------------------

function Timeline({ rows, unavailable }: { rows: HourTimelineRow[]; unavailable: boolean }) {
  return (
    <Panel
      n="05"
      title="Checkpoint timeline"
      note="The model records what it would have done at six fixed instants inside the hour. At most one of them becomes the hour's official shadow candidate, so one hour can never count as a dozen correlated positions."
    >
      {unavailable ? (
        <p className="mt-3 max-w-[72ch] font-sans text-ui leading-relaxed text-muted">The research tables could not be read this request. That is not an empty timeline.</p>
      ) : (
        <ol className="mt-4 space-y-1">
          {rows.map((r) => (
            <li key={r.checkpoint} className="grid grid-cols-[3.5rem_5rem_1fr] items-baseline gap-2 rounded-sm border border-border bg-canvas px-3 py-2">
              <div className="font-mono text-micro tabular text-fg">{r.checkpoint}m</div>
              <div className={`font-mono text-micro ${r.state === "done" || r.state === "now" ? "text-fg" : r.state === "missed" ? "text-warn" : "text-subtle"}`}>
                {r.state === "done" ? "frozen" : r.state === "now" ? "live" : r.state === "ahead" ? "ahead" : "no row"}
              </div>
              <div className="font-mono text-micro text-muted">
                {r.decision == null
                  ? r.state === "ahead"
                    ? "not reached yet"
                    : "this checkpoint produced no stored row"
                  : r.decision === "WAIT"
                    ? `WAIT — ${r.wait_reason?.replace(/_/g, " ") ?? "reason not recorded"}`
                    : `${r.side ?? r.decision} ${ask(r.ask)} at ${r.strike == null ? "—" : usd(r.strike)} · model ${pct(r.p_model)} · edge ${cents(r.edge_cents)}`}
                {r.as_of ? <span className="ml-2 text-subtle">{utcStamp(r.as_of)}</span> : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// The shadow record
// ---------------------------------------------------------------------------

function Calibration({ buckets }: { buckets: HourCalibrationBucket[] }) {
  const any = buckets.some((b) => b.n > 0);
  if (!any) {
    return <p className="mt-3 max-w-[72ch] font-sans text-ui leading-relaxed text-muted">No graded rung has been scored yet, so there is no calibration curve to draw.</p>;
  }
  return (
    <div className="mt-4">
      <div className="grid grid-cols-[4.5rem_1fr_4rem_4rem] gap-2 font-mono text-micro uppercase tracking-widest text-subtle">
        <div>Model p</div>
        <div>Settled at or above</div>
        <div className="text-right">Actual</div>
        <div className="text-right">n</div>
      </div>
      <ul className="mt-1 space-y-0.5">
        {buckets.map((b) => (
          <li key={b.lo} className="grid grid-cols-[4.5rem_1fr_4rem_4rem] items-center gap-2 px-0 py-0.5">
            <div className="font-mono text-micro tabular text-muted">{Math.round(b.lo * 100)}–{Math.round(b.hi * 100)}%</div>
            <div className="relative h-3 rounded-sm bg-canvas">
              {b.hit_rate == null ? null : <div className="absolute inset-y-0 left-0 rounded-sm bg-up/30" style={{ width: wide(b.hit_rate) }} />}
              {b.mean_p == null ? null : <div className="absolute inset-y-0 w-px bg-fg" style={{ left: wide(b.mean_p) }} title="mean model probability" />}
            </div>
            <div className="text-right font-mono text-micro tabular text-muted">{pct(b.hit_rate)}</div>
            <div className="text-right font-mono text-micro tabular text-subtle">{b.n}</div>
          </li>
        ))}
      </ul>
      <p className="mt-2 max-w-[78ch] font-mono text-micro leading-relaxed text-subtle">
        A calibrated model has the bar land on the hairline in every row. Rows with no graded rungs stay empty rather than borrow a
        neighbour&rsquo;s rate.
      </p>
    </div>
  );
}

function ByCheckpoint({ rows }: { rows: HourCheckpointScore[] }) {
  const any = rows.some((r) => r.n > 0);
  if (!any) return null;
  return (
    <div className="mt-5">
      <div className="font-mono text-micro uppercase tracking-widest text-subtle">Brier by checkpoint — lower is better</div>
      <ul className="mt-2 space-y-0.5">
        {rows.map((r) => (
          <li key={r.checkpoint} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-micro tabular">
            <span className="w-10 text-fg">{r.checkpoint}m</span>
            <span className="text-muted">model {r.brier_model ?? "—"}</span>
            <span className="text-muted">market {r.brier_market ?? "—"}</span>
            <span className="text-subtle">distance {r.brier_baseline ?? "—"}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 max-w-[78ch] font-mono text-micro leading-relaxed text-subtle">
        The model has to beat both baselines prospectively — the market&rsquo;s own implied probability and a naive distance-to-strike
        rule — before any promotion conversation is worth having.
      </p>
    </div>
  );
}

function Record({ data }: { data: HourResearchBrief }) {
  const s = data.record;
  return (
    <Panel n="06" title="Shadow record" note={`${data.copy.separate} ${data.copy.gates}`}>
      {data.storage_unavailable ? (
        <p className="mt-3 max-w-[72ch] font-sans text-ui leading-relaxed text-muted">The research tables could not be read this request. That is not a zero record.</p>
      ) : s.windows === 0 ? (
        <p className="mt-3 max-w-[72ch] font-sans text-ui leading-relaxed text-fg">{data.copy.empty}</p>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-sm border border-border bg-canvas p-3">
              <div className="font-mono text-micro uppercase tracking-widest text-subtle">Graded hours</div>
              <div className="mt-1 font-mono text-data tabular text-fg">{s.windows}</div>
              <div className="mt-1 font-mono text-micro text-muted">{s.waits} sat · {s.calls} called</div>
            </div>
            <div className="rounded-sm border border-border bg-canvas p-3">
              <div className="font-mono text-micro uppercase tracking-widest text-subtle">Hit rate vs needed</div>
              <div className="mt-1 font-mono text-data tabular text-fg">{s.win_rate == null ? "—" : `${s.win_rate}%`} vs {s.needed == null ? "—" : `${s.needed}%`}</div>
              <div className="mt-1 font-mono text-micro text-muted">needed is break-even at the prices quoted</div>
            </div>
            <div className="rounded-sm border border-border bg-canvas p-3">
              <div className="font-mono text-micro uppercase tracking-widest text-subtle">Net after fees</div>
              <div className="mt-1 font-mono text-data tabular text-fg">{cents(s.net_cents)}</div>
              <div className="mt-1 font-mono text-micro text-muted">one contract per hour · worst run {cents(s.max_dd)}</div>
            </div>
            <div className="rounded-sm border border-border bg-canvas p-3">
              <div className="font-mono text-micro uppercase tracking-widest text-subtle">Brier vs market</div>
              <div className="mt-1 font-mono text-data tabular text-fg">{s.brier_model ?? "—"} / {s.brier_market ?? "—"}</div>
              <div className="mt-1 font-mono text-micro text-muted">model / market on the same calls</div>
            </div>
          </dl>
          <Calibration buckets={data.calibration} />
          <ByCheckpoint rows={data.by_checkpoint} />
        </>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Recent hours
// ---------------------------------------------------------------------------

function Recent({ rows }: { rows: HourRecentRow[] }) {
  return (
    <Panel n="07" title="Recent hours" note="Every settled hour the research has graded, sat or called, with the sentence the model wrote at the time. A WAIT is a completed outcome, not a missing row.">
      {!rows.length ? (
        <p className="mt-3 max-w-[72ch] font-sans text-ui leading-relaxed text-muted">No hourly window has settled and been graded yet.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {rows.map((r) => (
            <li key={r.close_time} className="rounded-sm border border-border bg-canvas p-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-micro">
                <span className="text-fg">{r.close_et} Eastern</span>
                <span className="text-subtle">{utcStamp(r.close_time)}</span>
                <span className={r.decision === "WAIT" ? "text-muted" : r.ev_cents != null && r.ev_cents > 0 ? "text-up" : "text-down"}>
                  {r.decision === "WAIT" ? `WAIT — ${r.wait_reason?.replace(/_/g, " ") ?? "reason not recorded"}` : `${r.side ?? r.decision} ${ask(r.ask)} · ${cents(r.ev_cents)}`}
                </span>
                <span className="text-subtle">settled {r.official_value == null ? "—" : usd(r.official_value)}</span>
                <span className="text-subtle">{r.checkpoint}m checkpoint</span>
              </div>
              <p className="mt-1 max-w-[78ch] font-sans text-ui leading-relaxed text-muted">{r.explanation}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------

export function HourResearchBoard({ data }: { data: HourResearchBrief | null }) {
  if (!data) {
    return (
      <section className="mt-6 rounded-md border border-border bg-surface p-5 font-mono text-ui text-muted">
        The hourly research could not be read this request. That is not a zero record.
      </section>
    );
  }
  return (
    <>
      <Ladder data={data} />
      <Read data={data} />
      <Evidence cards={data.evidence} />
      <Timeline rows={data.timeline} unavailable={data.storage_unavailable} />
      <Record data={data} />
      <Recent rows={data.recent} />
    </>
  );
}
