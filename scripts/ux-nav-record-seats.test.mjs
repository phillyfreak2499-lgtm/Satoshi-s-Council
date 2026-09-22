/**
 * Audit items 4–6: primary nav, one canonical record, seat-count copy.
 * Presentation only. Does not change Chair, book, or policy.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const read = (rel) => readFileSync(join(process.cwd(), rel), "utf8");

test("primary nav is Floor · Record · Learn · Research · Community · About", () => {
  const nav = read("src/components/desk/CouncilNavigation.tsx");
  assert.match(nav, /const PRIMARY: readonly SiteHref\[\] = \["\/desk", "\/books", "\/training", "\/lab", "\/board", "\/about"\]/);
  const dest = read("src/lib/desk/navigation.ts");
  assert.match(dest, /href: "\/desk", label: "Floor"/);
  assert.match(dest, /href: "\/books", label: "Record"/);
  assert.match(dest, /href: "\/training", label: "Learn"/);
  assert.match(dest, /href: "\/lab", label: "Research"/);
  assert.match(dest, /href: "\/board", label: "Community"/);
  assert.match(dest, /href: "\/about", label: "About"/);
  assert.doesNotMatch(dest, /href: "\/desk", label: "Live Floor"/);
  assert.doesNotMatch(nav, /SHOP_URL.*PRIMARY|PRIMARY.*SHOP_URL/);
});

test("public seat copy is 15 voting + 3 retired + 3 pit crew", () => {
  const pub = read("src/lib/desk/council-public.ts");
  assert.match(pub, /COUNCIL_TOTAL_SEATS = 21/);
  assert.match(pub, /COUNCIL_VOTING_SEATS = 15/);
  assert.match(pub, /COUNCIL_RETIRED_SEATS = 3/);
  assert.match(pub, /COUNCIL_PIT_CREW_SEATS = 3/);
  assert.match(pub, /ODDS/);
  assert.match(pub, /CHEAP/);
  assert.match(pub, /FADE/);
  assert.match(pub, /Retired means the seat still has a public graded record/);
  const about = read("src/routes/about.tsx");
  assert.match(about, /Only the 15 currently voting specialists/);
  assert.match(about, /COUNCIL_RETIRED_SEATS/);
  const faq = read("src/routes/faq.tsx");
  assert.match(faq, /Only the 15 currently voting specialists/);
  const root = read("src/routes/__root.tsx");
  assert.match(root, /15 currently voting/);
  assert.doesNotMatch(root, /18 voting specialists/);
});

test("canonical record block is shared and scoped", () => {
  const rec = read("src/lib/desk/canonical-record.ts");
  assert.match(rec, /canonicalFromBooks/);
  assert.match(rec, /books\.trial\.live/);
  assert.match(rec, /different scope/);
  const block = read("src/components/desk/CanonicalRecord.tsx");
  assert.match(block, /CANONICAL_RECORD_LABEL/);
  assert.match(block, /net after fees/);
  assert.match(block, /95% interval/);
  const books = read("src/routes/books.tsx");
  assert.match(books, /<CanonicalRecord/);
  const about = read("src/routes/about.tsx");
  assert.match(about, /<CanonicalRecord/);
  const home = read("src/components/desk/CouncilHome.tsx");
  assert.match(home, /<CanonicalRecord/);
});
