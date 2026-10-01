import { useEffect, useState } from "react";
import type { ProFloorFacts } from "@/lib/desk/pro-floor";
import { useCountdownText } from "@/lib/desk/hooks";
import { leanTone } from "./tones";
import { cn } from "@/lib/utils";
import { DecisionLayerMark } from "../DecisionLayerMark";
import { clockMs } from "@/lib/desk/math";

/** A compact, read-only repeat of the same frame; never an admission path. */
export function StickyDecisionHeader({ facts }: { facts: ProFloorFacts }) {
  const [headerInset, setHeaderInset] = useState<number | null>(null);
  useEffect(() => {
    const header = document.querySelector(".council-site-header");
    if (!header) return;
    const measure = () => setHeaderInset(Math.ceil(header.getBoundingClientRect().height));
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(header);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  const countdown = useCountdownText(facts.market.close_time);
  const left = countdown === "—" && facts.market.secs_left != null
    ? clockMs(Math.max(0, facts.market.secs_left * 1000)) : countdown;
  return <aside aria-label="Current decision and paper position" style={{ top: headerInset ?? "var(--header-h)" }} className="pro-sticky-status sticky z-20 grid grid-cols-3 gap-2 rounded-sm border border-border-strong bg-surface p-3 shadow-lg">
    <div><p><DecisionLayerMark layer="decision" compact /></p><strong className={cn("font-mono text-ui", leanTone(facts.conclusion.lean))}>{facts.conclusion.lean}</strong></div>
    <div><p className="font-sans text-micro text-muted">Window closes in</p><strong className="font-mono text-ui tabular text-fg">{left}</strong></div>
    <div className="border-l-4 border-border-strong pl-2"><p><DecisionLayerMark layer="position" compact /></p><strong className="font-mono text-ui text-fg">{facts.paper.held ? "HELD" : "NONE"}</strong></div>
  </aside>;
}
