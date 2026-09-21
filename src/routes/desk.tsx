import { createFileRoute } from "@tanstack/react-router";
import { DeskApp } from "@/components/desk/DeskApp";
import { InitialDeskFrame } from "@/lib/desk/store";
import { publicHomeSnapshot } from "@/lib/desk/home-public";
import { publicLastWindow } from "@/lib/desk/record-public";
import { pageHead } from "@/lib/desk/site";

export const Route = createFileRoute("/desk")({
  head: () => pageHead("/desk", "Live Floor · Satoshi's Council", "Follow the current Bitcoin paper decision, its evidence, and the recorded position for this 15-minute window."),
  // The last graded window rides along for the Guided Floor's end-of-window
  // handoff. It may fail without taking the floor down: a missing window is a
  // missing card, never a blank one.
  loader: async () => {
    const [frame, last] = await Promise.all([publicHomeSnapshot(), publicLastWindow().catch(() => null)]);
    return { frame, last };
  },
  component: LiveFloor,
});

function LiveFloor() {
  const { frame, last } = Route.useLoaderData();
  return <InitialDeskFrame.Provider value={frame}><DeskApp last={last} /></InitialDeskFrame.Provider>;
}
