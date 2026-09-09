import { useEffect, useRef, useState } from "react";
import { SEAT_IDS, type Lean, type SeatId, type SeatRow } from "@/lib/desk/types";
import { SEAT_BY_ID } from "@/lib/desk/seats";
import { cn } from "@/lib/utils";
import { Tip } from "./Tip";

const TONE: Record<Lean, string> = { UP: "text-up", DOWN: "text-down", WAIT: "text-wait" };
const PIP: Record<Lean, string> = { UP: "bg-up", DOWN: "bg-down", WAIT: "bg-wait" };

/** The vote in words, for readers who do not see the colour. */
function voteWords(lean: Lean): string {
  return lean === "UP" ? "votes up" : lean === "DOWN" ? "votes down" : "waits";
}

function Cell({
  r,
  flash,
  active,
  onHover,
  onLeave,
  onToggle,
}: {
  r: SeatRow;
  flash: boolean;
  active: boolean;
  onHover: () => void;
  onLeave: () => void;
  onToggle: () => void;
}) {
  const sitting = r.lean === "WAIT";
  const conf = Math.max(0, Math.min(100, r.conf));
  return (
    <div role="listitem" className="min-w-0">
      <button
        type="button"
        id={`chamber-${r.seat}`}
        aria-expanded={active}
        aria-controls="chamber-thesis"
        aria-label={`${r.seat} (${r.callsign}) ${voteWords(r.lean)} at ${r.conf} confidence`}
        onMouseEnter={onHover}
        onMouseLeave={onLeave}
        onFocus={onHover}
        onBlur={onLeave}
        onClick={onToggle}
        className={cn(
          "w-full min-h-11 rounded-md border bg-surface px-2.5 py-2 text-left transition-colors duration-200 ease-out",
          active ? "border-border-strong bg-surface-2" : "border-border hover:border-border-strong",
        )}
      >
        <div className="flex items-baseline justify-between gap-1">
          <span className="truncate font-mono text-data text-fg">{r.seat}</span>
          <span className="truncate font-mono text-micro text-subtle">{r.callsign}</span>
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <span aria-hidden="true" className={cn("inline-block size-2 shrink-0 rounded-full", PIP[r.lean], sitting && "opacity-60", flash && "pip-flash")} />
          <span className={cn("font-mono text-data font-medium", TONE[r.lean], sitting && "opacity-70")}>{r.lean}</span>
          <span className="ml-auto font-mono text-micro tabular text-muted">{r.conf}</span>
        </div>
        <div className="mt-1.5 h-0.5 w-full overflow-hidden rounded-sm bg-surface-3" aria-hidden="true">
          <div className={cn("h-full transition-[width] duration-[250ms] ease-out", PIP[r.lean], sitting && "opacity-50")} style={{ width: `${conf}%` }} />
        </div>
      </button>
    </div>
  );
}

/**
 * The chamber: the voting seats in one grid, in desk order so a seat is always
 * in the same place. A cell is the seat's name, its vote in words with a pip,
 * how sure, and a thin confidence bar; hover or tap a seat and its thesis reads
 * out in the line below the grid. The pip beats once, 250ms, when a vote changes.
 * Nothing moves at rest. The full research table lives under diagnostics.
 */
export function Chamber({ rows, onJump }: { rows: SeatRow[]; onJump: (seat: SeatId) => void }) {
  const byId = new Map(rows.map((r) => [r.seat, r] as const));
  const [pinned, setPinned] = useState<SeatId | null>(null);
  const [hover, setHover] = useState<SeatId | null>(null);
  const [flash, setFlash] = useState<ReadonlySet<SeatId>>(() => new Set());
  const [sitOpen, setSitOpen] = useState(false);
  const prev = useRef<Map<SeatId, Lean>>(new Map());
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const changed: SeatId[] = [];
    for (const r of rows) {
      const p = prev.current.get(r.seat);
      if (p !== undefined && p !== r.lean) changed.push(r.seat);
      prev.current.set(r.seat, r.lean);
    }
    if (!changed.length) return;
    setFlash(new Set(changed));
    const t = window.setTimeout(() => setFlash(new Set()), 300);
    return () => window.clearTimeout(t);
  }, [rows]);

  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && e.target instanceof Node && !root.current.contains(e.target)) setPinned(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPinned(null);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [pinned]);

  const shownId = pinned ?? hover;
  const shown = shownId ? byId.get(shownId) : undefined;
  const order = SEAT_IDS.filter((id) => byId.has(id));
  const speakingIds = order.filter((id) => byId.get(id)!.lean !== "WAIT");
  const sittingIds = order.filter((id) => byId.get(id)!.lean === "WAIT");
  const meta = shown ? SEAT_BY_ID[shown.seat] : null;
  const gridCls = "grid grid-cols-2 gap-2 min-[380px]:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6";
  const cell = (id: (typeof order)[number]) => {
    const r = byId.get(id)!;
    return (
      <Cell
        key={id}
        r={r}
        flash={flash.has(id)}
        active={shownId === id}
        onHover={() => setHover(id)}
        onLeave={() => setHover((h) => (h === id ? null : h))}
        onToggle={() => setPinned((p) => (p === id ? null : id))}
      />
    );
  };

  return (
    <section ref={root} aria-labelledby="chamber-title" data-tour="tour-chamber" className="min-w-0">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="chamber-title" className="font-mono text-micro uppercase tracking-widest text-subtle">
          <Tip k="pane.seats">The chamber</Tip> · {rows.length} seats
        </h2>
        <span className="font-mono text-micro text-subtle">
          {speakingIds.length} speaking · {sittingIds.length} sitting
        </span>
      </div>
      {speakingIds.length ? (
        <div role="list" aria-label="Seats speaking a direction" className={gridCls}>
          {speakingIds.map(cell)}
        </div>
      ) : (
        <p className="rounded-md border border-border bg-surface px-3 py-2 font-mono text-micro text-subtle">
          The desk is sitting — no seat is speaking a direction this window. That is a call, not a fault.
        </p>
      )}
      {sittingIds.length ? (
        <>
          <button
            type="button"
            onClick={() => setSitOpen((v) => !v)}
            aria-expanded={sitOpen}
            className="mt-2 flex min-h-11 w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 font-mono text-micro uppercase tracking-widest text-subtle hover:text-fg lg:hidden"
          >
            <span>{sittingIds.length} sitting</span>
            <span aria-hidden="true">{sitOpen ? "collapse" : "expand"}</span>
          </button>
          <div role="list" aria-label="Sitting seats" className={cn(gridCls, "mt-2", sitOpen ? "" : "hidden lg:grid")}>
            {sittingIds.map(cell)}
          </div>
        </>
      ) : null}
      <div id="chamber-thesis" aria-live="polite" className="mt-2 min-h-[3.5rem] rounded-md border border-border bg-surface px-3 py-2">
        {shown && meta ? (
          <>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-mono text-data text-fg">
                {shown.seat} <span className="text-subtle">{meta.callsign}</span>
              </span>
              <span className={cn("font-mono text-data", TONE[shown.lean])}>
                {shown.lean} {shown.conf}
              </span>
              <span className="font-mono text-micro text-muted">
                {shown.skill_used} · {shown.status}
                {shown.health !== "LIVE" ? ` · feed ${shown.health}` : ""}
              </span>
              <span className="font-mono text-micro tabular text-muted">
                rank {shown.rank} · {shown.calls} calls · avg {shown.scalp_avg == null ? "—" : `${shown.scalp_avg >= 0 ? "+" : ""}${shown.scalp_avg.toFixed(1)}¢`} · weight{" "}
                {shown.contribution >= 0 ? "+" : ""}
                {shown.contribution.toFixed(3)}
              </span>
              <span className="ml-auto flex gap-1">
                <button type="button" onClick={() => onJump(shown.seat)} className="btn btn-secondary btn-sm">
                  open the seat
                </button>
                <a href={`/seat/${shown.seat}`} className="btn btn-secondary btn-sm">
                  seat page ↗
                </a>
              </span>
            </div>
            <p className="mt-1 font-sans text-ui text-fg">
              {shown.why}
              <span className="text-subtle"> · reads {meta.eyes}</span>
            </p>
          </>
        ) : (
          <p className="font-mono text-micro text-subtle">
            Each cell is one seat: its vote in words, a pip in the vote&apos;s colour, how sure, and a thin bar for confidence. Hover or tap a seat to read its
            thesis; the pip beats once when a vote changes.
          </p>
        )}
      </div>
    </section>
  );
}
