import { cn } from "@/lib/utils";

export type DecisionLayer = "research" | "decision" | "position";

const COPY: Record<DecisionLayer, { glyph: string; label: string; tone: string }> = {
  research: { glyph: "○", label: "Research lean", tone: "border-sky-300/50 bg-sky-300/10 text-sky-200" },
  decision: { glyph: "◆", label: "SATOSHI decision", tone: "border-gold/60 bg-gold/10 text-gold" },
  position: { glyph: "■", label: "Paper position", tone: "border-fg/50 bg-fg text-bg" },
};

/** Permanent visual identity for the three public decision layers. */
export function DecisionLayerMark({ layer, className }: { layer: DecisionLayer; className?: string }) {
  const item = COPY[layer];
  return <span data-decision-layer={layer} className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-[0.14em]", item.tone, className)}>
    <span aria-hidden="true">{item.glyph}</span>{item.label}
  </span>;
}
