import { createFileRoute, useRouterState } from "@tanstack/react-router";
import { CouncilHome } from "@/components/desk/CouncilHome";
import { DeskApp } from "@/components/desk/DeskApp";
import { InitialDeskFrame } from "@/lib/desk/store";
import { publicHomeSnapshot } from "@/lib/desk/home-public";
import { publicLastFill, publicLastWindow } from "@/lib/desk/record-public";
import { pageHead } from "@/lib/desk/site";

export const Route = createFileRoute("/")({
  head: () => pageHead("/", "Bitcoin 15-minute paper research · Satoshi's Council", "Follow the live Bitcoin research floor, specialist reads, paper positions and recorded results. Paper only. No live orders. Not financial advice."),
  loader: async () => {
    const [frame, last, fill] = await Promise.all([
      publicHomeSnapshot(),
      publicLastWindow().catch(() => null),
      publicLastFill().catch(() => null),
    ]);
    return { frame, last, fill };
  },
  component: Home,
});

function Home() {
  const search = useRouterState({ select: state => state.location.searchStr });
  const query = new URLSearchParams(search);
  // Existing bookmarks continue to open their original room.
  const legacyRoom = ["tab", "seat", "view"].some(key => query.has(key));
  const { frame, last, fill } = Route.useLoaderData();
  return <InitialDeskFrame.Provider value={frame}>{legacyRoom ? <DeskApp last={last} /> : <CouncilHome last={last} fill={fill} />}</InitialDeskFrame.Provider>;
}
