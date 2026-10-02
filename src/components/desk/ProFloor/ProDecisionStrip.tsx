/**
 * SECTION 1 — the live decision strip.
 *
 * Market context beneath the operator status: where Bitcoin sits against the
 * line, what the two sides cost, and what the desk's own model makes of it.
 * SATOSHI's decision, time, feed health and paper position live once in the
 * operator status above instead of being duplicated here.
 */
import { cn } from "@/lib/utils";
import { fmtDistance, fmtUsd, type ProFloorFacts } from "@/lib/desk/pro-floor";
import { CentsCell, KindTag } from "./panels";

const RELATION_WORD: Record<ProFloorFacts["market"]["relation"], string> = {
  ABOVE: "above the line",
  BELOW: "below the line",
  "AT LINE": "exactly on the line",
  UNKNOWN: "distance unavailable",
};

function Cell({
  label,
  children,
  sub,
  className,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  sub?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="font-mono text-micro uppercase tracking-wider text-subtle">{label}</div>
      <div className="font-mono text-data tabular text-fg">{children}</div>
      {sub ? <div className="mt-0.5 truncate font-mono text-micro text-subtle">{sub}</div> : null}
    </div>
  );
}

export function ProDecisionStrip({ facts }: { facts: ProFloorFacts }) {
  const { market, quotes, model, conclusion } = facts;

  return (
    <section
      aria-label="Live decision strip"
      className={cn(
        "rounded-md border bg-surface p-3 sm:p-4",
        conclusion.lean === "UP" ? "border-up/40" : conclusion.lean === "DOWN" ? "border-down/40" : "border-border-strong",
      )}
    >
      <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3">
        <Cell
          label="BTC / line"
          sub={
            market.strike == null
              ? "no strike on this frame"
              : `${fmtUsd(market.strike)} strike · ${market.spot_source || "spot"}`
          }
        >
          {fmtUsd(market.spot)}
          <div
            className={cn(
              "font-mono text-micro tabular",
              market.relation === "ABOVE" ? "text-up" : market.relation === "BELOW" ? "text-down" : "text-subtle",
            )}
          >
            {fmtDistance(market.distance)} <span className="text-subtle">{RELATION_WORD[market.relation]}</span>
          </div>
        </Cell>

        <Cell
          label="Market"
          sub={
            <>
              spread <CentsCell f={quotes.spread} />
              {quotes.yes_size == null ? null : ` · ${Math.round(quotes.yes_size).toLocaleString("en-US")} resting YES`}
            </>
          }
        >
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span>
              YES <CentsCell f={quotes.yes_ask} />
            </span>
            <span className="text-subtle">·</span>
            <span>
              NO <CentsCell f={quotes.no_ask} />
            </span>
          </div>
        </Cell>

        <Cell
          label="Desk value"
          sub={
            model.side == null
              ? "an edge needs a side; none is being priced"
              : model.edge.cents == null
                ? model.edge.unavailable_why
                : `fee ${model.fee.cents?.toFixed(1) ?? "—"}¢ on the ${model.side === "UP" ? "YES" : "NO"} side`
          }
        >
          <span>
            <CentsCell f={model.fair_yes} />
            <KindTag kind="derived" />
          </span>
          <div
            className={cn(
              "font-mono text-micro tabular",
              model.edge.cents == null ? "text-subtle" : model.edge.cents >= 0 ? "text-up" : "text-down",
            )}
          >
            edge <CentsCell f={model.edge} signed />
          </div>
        </Cell>

      </div>
    </section>
  );
}
