import { pageHead } from "@/lib/desk/site";
import { createFileRoute } from "@tanstack/react-router";
import { BoardTab } from "@/components/desk/Feedback";
import { Page } from "@/components/desk/Page";
import { publicBoard } from "@/lib/desk/board-public";
import { useDesk } from "@/lib/desk/store";

export const Route = createFileRoute("/board")({
  head: () => pageHead("/board", "Board · Satoshi's Council", "Council updates, public ideas and moderated feedback. Paper research only."),
  // The first paint carries the Board itself, so a visitor never lands on a loading line.
  loader: () => publicBoard(),
  component: BoardPage,
});

function BoardPage() {
  const frame = useDesk();
  const initial = Route.useLoaderData();
  return (
    <Page
      wide
      title="The Board"
      lede="Desk updates, ideas, and public feedback. Posts do not change the Chair or place orders."
    >
      <BoardTab frame={frame} initial={initial} />
    </Page>
  );
}
