/**
 * Chair v2 / Chair v3 — frozen, read-only scoreboards on the public Lab.
 *
 * Presentation only. Every number is projected from a ledger the desk already
 * keeps; every gate is cited from chair-v2.ts / chair-v3.ts. This component
 * cannot refit, sample, vote, book, or promote anything.
 */
import {
  CHAIR_V2_SOURCE,
  CHAIR_V3_SOURCE,
  NOT_THESE,
  fmtBrier,
  fmtCents,
  fmtCount,
  fmtPp,
  gateLabel,
  standingLabel,
  type ChairV2Card,
  type ChairV3Card,
} from "@/lib/desk/chair-shadow-lab";
import { utcStamp } from "@/lib/desk/display-evidence";

function Standing({ standing }: { standing: ChairV2Card["standing"] }) {
  return (
    <span className="rounded-sm border border-border bg-canvas px-2 py-1 font-mono text-micro font-bold tracking-widest text-muted">
      {standingLabel(standing)}
    </span>
  );
}

function Stat({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  return (
    <div>
      <dt className="font-mono text-micro uppercase tracking-widest text-subtle">{label}</dt>
      <dd className={`mt-1 font-mono text-ui tabular ${dim ? "text-subtle" : "text-fg"}`}>{value}</dd>
    </div>
  );
}

function Unavailable({ what }: { what: string }) {
  return (
    <p role="status" className="mt-3 rounded-sm border border-border bg-canvas p-3 font-mono text-micro text-muted">
      {what} is unavailable in this snapshot. This is not a zero result; the shadow ledger is unchanged.
    </p>
  );
}

function ChairV2Panel({ card }: { card: ChairV2Card | null }) {
  const c = card;
  const gates = c?.gates ?? null;
  const graded = (c?.n_graded ?? 0) > 0;
  return (
    <article id="lab-chair-v2" className="scroll-mt-20 rounded-md border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-micro uppercase tracking-[0.18em] text-subtle">Shadow chair · {CHAIR_V2_SOURCE}</div>
          <h3 className="mt-1 font-sans text-title font-medium text-fg">Chair v2</h3>
        </div>
        <Standing standing={c?.standing ?? "unavailable"} />
      </div>

      <p className="mt-3 max-w-[72ch] font-sans text-ui leading-relaxed text-muted">
        Shadow only. Raw seat evidence plus market and fair logits. Nothing here touches the live Chair.
      </p>

      {!c || c.standing === "unavailable" ? (
        <Unavailable what="The Chair v2 shadow scoreboard" />
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Graded / samples" value={`${fmtCount(c.n_graded)} / ${fmtCount(c.n_samples)}`} />
            <Stat label="v2 calls" value={graded ? fmtCount(c.calls_v2) : "collecting"} dim={!graded} />
            <Stat label="v2 net after fees" value={graded ? fmtCents(c.ev_v2) : "collecting"} dim={!graded} />
            <Stat label="Chair net, same windows" value={graded ? fmtCents(c.ev_v1) : "collecting"} dim={!graded} />
            <Stat label="Brier v2" value={graded ? fmtBrier(c.brier_v2) : "collecting"} dim={!graded} />
            <Stat label="Brier market" value={graded ? fmtBrier(c.brier_market) : "collecting"} dim={!graded} />
            <Stat label="Fit on" value={c.model.weights_n > 0 ? `${c.model.weights_n} windows` : "not yet fit"} dim={c.model.weights_n === 0} />
            <Stat label="Last fit" value={c.model.fitted_at ? utcStamp(c.model.fitted_at) : "—"} dim={!c.model.fitted_at} />
          </dl>

          <div className="mt-4 border-t border-border pt-4">
            <div className="flex items-center justify-between gap-3 font-mono text-micro text-subtle">
              <span>Frozen gates · v2Gates() in {CHAIR_V2_SOURCE}</span>
              <span className="tabular">{gates ? `${gates.met} / 3` : "— / 3"}</span>
            </div>
            <ul className="mt-2 grid gap-2 font-mono text-micro text-muted sm:grid-cols-3">
              <li className="rounded-sm border border-border bg-canvas px-3 py-2">
                <div className="text-subtle">V2_GATE_SAMPLES</div>
                <div className="mt-1 tabular text-fg">{fmtCount(c.n_graded)} / {c.gate_rules.samples} graded</div>
                <div className="mt-1">{gateLabel(gates?.samplesOk ?? null)}</div>
              </li>
              <li className="rounded-sm border border-border bg-canvas px-3 py-2">
                <div className="text-subtle">V2_GATE_CALLS and ev_v2 &gt; 0</div>
                <div className="mt-1 tabular text-fg">{graded ? fmtCount(c.calls_v2) : "—"} / {c.gate_rules.calls} calls · net {graded ? fmtCents(c.ev_v2) : "—"}</div>
                <div className="mt-1">{gateLabel(gates?.callsOk ?? null)}</div>
              </li>
              <li className="rounded-sm border border-border bg-canvas px-3 py-2">
                <div className="text-subtle">brier_v2 &lt; brier_market</div>
                <div className="mt-1 tabular text-fg">{graded ? fmtBrier(c.brier_v2) : "—"} vs {graded ? fmtBrier(c.brier_market) : "—"}</div>
                <div className="mt-1">{gateLabel(gates?.brierOk ?? null)}</div>
              </li>
            </ul>
          </div>

          <p className="mt-3 font-mono text-micro leading-relaxed text-subtle">Live rule: {c.rule}.</p>
        </>
      )}
    </article>
  );
}

function ChairV3Panel({ card }: { card: ChairV3Card | null }) {
  const c = card;
  const scored = (c?.n_scored ?? 0) > 0;
  return (
    <article id="lab-chair-v3" className="scroll-mt-20 rounded-md border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-micro uppercase tracking-[0.18em] text-subtle">Shadow chair · {CHAIR_V3_SOURCE}</div>
          <h3 className="mt-1 font-sans text-title font-medium text-fg">Chair v3</h3>
        </div>
        <Standing standing={c?.standing ?? "unavailable"} />
      </div>

      <p className="mt-3 max-w-[72ch] font-sans text-ui leading-relaxed text-muted">
        Market prior plus a bounded ±{c?.max_adjustment_pp ?? 10}pp correction. No authority over the live Chair or paper book.
      </p>

      {!c || c.standing === "unavailable" ? (
        <Unavailable what="The Chair v3 walk-forward report" />
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Rows / scored" value={`${fmtCount(c.n_rows)} / ${fmtCount(c.n_scored)}`} />
            <Stat label="Model n" value={c.model_n && c.model_n > 0 ? String(c.model_n) : `under ${c.min_train}`} dim={!c.model_n} />
            <Stat label="Brier market" value={scored ? fmtBrier(c.market_brier) : "collecting"} dim={!scored} />
            <Stat label="Brier v3" value={scored ? fmtBrier(c.v3_brier) : "collecting"} dim={!scored} />
            <Stat label="Brier delta" value={scored ? fmtBrier(c.brier_delta) : "collecting"} dim={!scored} />
            <Stat label="Log loss market / v3" value={scored ? `${fmtBrier(c.market_log_loss)} / ${fmtBrier(c.v3_log_loss)}` : "collecting"} dim={!scored} />
            <Stat label="Avg |adjustment|" value={scored ? fmtPp(c.avg_abs_adjustment_pp) : "collecting"} dim={!scored} />
            <Stat label="Max |adjustment|" value={scored ? fmtPp(c.max_abs_adjustment_pp) : "collecting"} dim={!scored} />
          </dl>

          <div className="mt-4 border-t border-border pt-4">
            <div className="flex items-center justify-between gap-3 font-mono text-micro text-subtle">
              <span>Frozen gate · walk-forward points after V3_MIN_TRAIN ({c.min_train})</span>
              <span className="tabular">{c.gate ? `${Number(c.gate.brierOk)} / 1` : "— / 1"}</span>
            </div>
            <ul className="mt-2 grid gap-2 font-mono text-micro text-muted sm:grid-cols-2">
              <li className="rounded-sm border border-border bg-canvas px-3 py-2">
                <div className="text-subtle">v3_brier &lt; market_brier</div>
                <div className="mt-1 tabular text-fg">{scored ? fmtBrier(c.v3_brier) : "—"} vs {scored ? fmtBrier(c.market_brier) : "—"}</div>
                <div className="mt-1">{scored ? gateLabel(c.gate?.brierOk ?? null) : "no scored points yet"}</div>
              </li>
              <li className="rounded-sm border border-border bg-canvas px-3 py-2">
                <div className="text-subtle">n_scored after min_train</div>
                <div className="mt-1 tabular text-fg">{fmtCount(c.n_scored)} points · V3_MAX_ADJUSTMENT {c.max_adjustment_pp}pp</div>
                <div className="mt-1">a count, not a verdict</div>
              </li>
            </ul>
          </div>

          <p className="mt-3 font-mono text-micro leading-relaxed text-subtle">
            Strict walk-forward: every prediction uses only earlier closes, refit on the stored rows. Report as of {c.report_at ? utcStamp(c.report_at) : "—"}.
          </p>
        </>
      )}
    </article>
  );
}

export function ChairShadowLab({ v2, v3 }: { v2: ChairV2Card | null; v3: ChairV3Card | null }) {
  return (
    <section id="chair-shadow" className="mt-6 scroll-mt-20" aria-labelledby="chair-shadow-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-mono text-micro uppercase tracking-widest text-subtle">Shadow chairs · frozen scoreboards</div>
          <h2 id="chair-shadow-title" className="mt-1 font-sans text-title font-medium">Chair v2 and Chair v3, read-only</h2>
        </div>
        <div className="font-mono text-micro text-subtle">authority paper-only · none</div>
      </div>
      <p className="mt-3 max-w-[90ch] font-sans text-ui leading-relaxed text-muted">
        Two probability chairs run in shadow beside the live Chair and keep their own ledgers. These cards print those ledgers
        against the gates already written in their source files. Meeting a count is not promotion.
      </p>
      <p className="mt-2 max-w-[90ch] font-mono text-micro leading-relaxed text-subtle">
        Not to be confused: this is {CHAIR_V2_SOURCE} / {CHAIR_V3_SOURCE}, the shadow chairs. {NOT_THESE[0]} and {NOT_THESE[1]} are
        entry policies, scored in the entry-time study above. Same digits, different things.
      </p>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ChairV2Panel card={v2} />
        <ChairV3Panel card={v3} />
      </div>
    </section>
  );
}
