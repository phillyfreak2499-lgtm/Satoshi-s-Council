/**
 * SECTION 4 — market against model.
 *
 * Two columns because they are two different kinds of number: on the left what
 * the exchange is quoting, on the right what the desk's own model makes of it.
 * Nothing is recomputed — every figure is carried from `economicsOf`, which
 * itself carries them from the snapshot the engine built.
 */
import { cn } from "@/lib/utils";
import { fmtContracts } from "@/lib/desk/floor-clarity";
import type { ProFloorFacts } from "@/lib/desk/pro-floor";
import { CentsCell, KindTag, Panel, StatBox } from "./panels";

function Row({ label, value, sub }: { label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-border py-1.5 first:border-t-0">
      <span className="font-mono text-micro uppercase tracking-wider text-subtle">{label}</span>
      <span className="text-right font-mono text-data tabular">
        {value}
        {sub ? <span className="block font-mono text-micro text-subtle">{sub}</span> : null}
      </span>
    </div>
  );
}

export function MarketModelCard({ facts, full }: { facts: ProFloorFacts; full: boolean }) {
  const { quotes, model, market } = facts;
  const sideWord = model.side == null ? null : model.side === "UP" ? "YES" : "NO";

  return (
    <Panel
      id="market-model"
      title="Market against model"
      note="The left column is what you could trade at. The right column is what the desk's model derives. They are different kinds of number and are never merged."
    >
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-sm border border-border bg-bg/40 p-3">
          <div className="font-mono text-micro uppercase tracking-widest text-muted">
            Market <span className="text-subtle">— executable</span>
          </div>
          <div className="mt-2">
            <Row label="YES ask" value={<CentsCell f={quotes.yes_ask} />} />
            <Row label="NO ask" value={<CentsCell f={quotes.no_ask} />} />
            <Row label="spread" value={<CentsCell f={quotes.spread} />} />
            <Row
              label="resting size"
              value={
                quotes.yes_size == null && quotes.no_size == null ? (
                  <span className="text-subtle">— unavailable</span>
                ) : (
                  <span className="text-fg">
                    {fmtContracts(quotes.yes_size)} <span className="text-subtle">YES</span> ·{" "}
                    {fmtContracts(quotes.no_size)} <span className="text-subtle">NO</span>
                  </span>
                )
              }
              sub="contracts at the touch"
            />
            {full ? <Row label="leftover" value={<CentsCell f={quotes.leftover} signed />} sub="100¢ less both asks" /> : null}
            {full ? (
              <Row
                label="bids"
                value={
                  <>
                    <CentsCell f={quotes.yes_bid} /> <span className="text-subtle">/</span>{" "}
                    <CentsCell f={quotes.no_bid} />
                  </>
                }
                sub="YES / NO"
              />
            ) : null}
          </div>
        </div>

        <div className="rounded-sm border border-border bg-bg/40 p-3">
          <div className="font-mono text-micro uppercase tracking-widest text-muted">
            Model <span className="text-subtle">— derived, not quoted</span>
          </div>
          <div className="mt-2">
            <Row
              label="fair YES"
              value={
                <>
                  <CentsCell f={model.fair_yes} />
                  <KindTag kind="derived" />
                </>
              }
              sub="a value the desk derived — not a chance of winning"
            />
            <Row
              label={sideWord ? `fee on ${sideWord}` : "fee"}
              value={<CentsCell f={model.fee} />}
              sub={model.side == null ? "no side is being priced" : undefined}
            />
            <Row
              label="priced against"
              value={
                <>
                  <CentsCell f={model.priced_ask} />
                  {model.priced_ask.cents == null ? null : <KindTag kind={model.priced_ask.kind} />}
                </>
              }
              sub={
                model.priced_ask_is_fallback
                  ? "no quoted ask on that side — the desk used its own mid, so the edge below is not measured against a price anyone is offering"
                  : model.priced_ask.cents == null
                    ? model.priced_ask.unavailable_why
                    : "the quoted ask on the side being read"
              }
            />
            <Row
              label="edge after fee"
              value={
                <span
                  className={cn(
                    model.edge.cents == null ? "" : model.edge.cents >= 0 ? "text-up" : "text-down",
                  )}
                >
                  <CentsCell f={model.edge} signed />
                </span>
              }
              sub={model.edge.cents == null ? model.edge.unavailable_why : "fair less the real ask less the fee"}
            />
            <Row
              label="breakeven"
              value={
                model.breakeven_pct == null ? (
                  <span className="text-subtle">— unavailable</span>
                ) : (
                  `${model.breakeven_pct.toFixed(0)}%`
                )
              }
              sub="the win rate this price needs to stand still"
            />
            {full ? (
              <Row
                label="lab fair YES"
                value={
                  <>
                    <CentsCell f={model.lab_fair_yes} />
                    {model.lab_fair_yes.cents == null ? null : <KindTag kind="derived" />}
                  </>
                }
                sub={
                  model.lab_fair_yes.cents == null
                    ? model.lab_fair_yes.unavailable_why
                    : `settlement-rule value · ${model.lab_age_s == null ? "age unknown" : `${Math.round(model.lab_age_s)}s old`}${
                        model.lab_locked ? ` · ${model.lab_locked}/60 prints locked` : ""
                      }`
                }
              />
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatBox
          label="paper floor"
          value={`${model.floor_cents}¢`}
          sub={model.bookable ? "this ask clears it" : "a read under it does not fill"}
          tone={model.bookable ? "text-up" : "text-wait"}
        />
        <StatBox
          label="settlement index"
          value={market.index == null ? "—" : `$${Math.round(market.index).toLocaleString("en-US")}`}
          sub={market.basis_bps == null ? "basis unavailable" : `${market.basis_bps >= 0 ? "+" : ""}${market.basis_bps.toFixed(0)} bps vs spot`}
          title="The contract settles on the index, not on the exchange print."
        />
        <StatBox
          label="spot age"
          value={market.spot_age_s == null ? "—" : `${Math.round(market.spot_age_s)}s`}
          sub={market.spot_source || "source unreported"}
        />
        <StatBox
          label="in the way"
          value={model.blocked_why ? "yes" : "nothing"}
          sub={model.blocked_why ?? "the book would pay this ask"}
          tone={model.blocked_why ? "text-wait" : "text-up"}
        />
      </div>
    </Panel>
  );
}
