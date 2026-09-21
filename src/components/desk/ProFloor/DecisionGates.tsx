/**
 * SECTION 7 — the decision gates.
 *
 * A short summary of what is blocking, with the full checklist behind a
 * disclosure. These are the Chair's own gates, rendered — there is no second
 * decision engine here and no gate is re-evaluated.
 */
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { Gate } from "@/lib/desk/types";
import type { ProFloorFacts } from "@/lib/desk/pro-floor";
import { GateDot, Panel } from "./panels";

function GateRow({ g }: { g: Gate }) {
  return (
    <li className="flex items-start gap-2 border-t border-border py-1.5 first:border-t-0">
      <GateDot pass={g.pass} hard={g.hard} />
      <span
        className={cn(
          "w-[3.25rem] shrink-0 font-mono text-micro uppercase tracking-wide",
          g.pass ? "text-subtle" : g.hard ? "text-down" : "text-wait",
        )}
      >
        {g.pass ? "clear" : g.hard ? "block" : "tax"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="font-sans text-ui leading-snug text-muted">{g.label}</span>
        {g.value ? <span className="block break-words font-mono text-micro text-subtle">{g.value}</span> : null}
      </span>
      <span className="shrink-0 font-mono text-micro text-subtle">{g.hard ? "hard" : "soft"}</span>
    </li>
  );
}

export function DecisionGates({ facts, onExpand }: { facts: ProFloorFacts; onExpand?: () => void }) {
  const [open, setOpen] = useState(false);
  const { blocking, soft_failing, all } = facts.gates;
  // A short, honest summary: what is blocking first, then the taxes, then a
  // couple of the notable clear ones so the reader sees both sides.
  const summary: Gate[] = [
    ...blocking,
    ...soft_failing,
    ...facts.gates.passing.filter((g) => g.hard).slice(0, Math.max(0, 4 - blocking.length - soft_failing.length)),
  ].slice(0, 6);

  return (
    <Panel
      id="gates"
      title="Decision gates"
      note="A hard gate blocks a call outright. A soft gate raises the bar rather than stopping anything."
      right={
        <span className={cn("font-mono text-micro", blocking.length ? "text-down" : "text-up")}>
          {blocking.length ? `${blocking.length} blocking` : "nothing blocking"}
        </span>
      }
    >
      <ul className="mt-2">
        {summary.length ? summary.map((g) => <GateRow key={g.id} g={g} />) : (
          <li className="py-2 font-sans text-ui text-muted">The Chair published no gates on this frame.</li>
        )}
      </ul>

      {all.length > summary.length ? (
        <button
          type="button"
          className="btn btn-secondary btn-sm mt-3 min-h-11"
          aria-expanded={open}
          onClick={() => {
            setOpen((v) => {
              if (!v) onExpand?.();
              return !v;
            });
          }}
        >
          {open ? "Hide the full checklist" : `View all ${all.length} gates`}
        </button>
      ) : null}

      {open ? (
        <ul className="mt-3 border-t border-border pt-1">
          {all.map((g) => (
            <GateRow key={g.id} g={g} />
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}
