/**
 * SECTION 1 — the live decision strip.
 *
 * Everything a reader needs in the first ten seconds, in one band: where Bitcoin
 * sits against the line, what the two sides cost, what the desk's own model
 * makes of it, what SATOSHI concluded, and how long is left. On a phone it is a
 * two-column grid that never needs sideways scrolling.
 */
import { useCountdownText } from "@/lib/desk/hooks";
import { clockMs } from "@/lib/desk/math";
import { cn } from "@/lib/utils";
import { fmtDistance, fmtScore, fmtUsd, type ProFloorFacts } from "@/lib/desk/pro-floor";
import { CentsCell, KindTag } from "./panels";
import { leanTone } from "./tones";

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
  label: string;
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
  const { market, quotes, model, conclusion, standard, health } = facts;
  const ticking = useCountdownText(market.close_time);
  // The shared ticker has no server snapshot; print the time left as of the
  // frame until it starts ticking in the browser.
  const left =
    ticking === "—" && market.secs_left != null ? clockMs(Math.max(0, market.secs_left * 1000)) : ticking;
  const tone = leanTone(conclusion.lean);

  return (
    <section
      aria-label="Live decision strip"
      className={cn(
        "rounded-md border bg-surface p-3 sm:p-4",
        conclusion.lean === "UP" ? "border-up/40" : conclusion.lean === "DOWN" ? "border-down/40" : "border-border-strong",
      )}
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
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

        <Cell
          label="SATOSHI"
          sub={
            standard.evidence == null || standard.required == null
              ? "score comparison unavailable"
              : `evidence ${fmtScore(standard.evidence)} / required ${fmtScore(standard.required)}`
          }
        >
          <span className={cn("text-title font-medium", tone)} aria-live="polite">
            <span className="sr-only">House conclusion: </span>
            {conclusion.lean}
          </span>
          <div className="font-mono text-micro text-subtle">
            gate confidence {conclusion.confidence.value}
          </div>
        </Cell>

        <Cell
          label="Time"
          sub={
            <span className={health.all_clear ? "text-subtle" : "text-wait"}>
              {health.all_clear ? "feeds live" : `feeds: spot ${health.spot} · book ${health.kalshi}`}
            </span>
          }
        >
          <span className="text-title">{left}</span>
          <div className="truncate font-mono text-micro text-subtle">{market.phase.toLowerCase()}</div>
        </Cell>
      </div>
    </section>
  );
}
