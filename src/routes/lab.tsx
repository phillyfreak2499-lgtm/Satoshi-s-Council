import { pageHead } from "@/lib/desk/site";
import { createFileRoute } from "@tanstack/react-router";
import { LabRoom } from "@/components/desk/LabRoom";
import { publicLabSnapshot } from "@/lib/desk/lab-public";

export const Route = createFileRoute("/lab")({
  head: () => pageHead("/lab", "Lab · Satoshi's Council", "Compare frozen paper experiments on matched observations, with visible sample sizes and research gates. No live orders."),
  loader: () => publicLabSnapshot(),
  component: LabPage,
});

function LabPage() {
  return <LabRoom initial={Route.useLoaderData()} />;
}
