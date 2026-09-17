import type { CallQualitySnapshot } from "@/lib/desk/call-quality.server";
import { sampleRate } from "@/lib/desk/display-evidence";

const cents = (v: number | null) => v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}¢`;
const number = (v: number | null) => v == null ? "—" : v.toFixed(4);
const percent = (v: number | null) => v == null ? "—" : `${Math.round(v * 100)}%`;
const time = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function CallQualityStudy({ data }: { data: CallQualitySnapshot | null }) {
  return (
    <section id="call-quality" className="mt-6 scroll-mt-20 rounded-md border border-border bg-surface p-4 sm:p-5" aria-labelledby="call-quality-title">
      <div className="font-mono text-micro uppercase tracking-widest text-subtle">Entry-time evidence</div>
      <h2 id="call-quality-title" className="mt-1 font-sans text-title font-medium">Are the calls adding value?</h2>
      {!data ? <p className="mt-3 text-muted" role="status">Call-quality evidence is temporarily unavailable. This is not a zero result.</p> : <>
        <p className="mt-3 max-w-[78ch] text-muted">
          Frozen reads at 7:30, 5:00 and 3:00 before close compare the Council challenger with market odds at the same moment.
          Each checkpoint and entry-rule version has its own record. Missed checkpoints stay missing.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 font-mono text-micro text-muted">
          <span className="rounded border border-border px-2 py-1">{data.study}</span>
          <span className="rounded border border-border px-2 py-1">Research only · no automatic promotion</span>
          <span className="rounded border border-border px-2 py-1">{data.lookback_days}-day reporting window</span>
        </div>
        {data.observer.error ? <p role="status" className="mt-3 text-wait">The recorder reported an error. Saved evidence remains visible; a missed read will not be reconstructed.</p> : null}
        <p className="mt-3 text-subtle">
          {data.observer.last_capture ? `Latest recorded checkpoint: ${new Date(data.observer.last_capture).toISOString().slice(0, 19).replace("T", " ")} UTC.` : "Awaiting the first recorded checkpoint in this process."}
          {" "}The challenger first needs {data.rules.min_train} earlier, officially graded windows at each checkpoint and under the same entry rules.
        </p>

        <h3 className="mt-6 font-sans text-lg font-medium">Booked calls by rule version</h3>
        <p className="mt-2 text-muted">Actual paper entries, held to the official result, after entry fees. Older entries without a recorded policy identity are left unassigned.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {data.policies.map(p => <article key={p.id} className="min-w-0 rounded border border-border bg-canvas p-4">
            <h4 className="break-words font-mono text-ui text-fg">{p.entry}</h4>
            <p className="mt-1 break-words text-subtle">{p.signal} · {p.risk}</p>
            <dl className="mt-3 grid grid-cols-2 gap-3 font-mono text-micro">
              <div><dt className="text-subtle">Calls / wins</dt><dd>{p.n} / {p.wins}</dd></div>
              <div><dt className="text-subtle">Net after fees</dt><dd>{cents(p.net_cents)}</dd></div>
              <div><dt className="text-subtle">Average / call</dt><dd>{cents(p.avg_cents)}</dd></div>
              <div><dt className="text-subtle">Max drawdown</dt><dd>{cents(p.max_drawdown_cents)}</dd></div>
            </dl>
            <p className="mt-3 text-subtle">{sampleRate(p.win_rate, p.n)}{p.win_interval ? ` · approximate 95% interval ${percent(p.win_interval[0])}–${percent(p.win_interval[1])}` : ""}</p>
          </article>)}
          {!data.policies.length ? <p className="text-muted">No eligible, versioned paper entries yet.</p> : null}
        </div>
        <p className="mt-3 text-subtle">Ledger coverage: {data.coverage.held} held-back windows; {data.coverage.missing} booked windows awaiting a usable official result; {data.coverage.unversioned} unassigned historical entries; {data.coverage.invalid_fills} invalid fill receipts. <a href="/status" className="underline underline-offset-4">Data status</a></p>

        <h3 className="mt-6 font-sans text-lg font-medium">Prospective challenger</h3>
        <p className="mt-2 text-subtle">Checkpoint coverage since the first retained receipt: {data.coverage.checkpoints.recorded} of {data.coverage.checkpoints.expected} due reads recorded · {data.coverage.checkpoints.missing} missing. Invalid receipts are counted as recorded, then excluded from results.</p>
        {!data.groups.length ? <p className="mt-2 text-muted">The new study starts with fresh evidence. Results will appear as checkpoints are recorded and officially graded.</p> : null}
        <div className="mt-3 grid gap-4">
          {data.groups.map(g => <article key={`${g.policy}-${g.horizon}`} className="min-w-0 rounded border border-border bg-canvas p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="font-sans text-lg">{time(g.horizon)} before close</h4>
              <span className="font-mono text-micro text-muted">{g.sample_ready ? "Sample minimums met · review required" : g.paired ? "Collecting evidence" : "Warm-up"}</span>
            </div>
            <p className="mt-1 break-words text-subtle">{g.policy}</p>
            <dl className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4 font-mono text-micro">
              <div><dt className="text-subtle">Graded / recorded</dt><dd className="mt-1 text-ui">{g.graded} / {g.captured}</dd></div>
              <div><dt className="text-subtle">Paired model forecasts</dt><dd className="mt-1 text-ui">{g.paired}</dd></div>
              <div><dt className="text-subtle">Market / model error</dt><dd className="mt-1 text-ui">{number(g.market_brier)} / {number(g.model_brier)}</dd></div>
              <div><dt className="text-subtle">Improvement in error</dt><dd className="mt-1 text-ui">{number(g.brier_improvement)}</dd></div>
              <div><dt className="text-subtle">Priced hypothetical calls</dt><dd className="mt-1 text-ui">{g.quoted.n}</dd></div>
              <div><dt className="text-subtle">Quoted net after fees</dt><dd className="mt-1 text-ui">{cents(g.quoted.n ? g.quoted.net_cents : null)}</dd></div>
              <div><dt className="text-subtle">Net with extra 1¢ cost</dt><dd className="mt-1 text-ui">{cents(g.stressed.n ? g.stressed.net_cents : null)}</dd></div>
              <div><dt className="text-subtle">Hypothetical drawdown</dt><dd className="mt-1 text-ui">{cents(g.quoted.n ? g.quoted.max_drawdown_cents : null)}</dd></div>
            </dl>
            <p className="mt-3 text-subtle">{g.pending} pending · {g.excluded} excluded · {g.warmup} warm-up grades. Model review: {g.paired}/{data.rules.review_windows} paired forecasts, {g.days}/{data.rules.review_days} days, {g.quoted.n}/{data.rules.review_priced_calls} priced calls.</p>
            <details className="mt-4 border-t border-border pt-3">
              <summary className="cursor-pointer py-2 font-sans text-ui">Why entries were blocked</summary>
              <p className="mt-2 text-muted">Counts can overlap because every failed entry check is retained. Advisory checks are saved separately and do not count as blockers. Hypothetical results use the frozen challenger, available asks and fees. They do not establish that removing a gate would improve the book.</p>
              <ul className="mt-3 space-y-2 font-mono text-micro text-muted">
                {g.blockers.map(b => <li key={b.id}>{b.label}: {b.n} reads · {b.candidate_n} priced challenger calls · {cents(b.candidate_net_cents)}</li>)}
                {!g.blockers.length ? <li>No graded blocked-entry evidence yet.</li> : null}
              </ul>
            </details>
            <details className="mt-3 border-t border-border pt-3">
              <summary className="cursor-pointer py-2 font-sans text-ui">Seat accuracy at this checkpoint</summary>
              <p className="mt-2 text-muted">Raw directional seat reads on healthy feeds, compared with the market direction on the same observations. Seat strength is not a probability. These measurements do not change seat weights.</p>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2 font-mono text-micro text-muted">
                {g.seats.map(s => <li key={s.seat}>{s.seat}: {sampleRate(s.hit_rate, s.n)} · market {s.n >= 20 ? percent(s.market_hit_rate) : "small sample"}</li>)}
                {!g.seats.length ? <li>No eligible seat readings yet.</li> : null}
              </ul>
            </details>
            <details className="mt-3 border-t border-border pt-3">
              <summary className="cursor-pointer py-2 font-sans text-ui">Probability calibration</summary>
              <p className="mt-2 text-muted">When the model assigns a probability of UP, how often does UP occur? Probability error and log loss compare identical windows; lower is better. Market / model log loss: {number(g.market_log_loss)} / {number(g.model_log_loss)}.</p>
              <ul className="mt-3 space-y-2 font-mono text-micro text-muted">
                {g.calibration.map(b => <li key={b.lo}>{percent(b.lo)}–{percent(b.lo + .2)} band: predicted {percent(b.predicted)} · observed {sampleRate(b.observed, b.n)}</li>)}
              </ul>
            </details>
          </article>)}
        </div>
        <p className="mt-4 text-subtle">Reads are taken within 12 seconds before each checkpoint. Quoted-cost scenarios assume one contract at a recorded ask from 80¢ to below 99¢, spread at most 2¢, resting size, and at least 3¢ predicted edge after fees; they are not verified executions. Positive error improvement favors the model. Windows can be correlated, and the three checkpoints are never pooled. Meeting a sample minimum does not prove an advantage or promote a policy.</p>
      </>}
    </section>
  );
}
