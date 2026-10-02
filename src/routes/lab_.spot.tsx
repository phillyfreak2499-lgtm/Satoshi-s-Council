import { createFileRoute } from "@tanstack/react-router";
import { readSpotLab, SpotLabPage } from "./lab.spot";
/** Escape the existing public parent route; do not alter that page. */
export const Route = createFileRoute("/lab_/spot")({
  head: () => ({ meta: [{ title: "Paper spot-signal lab" }, { name: "robots", content: "noindex, nofollow" }] }),
  loader: () => readSpotLab(),
  component: SpotRoute,
});

function SpotRoute() {
  return <SpotLabPage initial={Route.useLoaderData()} />;
}
