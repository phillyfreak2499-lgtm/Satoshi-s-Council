import { pageHead } from "@/lib/desk/site";
import { createFileRoute } from "@tanstack/react-router";
import { BooksTab } from "@/components/desk/BooksTab";
import { Page } from "@/components/desk/Page";
import { publicBooksSnapshot } from "@/lib/desk/books-public";

const BOOK_TZ = "America/Chicago";

export const Route = createFileRoute("/books")({
  loader: () => publicBooksSnapshot(),
  head: () => pageHead("/books", "Books · Satoshi's Council", "Review recorded paper results, overlapping time periods, missing windows and fee-adjusted comparisons. Bitcoin research only."),
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
