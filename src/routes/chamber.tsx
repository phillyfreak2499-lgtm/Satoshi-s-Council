import { pageHead } from "@/lib/desk/site";
import { createFileRoute } from "@tanstack/react-router";
import { ChamberRoom } from "@/components/desk/ChamberRoom";
import { listChamberSpeech } from "@/lib/desk/chamber-speech";

export const Route = createFileRoute("/chamber")({
  head: () => pageHead("/chamber", "The Chamber · Satoshi's Council", "Watch Council characters react to recorded research and desk events. All event times are labeled UTC. Paper only."),
  loader: () => listChamberSpeech(),
  component: ChamberPage,
});

function ChamberPage() {
  return <ChamberRoom initial={Route.useLoaderData()} />;
}
