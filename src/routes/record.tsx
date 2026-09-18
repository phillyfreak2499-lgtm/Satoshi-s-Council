import { createFileRoute } from "@tanstack/react-router";
import { RecordRoom } from "@/components/desk/RecordRoom";
import { RECORD_CACHE_CONTROL } from "@/lib/desk/record";
import { publicWeekRecord } from "@/lib/desk/record-public";
import { pageHead } from "@/lib/desk/site";

export const Route = createFileRoute("/record")({
  head: () => pageHead("/record", "The week on the record · Satoshi's Council", "Last 7 days of the Bitcoin paper desk: sits, fills, win rate against what was needed, net after fees, one WAIT that was right, one fill that was wrong. Paper only. No live orders."),
  loader: () => publicWeekRecord(),
  // A rolling week must never be served from a cache: not the browser's, not a proxy's.
  headers: () => ({ "cache-control": RECORD_CACHE_CONTROL }),
  component: RecordPage,
});

function RecordPage() {
  return <RecordRoom initial={Route.useLoaderData()} />;
}
