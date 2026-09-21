/**
 * SECTION 9 — data health.
 *
 * Trust, compactly. It keeps the distinction the desk already makes and the UI
 * kept losing: a RECEIPT age says the feed answered us, a LAST-CHANGE age says
 * the book moved, and a quiet book is not a stale one. The exchange's own quote
 * timestamp is not available from this feed, and the card says so rather than
 * implying otherwise.
 */
import { cn } from "@/lib/utils";
import type { FeedHealth } from "@/lib/desk/types";
import type { ProFloorFacts } from "@/lib/desk/pro-floor";
import { Chip, Panel } from "./panels";

function feedTone(h: FeedHealth): string {
  return h === "LIVE" ? "text-up" : h === "STALE" ? "text-wait" : "text-down";
}

function Feed({ label, h, sub }: { label: string; h: FeedHealth; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-t border-border py-1.5 first:border-t-0">
      <span className="font-mono text-micro uppercase tracking-wider text-subtle">{label}</span>
      <span className="text-right">
        <span className={cn("font-mono text-micro tabular", feedTone(h))}>{h}</span>
        {sub ? <span className="block font-mono text-micro text-subtle">{sub}</span> : null}
      </span>
    </div>
  );
}

export function DataHealthCard({ facts }: { facts: ProFloorFacts }) {
  const h = facts.health;
  const f = h.fresh;
  return (
    <Panel
      id="data"
      title="Data health"
      right={
        <Chip tone={h.all_clear ? "up" : "wait"}>{h.all_clear ? "all clear" : "check the feeds"}</Chip>
      }
    >
      <div className="mt-2 grid gap-x-6 sm:grid-cols-2">
        <div>
          <Feed label="spot" h={h.spot} sub={h.spot_age_s == null ? "age unknown" : `${Math.round(h.spot_age_s)}s since it answered`} />
          <Feed label="kalshi" h={h.kalshi} sub={f.receipt_age_s == null ? "no receipt time recorded" : `receipt ${f.receipt_age_s}s`} />
          <Feed label="derivs" h={h.derivs} sub={h.derivs_source || "source unreported"} />
        </div>
        <div>
          <div className="flex items-baseline justify-between gap-2 border-t border-border py-1.5 sm:border-t-0">
            <span className="font-mono text-micro uppercase tracking-wider text-subtle">sequence</span>
            <span className={cn("font-mono text-micro tabular", f.gap === "ok" ? "text-up" : "text-wait")}>
              {f.gap.toUpperCase()}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2 border-t border-border py-1.5">
            <span className="font-mono text-micro uppercase tracking-wider text-subtle">book last moved</span>
            <span className="font-mono text-micro tabular text-muted">
              {f.last_change_age_s == null ? "unknown" : `${f.last_change_age_s}s ago`}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2 border-t border-border py-1.5">
            <span className="font-mono text-micro uppercase tracking-wider text-subtle">index vs spot</span>
            <span className={cn("font-mono text-micro tabular", h.basis_wide ? "text-wait" : "text-muted")}>
              {h.basis_wide ? "basis wide" : "in line"}
              {h.spot_divergent ? " · sources diverge" : ""}
            </span>
          </div>
        </div>
      </div>

      {h.pit_tags.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {h.pit_tags.map((t) => {
            const blocking = t === "FEED_DOWN" || t === "DERIVS_DOWN" || t === "LOCKDOWN";
            const warn = t === "FEED_STALE" || t === "BASIS_WIDE";
            return (
              <Chip key={t} tone={blocking ? "down" : warn ? "wait" : "neutral"}>
                {t.replace(/_/g, " ").toLowerCase()}
              </Chip>
            );
          })}
        </div>
      ) : null}

      <p className="mt-3 max-w-[80ch] font-mono text-micro leading-relaxed text-subtle">
        A book that has not moved in a while is a quiet market, not necessarily a stale one. The exchange&apos;s own
        quote timestamp is not available from this feed, so every age here is the desk&apos;s own clock.
      </p>
    </Panel>
  );
}
