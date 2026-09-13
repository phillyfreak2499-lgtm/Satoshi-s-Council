import { cn } from "@/lib/utils";
import { FIXTURES, FIXTURE_IDS, type FixtureId } from "@/lib/chamber/fixtures.ts";
import { STATIONS, type ChamberState, type Figure, type Station } from "@/lib/chamber/states.ts";
import { InfoPanel } from "./InfoPanel";

const LABEL: Record<Station, { chip: string; title: string; sub: string }> = {
  OVERVIEW: { chip: "Overview", title: "Observation gallery", sub: "Experiment · Judgment · Integrity" },
  DAIS: { chip: "Satoshi", title: "The dais", sub: "Judgment" },
  LAB: { chip: "The Lab", title: "The Lab", sub: "Experiment" },
  OPS: { chip: "Operations", title: "Operations", sub: "Integrity" },
};

/**
 * The Chamber's HUD: a modern DOM overlay in the site's own design language, laid
 * over the low-poly room. Every control is a real button; the canvas beneath
 * receives taps wherever the overlay is transparent.
 */
export function Hud({
  station,
  onStation,
  selected,
  onClear,
  state,
  fixture,
  onFixture,
  showDev,
  reduced,
  loading,
}: {
  station: Station;
  onStation: (s: Station) => void;
  selected: Figure | null;
  onClear: () => void;
  state: ChamberState;
  fixture: FixtureId;
  onFixture: (id: FixtureId) => void;
  showDev: boolean;
  reduced: boolean;
  loading: boolean;
}) {
  const chips = (
    <>
      {STATIONS.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onStation(s)}
          aria-pressed={station === s}
          className={cn("btn btn-secondary btn-sm", station === s && "bg-surface-2 text-fg")}
        >
          {LABEL[s].chip}
        </button>
      ))}
    </>
  );
  const here = LABEL[station];
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="pointer-events-auto rounded-lg border border-border bg-bg/70 px-3 py-2 backdrop-blur">
          <p className="font-mono text-micro uppercase tracking-widest text-subtle">The Chamber</p>
          <p className="font-sans text-title font-medium text-fg">{here.title}</p>
          <p className="font-mono text-micro text-muted">{here.sub}</p>
        </div>
        <nav aria-label="Chamber stations" className="pointer-events-auto hidden flex-wrap justify-end gap-1 sm:flex">
          {chips}
        </nav>
      </div>

      <div className="flex-1" />

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="pointer-events-auto flex min-w-0 flex-col gap-2">
          <p className="font-mono text-micro uppercase tracking-widest text-subtle">Presentation fixture · not connected to the desk</p>
          {showDev ? (
            <label className="flex items-center gap-2 font-mono text-micro text-subtle">
              <span className="uppercase tracking-widest">Dev fixture</span>
              <select
                value={fixture}
                onChange={(e) => onFixture(e.target.value as FixtureId)}
                className="rounded-md border border-border bg-surface px-2 py-1 font-mono text-data text-fg"
                aria-label="Development fixture — presentation state only"
              >
                {FIXTURE_IDS.map((id) => (
                  <option key={id} value={id}>
                    {FIXTURES[id].label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {reduced ? <p className="font-mono text-micro text-subtle">Reduced motion · camera cuts, no ambient motion</p> : null}
        </div>
        {selected ? (
          <InfoPanel figure={selected} state={state} onClose={onClear} />
        ) : station !== "OVERVIEW" ? (
          <button type="button" className="pointer-events-auto btn btn-secondary btn-sm" onClick={() => onStation("OVERVIEW")}>
            Return to overview
          </button>
        ) : null}
      </div>

      <nav aria-label="Chamber stations" className="pointer-events-auto mt-3 flex flex-wrap justify-center gap-1 sm:hidden">
        {chips}
      </nav>

      {loading ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-live="polite">
          <p className="font-mono text-micro uppercase tracking-widest text-subtle">Loading the chamber…</p>
        </div>
      ) : null}
    </div>
  );
}
