/**
 * SECTION 3 — distance to the decision standard.
 *
 * The one visualization that makes a WAIT legible: how far the weighted evidence
 * is from the bar it has to clear. The numbers are the Chair's OWN comparison —
 * `vs_bar` against `bar`, with the verdict read off the Chair's `bar` gate —
 * never a second calculation.
 *
 * It refuses to promise a call. When another gate is also failing the caption
 * says so, because closing this gap alone would not produce one.
 */
import { cn } from "@/lib/utils";
import { fmtScore, type ProFloorFacts } from "@/lib/desk/pro-floor";
import { Panel } from "./panels";

/** The drawn scale. The bar can move, so the track is sized to hold both. */
function scaleMax(evidence: number, required: number): number {
  return Math.max(0.8, evidence * 1.15, required * 1.35);
}

export function ProScoreBar({ facts }: { facts: ProFloorFacts }) {
  const s = facts.standard;
  const unavailable = s.evidence == null || s.required == null;
  const cleared = s.met === true;
  const margin = s.margin;

  return (
    <Panel
      id="standard"
      title="Distance to the decision standard"
      note="The weighted evidence against the bar it has to clear. Both numbers are the Chair's own — the same comparison its gate records."
    >
      {unavailable ? (
        <p className="mt-3 font-sans text-ui text-muted">
          The Chair did not publish a score comparison on this frame, so there is nothing to draw. That is not a zero.
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className={cn("font-mono text-title tabular", cleared ? "text-up" : "text-wait")}>
              {fmtScore(s.evidence)}
            </span>
            <span className="font-mono text-ui text-subtle">/ {fmtScore(s.required)} required</span>
            <span
              className={cn(
                "rounded-sm border px-1.5 py-px font-mono text-micro uppercase tracking-wide",
                cleared ? "border-up/40 bg-up/10 text-up" : "border-wait/40 bg-wait/10 text-wait",
              )}
            >
              {margin == null
                ? "margin unavailable"
                : cleared
                  ? `cleared by +${margin.toFixed(2)}`
                  : `short by ${Math.abs(margin).toFixed(2)}`}
            </span>
          </div>

          <div
            className="relative mt-3 h-5 overflow-hidden rounded-sm border border-border bg-bg"
            role="img"
            aria-label={`Weighted evidence ${fmtScore(s.evidence)} against a required ${fmtScore(s.required)}; ${
              cleared ? "the standard is met" : "the standard is not met"
            }.`}
          >
            <div
              className={cn("absolute inset-y-0 left-0", cleared ? "bg-up/30" : "bg-wait/25")}
              style={{ width: `${Math.min(100, (s.evidence! / scaleMax(s.evidence!, s.required!)) * 100)}%` }}
            />
            <div
              className="absolute inset-y-0 w-0.5 bg-fg"
              style={{ left: `${Math.min(100, (s.required! / scaleMax(s.evidence!, s.required!)) * 100)}%` }}
              title={`required ${fmtScore(s.required)}`}
            />
          </div>
          <div className="mt-1 flex justify-between font-mono text-micro text-subtle">
            <span>weighted evidence</span>
            <span>required bar</span>
          </div>

          <p className="mt-3 max-w-[80ch] font-sans text-ui leading-relaxed text-muted">
            {s.more_than_one_thing_missing
              ? "Evidence is not the only thing missing — another gate is blocking too. No single change guarantees a call."
              : cleared
                ? "The weighted evidence clears its standard on this frame. Whether a call follows still depends on every other gate below."
                : "The specialists do not currently agree hard enough for the weighted evidence to reach its bar. Closing that gap is necessary, not sufficient: the gates below still apply."}
          </p>

          <p className="mt-2 font-mono text-micro leading-relaxed text-subtle">
            {s.gate_value ? `Chair gate: ${s.gate_value}. ` : ""}
            Raw score {fmtScore(s.score)} × aggressiveness {s.aggressiveness == null ? "—" : s.aggressiveness.toFixed(2)}.
            This is a decision standard, not a chance of winning.
          </p>
        </>
      )}
    </Panel>
  );
}
