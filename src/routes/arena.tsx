import { createFileRoute } from "@tanstack/react-router";
import { PitRoom } from "@/components/desk/PitRoom";
import { publicArenaSnapshot } from "@/lib/desk/arena-public";

export const Route = createFileRoute("/arena")({
  head: () => ({
    meta: [
      { title: "Arena · Satoshi's Council" },
      {
        name: "description",
        content: "Lock one paper call, UP or DOWN, on the live Bitcoin 15-minute window and see how the room leans. Paper only. Not advice. Not Kalshi orders.",
      },
    ],
  }),
  loader: () => publicArenaSnapshot(),
  component: ArenaPage,
});


function ArenaPage() {
  return <PitRoom initial={Route.useLoaderData()} />;
}
