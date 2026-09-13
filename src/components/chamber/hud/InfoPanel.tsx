import { cn } from "@/lib/utils";
import { stateWord, type ChamberState, type Figure } from "@/lib/chamber/states.ts";

const WHO: Record<Figure, { place: string; role: string }> = {
  SATOSHI: { place: "The dais", role: "Chairs the vote. Judgment." },
  ALCHEMIST: { place: "The Lab", role: "Runs the experiments. Experiment." },
  WARDEN: { place: "Operations", role: "Keeps the feeds honest. Integrity." },
};

/** HUD colour is the SITE's language — including the existing gold WAIT — not the room's. */
function tone(figure: Figure, st: ChamberState): string {
  if (figure === "SATOSHI") {
    if (st.satoshi === "DIRECTIONAL") return st.direction === "UP" ? "text-up" : st.direction === "DOWN" ? "text-down" : "text-muted";
    if (st.satoshi === "CONSIDERING" || st.satoshi === "WAIT") return "text-wait";
    return "text-muted";
  }
  if (figure === "ALCHEMIST") return st.alchemist === "ACTIVE" ? "text-wait" : st.alchemist === "INSPECTING" ? "text-muted" : "text-subtle";
  return st.warden === "ALERT" ? "text-danger" : st.warden === "INVESTIGATING" ? "text-wait" : "text-up";
}

export function InfoPanel({ figure, state, onClose }: { figure: Figure; state: ChamberState; onClose: () => void }) {
  const who = WHO[figure];
  return (
    <section
      aria-label={`${figure} — details`}
      className="pointer-events-auto w-full rounded-lg sm:w-80 border border-border bg-surface/95 p-4 shadow-lg backdrop-blur"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-micro uppercase tracking-widest text-subtle">{who.place}</p>
          <h2 className="font-sans text-title font-medium text-fg">{figure}</h2>
        </div>
        <button type="button" onClick={onClose} className="btn btn-secondary btn-sm" aria-label="Close details">
          Close
        </button>
      </div>
      <p className="mt-2 font-sans text-ui text-muted">{who.role}</p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-data">
        <dt className="text-subtle">state</dt>
        <dd className={cn("uppercase tracking-wide", tone(figure, state))}>{stateWord(figure, state)}</dd>
      </dl>
      <p className="mt-3 font-mono text-micro text-subtle">Presentation fixture — not live desk state. Nothing here is a call, a claim or an alert.</p>
    </section>
  );
}
