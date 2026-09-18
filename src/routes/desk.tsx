import { createFileRoute } from "@tanstack/react-router";
import { DeskApp } from "@/components/desk/DeskApp";
import { InitialDeskFrame } from "@/lib/desk/store";
import { publicHomeSnapshot } from "@/lib/desk/home-public";
import { pageHead } from "@/lib/desk/site";

export const Route = createFileRoute("/desk")({
  head: () => pageHead("/desk", "Live Floor · Satoshi's Council", "Follow the current Bitcoin paper decision, its evidence, and the recorded position for this 15-minute window."),
  loader: () => publicHomeSnapshot(),
  component: LiveFloor,
});

function LiveFloor() {
  return <InitialDeskFrame.Provider value={Route.useLoaderData()}><DeskApp /></InitialDeskFrame.Provider>;
}
