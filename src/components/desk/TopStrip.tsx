import type { ReactNode } from "react";
import { fmtC, fmtPct, fmtPx } from "@/lib/desk/math";
import type { ChairResult, Snapshot } from "@/lib/desk/types";
import { HealthDot, LeanChip, MarketChip, Mono } from "./bits";
import { Tip } from "./Tip";
import { StripSkeleton } from "./Skeleton";
import { readMarket } from "@/lib/desk/market-hours";
import { askCents } from "@/lib/desk/scalp";
import { patchSettings } from "@/lib/desk/engine";
import { useCountdownText, useSmooth, useTickingAge } from "@/lib/desk/hooks";
import { pulseReceivedAt, usePulse } from "@/lib/desk/pulse";
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

function BrainPulse({ age, since }: { age: number; since: number }) {
  const text = useTickingAge(age, since);
  const effective = age + (since > 0 ? (Date.now() - since) / 1000 : 0);
  const stalled = effective > 30;
  const slow = effective > 10;
  return (
    <span
      className={cn(
        "flex items-center gap-1 rounded-sm border px-1.5 py-px font-mono text-micro",
        stalled
          ? "border-down/50 bg-down/10 text-down"
          : slow
            ? "border-wait/50 bg-wait/10 text-wait"
            : "border-border text-subtle",
      )}
      title="Seconds since the shared brain's last tick on the server"
    >
      <span
        className={cn(
          "inline-block size-1.5 rounded-full",
          stalled ? "bg-down" : slow ? "bg-wait" : "bg-up/80",
        )}
      />
      brain {stalled ? "stalled " : ""}
      {text}
    </span>
  );
}

/** The window clock, counting down locally between data frames. */
function CloseClock({ closeTime }: { closeTime: number }) {
  return <Mono className="text-title text-fg">{useCountdownText(closeTime)}</Mono>;
}

/** BTC spot: pulse-fed and tweened, with an age that keeps counting. */
function SpotCell({ snap, frameAt }: { snap: Snapshot; frameAt: number }) {
  const pulse = usePulse();
  const live = pulse && pulse.spot != null && pulse.ticker === snap.ticker ? pulse : null;
  const s = useSmooth(live?.spot ?? snap.spot);
  const age = useTickingAge(live ? 0 : snap.spot_age_s, live ? pulseReceivedAt() : frameAt);
  return (
    <Cell
      k="BTC spot"
      gloss="strip.spot"
      v={fmtPx(s)}
      sub={`${snap.spot_source} ${age}${
        snap.perp ? ` · perp ${snap.basis_bps >= 0 ? "+" : ""}${snap.basis_bps.toFixed(1)}bp` : ""
      }`}
    />
  );
}

function DistCell({ snap }: { snap: Snapshot }) {
  const pulse = usePulse();
  const live = pulse && pulse.spot != null && pulse.ticker === snap.ticker ? pulse : null;
  const target = (live?.spot ?? snap.spot) - snap.strike;
  const s = useSmooth(live?.spot ?? snap.spot);
  const dist = s - snap.strike;
  const distPct = s ? dist / s : 0;
  return (
    <Cell
      k="dist to strike"
      gloss="strip.dist"
      v={
        <span className={target >= 0 ? "text-up" : "text-down"}>
          {dist >= 0 ? "+" : ""}
          {dist.toFixed(1)} {fmtPct(distPct, 3)}
        </span>
      }
    />
  );
}

function BookCells({ snap }: { snap: Snapshot }) {
  const pulse = usePulse();
  const live = pulse && pulse.ticker === snap.ticker && pulse.yes_ask > 0 ? pulse : null;
  const yb = live ? live.yes_bid : snap.yes_bid;
  const ya = live ? live.yes_ask : snap.yes_ask;
  const nb = live ? live.no_bid : snap.no_bid;
  const na = live ? live.no_ask : snap.no_ask;
  return (
    <>
      <Cell k="YES bid / ask" gloss="strip.yes" v={`${fmtC(yb)} / ${fmtC(ya)}`} />
      <Cell k="NO bid / ask" gloss="strip.no" v={`${fmtC(nb)} / ${fmtC(na)}`} />
    </>
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
  brainAge,
  frameAt = 0,
}: {
  snap: Snapshot | null;
  chair: ChairResult | null;
  demo: boolean;
  learn: string;
  graded: number;
  evAvg?: number;
  evN?: number;
  tz: string;
  brainAge?: number | null;
  frameAt?: number;
}) {
  if (!snap) return <StripSkeleton />;
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
          {demo ? (
            <Tip k="source.demo" mark={false}>
              <button
                type="button"
                onClick={() => patchSettings({ source: "live" })}
                className="rounded-sm border border-wait/50 bg-wait/15 px-1.5 py-px font-mono text-micro uppercase tracking-widest text-wait"
              >
                DEMO · tap for live tape
              </button>
            </Tip>
          ) : (
            <Tip k="source.live" mark={false}>
              <span className="rounded-sm border border-up/40 bg-up/10 px-1.5 py-px font-mono text-micro uppercase tracking-widest text-up">
                LIVE
              </span>
            </Tip>
          )}
          {!demo && brainAge != null ? <BrainPulse age={brainAge} since={frameAt} /> : null}
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
                    "absolute inset-y-0 transition-all duration-500 ease-out",
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
            <CloseClock closeTime={snap.close_time} />
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
        <SpotCell snap={snap} frameAt={frameAt} />
        <Cell k="ticker" gloss="strip.ticker" v={snap.ticker} />
        <Cell k="floor strike" gloss="strip.strike" v={fmtPx(snap.strike)} sub={snap.strike_source} />
        <DistCell snap={snap} />
        <BookCells snap={snap} />
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
