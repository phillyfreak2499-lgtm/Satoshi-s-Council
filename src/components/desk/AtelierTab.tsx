import { Gallery } from "@/components/atelier/gallery";
import { useDesk } from "@/lib/desk/store";

export function AtelierTab() {
  const frame = useDesk();
  const lean = frame.chair?.lean ?? "WAIT";
  const remainingMs = Math.max(0, (frame.snap?.secs_left ?? 15 * 60) * 1000);
  const ticker = frame.snap?.ticker ?? "15m";

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
        }}
      />
    </div>
  );
}
