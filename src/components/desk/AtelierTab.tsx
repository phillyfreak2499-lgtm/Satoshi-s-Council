import { Gallery } from "@/components/atelier/gallery";
import { useDesk } from "@/lib/desk/store";

export function AtelierTab() {
  const frame = useDesk();
  const lean = frame.chair?.lean ?? "WAIT";
  const remainingMs = Math.max(0, (frame.snap?.secs_left ?? 15 * 60) * 1000);
  const ticker = frame.snap?.ticker ?? "15m";
  const settled = frame.snap?.official_settles.find((result) => result.ticker === ticker)?.lean ?? "";

  return (
    <div className="atelier-shell">
      <Gallery
        satoshi={{
          lean,
          remainingMs,
          ticker,
          phase: frame.snap?.phase ?? "—",
          confidence: frame.chair?.confidence ?? 0,
          score: frame.chair?.score ?? 0,
          bar: frame.chair?.bar ?? 0,
          brainAge: frame.brain_age_s,
          source: frame.settings.source,
          log: frame.call_log ?? [],
          spot: frame.snap?.spot ?? 0,
          strike: frame.snap?.strike ?? 0,
          yesMid: frame.snap?.yes_mid ?? 50,
          settleAvg: frame.snap?.lab_settle_avg ?? null,
          locked: frame.snap?.lab_locked ?? 0,
          closeTime: frame.snap?.close_time ?? 0,
          candles: frame.snap?.candles_1m ?? [],
          settled,
          votes: frame.votes.map((vote) => ({
            seat: vote.seat,
            lean: vote.lean,
            confidence: vote.confidence,
          })),
        }}
      />
    </div>
  );
}
