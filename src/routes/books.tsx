import { createFileRoute } from "@tanstack/react-router";
import { BooksTab } from "@/components/desk/BooksTab";
import { Page } from "@/components/desk/Page";
import { publicBooksSnapshot } from "@/lib/desk/books-public";

const BOOK_TZ = "America/Chicago";

export const Route = createFileRoute("/books")({
  loader: () => publicBooksSnapshot(),
  head: () => ({
    meta: [
      { title: "Paper books · Satoshi's Council" },
      { name: "description", content: "The Council's paper-only Bitcoin 15-minute record, with labeled time ranges, fees, floor trials, and window replays." },
    ],
  }),
  component: BooksPage,
});

function BooksPage() {
  const initial = Route.useLoaderData();
  return (
    <Page
      wide
      title="The paper books"
      lede="Every recorded window, scoped and labeled. Real public prices and fees. No live orders."
    >
      <BooksTab tz={BOOK_TZ} initial={initial} />
    </Page>
  );
}
