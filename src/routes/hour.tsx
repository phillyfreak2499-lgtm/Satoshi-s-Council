import { createFileRoute } from "@tanstack/react-router";
import { HourRoom } from "@/components/desk/HourRoom";
import { publicHourBrief } from "@/lib/desk/hour-public";
import { pageHead } from "@/lib/desk/site";

export const Route = createFileRoute("/hour")({
  head: () => pageHead("/hour", "The hour on the record · Satoshi's Council", "A longer Bitcoin clock, graded separately from the 15-minute floor: the live hourly contract, its strike, and the hourly paper book's own record. Paper only. No live orders."),
  loader: () => publicHourBrief(),
  component: HourPage,
});

function HourPage() {
  return <HourRoom initial={Route.useLoaderData()} />;
}
