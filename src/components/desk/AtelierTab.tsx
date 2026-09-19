import { Gallery } from "@/components/atelier/gallery";
import { useDesk } from "@/lib/desk/store";
import type { OfficialSettle } from "@/lib/desk/types";

export function AtelierTab() {
  const frame = useDesk();
  const lean = frame.chair?.lean ?? "WAIT";
  const remainingMs = Math.max(0, (frame.snap?.secs_left ?? 15 * 60) * 1000);
  const ticker = frame.snap?.ticker ?? "15m";
  const settled = frame.snap?.official_settles.find((result) => result.ticker === ticker)?.lean ?? "";
  const lastOfficial = frame.snap?.official_settles.reduce<OfficialSettle | null>(
    (latest, result) => (!latest || result.close_time > latest.close_time ? result : latest),
    null,
  );

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
          decision: frame.chair?.decision || frame.chair?.wait_note || frame.chair?.hypothesis || "",
          brainAge: frame.brain_age_s,
          source: frame.settings.source,
          asOf: frame.snap?.as_of ?? 0,
          spotAge: frame.snap?.spot_age_s ?? 999,
          log: frame.call_log ?? [],
          spot: frame.snap?.spot ?? 0,
          strike: frame.snap?.strike ?? 0,
          yesMid: frame.snap?.yes_mid ?? 50,
          settleAvg: frame.snap?.lab_settle_avg ?? null,
          locked: frame.snap?.lab_locked ?? 0,
          closeTime: frame.snap?.close_time ?? 0,
          candles: frame.snap?.candles_1m ?? [],
          settled,
          lastSettled: lastOfficial?.lean ?? "",
          lastSettledAt: lastOfficial?.close_time ?? 0,
          lastSettledTicker: lastOfficial?.ticker ?? "",
          votes: frame.votes.map((vote) => ({
            seat: vote.seat,
            lean: vote.lean,
            confidence: vote.confidence,
            reasoning: vote.reasoning,
          })),
        }}
      />
    </div>
  );
}
