import type { ReactNode } from "react";
import { clockMs, fmtAge, fmtC, fmtPct, fmtPx } from "@/lib/desk/math";
import type { ChairResult, Snapshot } from "@/lib/desk/types";
import { HealthDot, LeanChip, MarketChip, Mono } from "./bits";
import { Tip } from "./Tip";
import { readMarket } from "@/lib/desk/market-hours";
import { askCents } from "@/lib/desk/scalp";
import { cn } from "@/lib/utils";

function Cell({ k, gloss, v, sub }: { k: string; gloss: string; v: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-micro uppercase tracking-wider text-subtle">
        <Tip k={gloss}>{k}</Tip>
      </div>
      <div className="truncate font-mono text-data tabular text-fg">{v}</div>
      {sub ? <div className="truncate font-mono text-micro text-subtle">{sub}</div> : null}
    </div>
  );
}

export function TopStrip({
  snap,
  chair,
  demo,
  learn,
  graded,
  evAvg,
  evN,
  tz,
}: {
  snap: Snapshot | null;
  chair: ChairResult | null;
  demo: boolean;
  learn: string;
  graded: number;
  evAvg?: number;
  evN?: number;
  tz: string;
}) {
  if (!snap) {
    return (
      <div className="border-b border-border bg-surface px-3 py-2 font-mono text-ui text-muted">
        waiting on first snapshot…
      </div>
    );
  }
  const dist = snap.spot - snap.strike;
  const distPct = snap.spot ? dist / snap.spot : 0;
  const lean = chair?.lean ?? "WAIT";
  const conf = chair?.confidence ?? 0;
  const score = chair?.score ?? 0;
  const bar = chair?.bar ?? 0.3;
  const fill = Math.min(1, Math.abs(score) / Math.max(bar, 0.01));
  const market = readMarket(snap.as_of, snap.close_time);

  return (
    <div data-tour="tour-strip" className="border-b border-border bg-surface px-3 py-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {demo && (
            <Tip k="source.demo" mark={false}>
              <span className="rounded-sm border border-wait/50 bg-wait/15 px-1.5 py-px font-mono text-micro uppercase tracking-widest text-wait">
                DEMO
              </span>
            </Tip>
          )}
          <LeanChip lean={lean} cents={askCents(snap, lean)} className="px-2 py-0.5 text-ui" />
          <Tip k="strip.conf" mark={false}>
            <Mono className="text-title">
              {conf}
              <span className="text-subtle"> conf</span>
            </Mono>
          </Tip>
          <Tip k="strip.size" mark={false}>
            <Mono className="text-title">
              {chair?.size ?? 1}
              <span className="text-subtle"> size</span>
            </Mono>
          </Tip>
          <Tip k="strip.score" mark={false}>
            <div className="flex items-center gap-1">
              <div className="relative h-2 w-28 overflow-hidden rounded-sm bg-surface-3">
                <div className="absolute inset-y-0 left-1/2 w-px bg-border-strong" />
                <div
                  className={cn(
                    "absolute inset-y-0",
                    lean === "DOWN" ? "bg-down" : lean === "UP" ? "bg-up" : "bg-wait",
                  )}
                  style={
                    score >= 0
                      ? { left: "50%", width: `${fill * 50}%` }
                      : { right: "50%", width: `${fill * 50}%` }
                  }
                />
              </div>
              <Mono className="text-micro text-muted">
                |{Math.abs(score).toFixed(2)}| vs {bar.toFixed(2)}
              </Mono>
            </div>
          </Tip>
        </div>
        <div className="flex items-center gap-3">
          <Tip k="strip.clock" mark={false}>
            <Mono className="text-title text-fg">{clockMs(snap.secs_left * 1000)}</Mono>
          </Tip>
          <Tip k="strip.phase" mark={false}>
            <span className="rounded-sm border border-border px-1.5 py-px font-mono text-micro text-muted">
              {snap.phase}
            </span>
          </Tip>
          <span className="font-mono text-micro text-subtle">
            <Tip k="strip.learn">{learn}</Tip>
            {" · "}
            {graded} graded
            {learn === "EXPLORE" ? " · huddle /5" : learn === "CALIBRATE" ? " · huddle /10" : " · huddle /15"}
            {chair?.size_note ? ` · ${chair.size_note}` : ""}
            {evN ? (
              <>
                {" · "}
                <Tip k="strip.ev">
                  avg {evAvg! >= 0 ? "+" : ""}
                  {evAvg!.toFixed(1)}¢
                </Tip>
              </>
            ) : null}
          </span>
        </div>
      </div>
      <div className="mt-1.5">
        <MarketChip m={market} tz={tz} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4 xl:grid-cols-8">
        <Cell
          k="BTC spot"
          gloss="strip.spot"
          v={fmtPx(snap.spot)}
          sub={`${snap.spot_source} ${fmtAge(snap.spot_age_s)}${
            snap.perp
              ? ` · perp ${snap.basis_bps >= 0 ? "+" : ""}${snap.basis_bps.toFixed(1)}bp`
              : ""
          }`}
        />
        <Cell k="ticker" gloss="strip.ticker" v={snap.ticker} />
        <Cell k="floor strike" gloss="strip.strike" v={fmtPx(snap.strike)} sub={snap.strike_source} />
        <Cell
          k="dist to strike"
          gloss="strip.dist"
          v={
            <span className={dist >= 0 ? "text-up" : "text-down"}>
              {dist >= 0 ? "+" : ""}
              {dist.toFixed(1)} {fmtPct(distPct, 3)}
            </span>
          }
        />
        <Cell k="YES bid / ask" gloss="strip.yes" v={`${fmtC(snap.yes_bid)} / ${fmtC(snap.yes_ask)}`} />
        <Cell k="NO bid / ask" gloss="strip.no" v={`${fmtC(snap.no_bid)} / ${fmtC(snap.no_ask)}`} />
        <Cell
          k="fair / edge / fee"
          gloss="strip.fair"
          v={`fair ${fmtC(snap.fair_yes)}`}
          sub={`${snap.edge_up >= 0 ? "+" : ""}${snap.edge_up.toFixed(1)} UP · ${snap.edge_down >= 0 ? "+" : ""}${snap.edge_down.toFixed(1)} DN · fee ${snap.fee_yes}/${snap.fee_no} · comb ${fmtC(snap.combined_ask_cents)}`}
        />
        <Cell
          k="feeds"
          gloss="strip.feeds"
          v={
            <span className="flex flex-wrap gap-2">
              <span className="text-subtle">SPOT</span>
              <HealthDot h={snap.health.spot} />
              <span className="text-subtle">KALSHI</span>
              <HealthDot h={snap.health.kalshi} />
              <span className="text-subtle">DERIVS</span>
              <HealthDot h={snap.health.derivs} />
            </span>
          }
        />
      </div>
    </div>
  );
}
