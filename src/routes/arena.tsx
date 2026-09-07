import { createFileRoute } from "@tanstack/react-router";
import { PitRoom } from "@/components/desk/PitRoom";

export const Route = createFileRoute("/arena")({
  head: () => ({
    meta: [
      { title: "THE PIT · Satoshi's Council" },
      {
        name: "description",
        content: "Lock one paper call, UP or DOWN, on the live Bitcoin 15-minute window and see how the room leans. Paper only. Not advice. Not Kalshi orders.",
      },
    ],
  }),
  component: PitRoom,
});
