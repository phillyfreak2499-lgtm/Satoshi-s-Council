import { DIRECTIONAL_LEAN_DISCLAIMER, GUIDED_LEAN_VISIBLE, GUIDED_WAITING_LEAD, guidedLeanOrder, leanKey, researchLeanCountLine, type SeatLean } from "@/lib/desk/seat-lean";
import { SeatLeanMeter } from "./SeatLeanMeter";
import { DecisionLayerMark } from "./DecisionLayerMark";

function LeanCard({ l }: { l: SeatLean }) {
  return (
    <li key={leanKey(l)} className="rounded-sm border border-border bg-surface-2 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <a href={`/seat/${l.seat}`} className="font-mono text-ui text-fg underline-offset-4 hover:underline">
          {l.seat} <span className="text-subtle">{l.callsign}</span>
        </a>
      </div>
      <SeatLeanMeter lean={l} mode="guided" className="mt-2" />
    </li>
  );
}

/**
 * "What each specialist sees" — the Guided Floor's per-seat Directional Lean.
 * Presentation only: it sorts and folds what the read model already produced.
 * Directional reads first (strongest first, the rest folded after
 * GUIDED_LEAN_VISIBLE); neutral and no-read seats fold below. It never
 * invents a direction, and it sits below the SATOSHI verdict, never above it.
 */
export function SpecialistLeans({ leans, waiting = false }: { leans: SeatLean[]; waiting?: boolean }) {
  const sorted = [...leans].sort(guidedLeanOrder);
  const directional = sorted.filter((l) => l.score != null && l.direction !== "NEUTRAL");
  const quiet = sorted.filter((l) => !(l.score != null && l.direction !== "NEUTRAL"));
  const shown = directional.slice(0, GUIDED_LEAN_VISIBLE);
  const more = directional.slice(GUIDED_LEAN_VISIBLE);
  return (
    <section aria-labelledby="guided-leans" className="rounded-md border border-border bg-surface p-5 sm:p-6">
      <p className="font-sans text-micro uppercase tracking-widest text-subtle">Follow a specialist</p>
      <h2 id="guided-leans" className="mt-2 font-sans text-title font-medium text-fg">What each specialist sees</h2>
      {waiting ? <p className="mt-2 max-w-[68ch] font-sans text-body leading-relaxed text-fg">{GUIDED_WAITING_LEAD}</p> : null}
      <p className="mt-3"><DecisionLayerMark layer="research" /></p>
      <p className="mt-2 max-w-[68ch] font-sans text-body leading-relaxed text-muted">
        A directional lean is a specialist’s bullish or bearish research opinion. A counted read is a directional vote SATOSHI heard. A seat can lean while the Council waits; neither is a paper position.
      </p>
      <p className="mt-2 max-w-[68ch] font-sans text-micro leading-relaxed text-subtle">{DIRECTIONAL_LEAN_DISCLAIMER}</p>
      <p className="mt-2 font-sans text-micro text-subtle">{researchLeanCountLine(leans)}</p>
      {shown.length ? (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {shown.map((l) => <LeanCard key={leanKey(l)} l={l} />)}
        </ul>
      ) : (
        <p className="mt-4 font-sans text-ui text-muted">No bullish or bearish research lean is retained in this snapshot. Leans can change with the next tick.</p>
      )}
      {more.length ? (
        <details className="mt-3 font-mono text-micro text-subtle">
          <summary className="min-h-11 cursor-pointer py-2">{more.length} more directional {more.length === 1 ? "read" : "reads"}</summary>
          <ul className="mt-2 grid gap-3 sm:grid-cols-2">
            {more.map((l) => <LeanCard key={leanKey(l)} l={l} />)}
          </ul>
        </details>
      ) : null}
      {quiet.length ? (
        <details className="mt-4 font-mono text-micro text-subtle">
          <summary className="min-h-11 cursor-pointer py-2">{quiet.length} {quiet.length === 1 ? "seat is" : "seats are"} neutral or without a retained read</summary>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {quiet.map((l) => <LeanCard key={leanKey(l)} l={l} />)}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
