/**
 * The Board's first paint and empty states.
 *
 * A first-time visitor never lands on a stuck loading line: the route loads
 * the Board on the server. A failed read prints one neutral line. With no
 * visitor posts the DESK notes lead, open, and the two columns say so without
 * a pair of zeros. The composer stays.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const read = (rel) => readFileSync(join(process.cwd(), rel), "utf8");

test("the Board route renders its first paint from the server and never from a loading line", () => {
  const route = read("src/routes/board.tsx");
  assert.match(route, /loader: \(\) => publicBoard\(\)/);
  assert.match(route, /<BoardTab frame=\{frame\} initial=\{initial\} \/>/);
  const pub = read("src/lib/desk/board-public.ts");
  assert.match(pub, /createServerFn\(\{ method: "GET" \}\)/);
  assert.match(pub, /engine\.ensureServerEngine\(\)/, "boots the engine so the DESK notes are upserted");
  assert.match(pub, /return null;/, "a failed read is null, never an empty board dressed as loaded");
  const board = read("src/lib/desk/board.ts");
  assert.match(board, /export async function readBoard\(\)/);
  assert.match(board, /export const listBoard = createServerFn\(\{ method: "GET" \}\)\.handler\(async \(\) => readBoard\(\)\);/);
});

test("loading shows only in flight, a failure says one neutral line, and empty columns are honest", () => {
  const src = read("src/components/desk/Feedback.tsx");
  assert.match(src, /const \[loaded, setLoaded\] = useState\(initial !== undefined\);/, "a server-rendered Board arrives loaded");
  assert.match(src, /\{!loaded \? <p role="status"[^>]*>Loading the shared Board…<\/p> : null\}/);
  assert.match(src, /export const BOARD_DOWN = "the Board is not answering — try again\.";/);
  assert.match(src, /useState\(initial === null \? BOARD_DOWN : ""\)/);
  assert.match(src, /catch \{\s*setErr\(BOARD_DOWN\);/, "no raw error text");
  assert.match(src, /export const BOARD_EMPTY = "No public notes yet\. Post one — 400 characters, paper talk only\.";/);
  assert.equal((src.match(/BOARD_EMPTY/g) ?? []).length, 3, "both columns use the one empty line");
  assert.match(src, /const quiet = loaded && !err && ideas\.length === 0 && notes\.length === 0;/);
  assert.match(src, /<details id="board-updates" open=\{quiet \|\| undefined\}/, "the DESK notes open when the visitor columns are empty");
  assert.match(src, /\{ideas\.length \? <>Ideas · \{ideas\.length\}<\/> : "Ideas"\}/, "no zero in the Ideas heading");
  assert.match(src, /\{notes\.length \? <>Feedback · \{notes\.length\}<\/> : "Feedback"\}/, "no zero in the Feedback heading");
  assert.match(src, /<Composer frame=\{frame\} kind=\{kind\} parentId=\{null\}/, "the composer stays");
});
