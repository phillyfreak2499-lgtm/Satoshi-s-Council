import { pageHead } from "@/lib/desk/site";
import { createFileRoute } from "@tanstack/react-router";
import { BooksTab } from "@/components/desk/BooksTab";
import { Page } from "@/components/desk/Page";
import { publicBooksSnapshot } from "@/lib/desk/books-public";

const BOOK_TZ = "America/Chicago";

export const Route = createFileRoute("/books")({
  loader: () => publicBooksSnapshot(),
  // The scoreboard changes every settled window. Never let a proxy/browser pin
  // the SSR first paint behind the client-side /api/books refresh.
  headers: () => ({ "cache-control": "no-store" }),
  head: () => pageHead("/books", "Books · Satoshi's Council", "Review recorded paper results, overlapping time periods, missing windows and fee-adjusted comparisons. Bitcoin research only."),
  component: BooksPage,
});

function BooksPage() {
  const initial = Route.useLoaderData();
  return (
    <Page
      wide
      title="Results, on the record."
      lede="Explore the paper books: recorded positions, settlement outcomes, and fee-adjusted results. Every period is scoped and labeled."
    >
      <BooksTab tz={BOOK_TZ} initial={initial} />
    </Page>
  );
}
