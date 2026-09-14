import { createFileRoute } from "@tanstack/react-router";
import { DeskApp } from "@/components/desk/DeskApp";
import { InitialDeskFrame } from "@/lib/desk/store";
import { publicHomeSnapshot } from "@/lib/desk/home-public";
import { pageHead } from "@/lib/desk/site";

export const Route = createFileRoute("/")({
  head: () => pageHead("/", "Bitcoin 15-minute paper research · Satoshi's Council", "Follow the live Bitcoin research floor, specialist reads, paper positions and recorded results. Paper only. No live orders. Not financial advice."),
  loader: () => publicHomeSnapshot(),
  component: Home,
});

function Home() {
  return <InitialDeskFrame.Provider value={Route.useLoaderData()}><DeskApp /></InitialDeskFrame.Provider>;
}
