import { createFileRoute } from "@tanstack/react-router";
import { HourRoom } from "@/components/desk/HourRoom";
import { publicHourBrief } from "@/lib/desk/hour-public";
import { publicHourResearch } from "@/lib/desk/hour-research-public";
import { pageHead } from "@/lib/desk/site";

export const Route = createFileRoute("/hour")({
  head: () => pageHead("/hour", "The hour on the record · Satoshi's Council", "A longer Bitcoin clock, graded separately from the 15-minute floor: the live hourly contract, its strike ladder, the shadow research read on it, and the hourly paper book's own record. Paper only. No live orders."),
  // Two independent reads. Neither can fail the other: a research brief that
  // cannot be built comes back null and the page says so.
  loader: async () => {
    const [brief, research] = await Promise.all([
      publicHourBrief().catch(() => null),
      publicHourResearch().catch(() => null),
    ]);
    return { brief, research };
  },
  component: HourPage,
});

function HourPage() {
  const { brief, research } = Route.useLoaderData();
  return <HourRoom initial={brief} research={research} />;
}
