import { createFileRoute } from "@tanstack/react-router";
import { RecordRoom } from "@/components/desk/RecordRoom";
import { publicWeekRecord } from "@/lib/desk/record-public";
import { pageHead } from "@/lib/desk/site";

export const Route = createFileRoute("/record")({
  head: () => pageHead("/record", "The week on the record · Satoshi's Council", "Last 7 days of the Bitcoin paper desk: sits, fills, win rate against what was needed, net after fees, one WAIT that was right, one fill that was wrong. Paper only. No live orders."),
  loader: () => publicWeekRecord(),
  component: RecordPage,
});

function RecordPage() {
  return <RecordRoom initial={Route.useLoaderData()} />;
}
