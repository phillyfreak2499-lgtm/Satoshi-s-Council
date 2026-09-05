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
          log: frame.call_log ?? [],
        }}
      />
    </div>
  );
}
