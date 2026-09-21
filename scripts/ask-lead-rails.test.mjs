import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

test("ASK_LEAD is measurement-only and never reaches a decider", () => {
  const pure = read("src/lib/desk/ask-lead.ts");
  const server = read("src/lib/desk/ask-lead.server.ts");
  assert.match(pure, /ASK_LEAD_SWAP_V1/);
  assert.match(pure, /Authority: none/);
  assert.match(server, /ensureAskLeadObserver/);
  assert.match(server, /desk_ask_lead_windows/);
  assert.match(server, /desk_ask_lead_swaps/);
  assert.doesNotMatch(server, /noteCall\(|applyDeskOp|decideChair\(|runChair\(|promoteToLive|setKnob/);
  assert.match(server, /await import\("\.\/server-engine"\)/);
  const engine = read("src/lib/desk/server-engine.ts");
  assert.ok(!engine.includes("ask-lead"), "engine must not import ask-lead");
  for (const path of [
    "src/lib/desk/chair.ts",
    "src/lib/desk/selective-entry.ts",
    "src/lib/desk/book-floor.ts",
    "src/lib/desk/learner.ts",
  ]) {
    assert.ok(!read(path).includes("ask-lead"), `${path} imports ask-lead`);
  }
});
