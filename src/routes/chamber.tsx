import { createFileRoute } from "@tanstack/react-router";
import { ChamberRoom } from "@/components/desk/ChamberRoom";

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
  component: ChamberPage,
});

function ChamberPage() {
  return <ChamberRoom />;
}
