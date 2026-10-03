import { pageHead } from "@/lib/desk/site";
import { createFileRoute } from "@tanstack/react-router";
import { ChamberRoom } from "@/components/desk/ChamberRoom";
import { listChamberSpeech } from "@/lib/desk/chamber-speech";

export const Route = createFileRoute("/chamber")({
  head: () => pageHead("/chamber", "The Chamber · Satoshi's Council", "Watch Council characters react to recorded research and desk events. All event times are labeled UTC. Paper only."),
  // received_ms is the clock right after the bounded read (the server's during SSR).
  // It is serialized with the rows, so hydration renders the same value.
  loader: async () => {
    const rows = await listChamberSpeech();
    return { rows, received_ms: Date.now() };
  },
  component: ChamberPage,
});

function ChamberPage() {
  const data = Route.useLoaderData();
  return <ChamberRoom initial={data.rows} receivedMs={data.received_ms} />;
}
