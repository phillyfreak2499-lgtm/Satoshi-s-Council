import { pageHead } from "@/lib/desk/site";
import { createFileRoute } from "@tanstack/react-router";
import { PitRoom } from "@/components/desk/PitRoom";
import { publicArenaSnapshot } from "@/lib/desk/arena-public";

export const Route = createFileRoute("/arena")({
  head: () => pageHead("/arena", "Arena · Satoshi's Council", "Lock one Bitcoin paper call per window and compare your results with other people and the chair benchmark. No live orders."),
  loader: () => publicArenaSnapshot(),
  component: ArenaPage,
});


function ArenaPage() {
  return <PitRoom initial={Route.useLoaderData()} />;
}
