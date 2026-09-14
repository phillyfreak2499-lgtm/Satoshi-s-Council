import { createFileRoute } from "@tanstack/react-router";
import { ChamberRoom } from "@/components/desk/ChamberRoom";
import { listChamberSpeech } from "@/lib/desk/chamber-speech";

export const Route = createFileRoute("/chamber")({
  head: () => ({
    meta: [
      { title: "The Chamber · Satoshi's Council" },
      {
        name: "description",
        content: "Watch Satoshi's Council react to real desk events. Read-only, evidence-backed, paper-only.",
      },
    ],
  }),
  loader: () => listChamberSpeech(),
  component: ChamberPage,
});

function ChamberPage() {
  return <ChamberRoom initial={Route.useLoaderData()} />;
}
