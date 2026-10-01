import type { ProFloorFacts } from "@/lib/desk/pro-floor";
import { useCountdownText } from "@/lib/desk/hooks";
import { leanTone } from "./tones";
import { cn } from "@/lib/utils";
import { DecisionLayerMark } from "../DecisionLayerMark";
import { clockMs } from "@/lib/desk/math";

/** Compact operator status. It becomes sticky only on large screens so it never
 * consumes a phone viewport, and the quick-link rail is intentionally outside
 * the sticky site header. */
export function StickyDecisionHeader({ facts }: { facts: ProFloorFacts }) {
  const countdown = useCountdownText(facts.market.close_time);
  const left = countdown === "—" && facts.market.secs_left != null
    ? clockMs(Math.max(0, facts.market.secs_left * 1000)) : countdown;
  const health = facts.health.all_clear
    ? "feeds live"
    : facts.health.blockers.length === 1
      ? facts.health.blockers[0]
      : `${facts.health.blockers.length} feed checks not clear`;
  return <aside aria-label="Current decision and paper position" style={{ top: "var(--header-h)" }} className="pro-sticky-status z-20 grid grid-cols-3 gap-2 rounded-sm border border-border-strong bg-surface p-3 shadow-lg lg:sticky">
    <div>
      <p><DecisionLayerMark layer="decision" compact /></p>
      <strong className={cn("font-mono text-ui", leanTone(facts.conclusion.lean))}>{facts.conclusion.lean}</strong>
      <div className="font-mono text-micro text-subtle">gate confidence {facts.conclusion.confidence.value}</div>
    </div>
    <div>
      <p className="font-sans text-micro text-muted">Window closes in</p>
      <strong className="font-mono text-ui tabular text-fg">{left}</strong>
      <div className={cn("font-mono text-micro", facts.health.all_clear ? "text-subtle" : "text-wait")}>{health}</div>
    </div>
    <div className="border-l-4 border-border-strong pl-2">
      <p><DecisionLayerMark layer="position" compact /></p>
      <strong className="font-mono text-ui text-fg">{facts.paper.held ? "HELD" : "NONE"}</strong>
      <div className="font-mono text-micro text-subtle">{facts.paper.held ? "paper position on book" : "no position booked"}</div>
    </div>
  </aside>;
}
