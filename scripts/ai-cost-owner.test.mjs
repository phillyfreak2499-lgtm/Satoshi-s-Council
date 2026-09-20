import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const server = read("src/lib/desk/ai-cost.server.ts");
const route = read("server/routes/owner/ai-cost.get.ts");
const panel = read("src/components/desk/AiCostPanel.tsx");
const settings = read("src/components/desk/SettingsTab.tsx");

test("owner AI cost route is header-authenticated and never accepts a key in the URL", () => {
  assert.match(route, /headers\.get\("x-desk-admin"\)/);
  assert.match(route, /adminKeyOk/);
  assert.match(route, /status: 404/);
  assert.doesNotMatch(route, /searchParams|get\("key"\)|\?key=/);
});

test("AI cost report is read-only observability over the unified view", () => {
  assert.match(server, /from ai_usage u/);
  assert.match(server, /uncached_estimate/);
  assert.match(server, /price_missing_calls/);
  assert.match(server, /usage_missing_calls/);
  for (const banned of [
    "insert into",
    "update desk",
    "delete from",
    "./chair",
    "./learner",
    "./book-floor",
    "./server-engine",
    "./policy-lab",
  ]) {
    assert.equal(server.toLowerCase().includes(banned), false, banned);
  }
});

test("owner UI sends the key only as a header and labels estimates honestly", () => {
  assert.match(panel, /"x-desk-admin": key/);
  assert.doesNotMatch(panel, /\?key=|encodeURIComponent\(key\)/);
  assert.match(panel, /MTD uncached estimate/);
  assert.match(panel, /not the OpenAI invoice/);
  assert.match(settings, /<AiCostPanel \/>/);
});
