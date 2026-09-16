import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");

test("Board and Books have canonical human routes and Books data has an API route", () => {
  const booksRoute = read("src/routes/books.tsx");
  const boardRoute = read("src/routes/board.tsx");
  const client = read("src/lib/desk/books.ts");
  const api = read("server/routes/api/books.get.ts");
  assert.match(booksRoute, /createFileRoute\("\/books"\)/);
  assert.match(booksRoute, /loader:\s*\(\)\s*=>\s*publicBooksSnapshot/);
  assert.match(boardRoute, /createFileRoute\("\/board"\)/);
  assert.match(client, /fetch\("\/api\/books"/);
  assert.match(api, /booksSummary/);
  assert.equal(existsSync(join(ROOT, "server/routes/books.get.ts")), false);
});

test("Books SSR, Replay truths, Seat chips, and FAQ basics stay explicit", () => {
  const books = read("src/components/desk/BooksTab.tsx");
  const replay = read("src/components/desk/ReplayPane.tsx");
  const seat = read("src/routes/seat.$id.tsx");
  const faq = read("src/routes/faq.tsx");
  assert.match(books, /useState<Books \| null>\(initial \?\? null\)/);
  for (const label of ["Settlement result", "Chair / paper", "Frame at cursor"]) assert.match(replay, new RegExp(label));
  assert.match(replay, /Paper FILLED/);
  assert.match(replay, /Paper SKIP/);
  assert.match(replay, /Paper — · no directional Chair read recorded/);
  assert.ok(!replay.includes("No position · chair sat out"));
  assert.match(seat, /skillTone\(s\.status\)/);
  assert.match(seat, /rounded-sm border px-1\.5 py-0\.5/);
  assert.match(faq, /defaultValue=\{\["q0", "q1"\]\}/);
  assert.match(faq, /How is the paper book doing\?/);
});

test("the checked-in package and common favicon carry the Council identity", () => {
  assert.equal(JSON.parse(read("package.json")).name, "satoshi-council");
  assert.equal(JSON.parse(read("package-lock.json")).name, "satoshi-council");
  assert.ok(existsSync(join(ROOT, "public/favicon.ico")));
});
