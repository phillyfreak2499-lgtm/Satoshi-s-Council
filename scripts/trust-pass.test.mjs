import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const faq = read("src/routes/faq.tsx");
const booksRoute = read("src/routes/books.tsx");
const engine = read("src/lib/desk/server-engine.ts");
const reliability = read("src/lib/desk/reliability.ts");
const smoke = read("scripts/live-public-smoke.mjs");

test("FAQ describes the completed 80c trial as archived", () => {
  assert.match(faq, /archived 80¢ floor trial/);
  assert.doesNotMatch(faq, /live 80¢ floor trial/);
});

test("Books first paint is explicitly non-cacheable and smoke checks API parity", () => {
  assert.match(booksRoute, /headers:\s*\(\)\s*=>\s*\(\{\s*"cache-control":\s*"no-store"/);
  assert.match(smoke, /function booksParity\(/);
  assert.match(smoke, /\/api\/books/);
  assert.match(smoke, /retrying after cache horizon/);
  assert.match(smoke, /32_000/);
});

test("deep status distinguishes a current identity incident from retained forensic history", () => {
  assert.match(reliability, /IDENTITY_FAULT_RECENT_MS = 30 \* 60_000/);
  assert.match(reliability, /recentIdentityFaults\?: number/);
  assert.match(reliability, /recent window identity fault/);
  assert.match(engine, /recentIdentityFaultCount\(e\.identityFaults\.map\(\(f\) => f\.at\), now\)/);
  assert.match(engine, /historical_identity_faults/);
  assert.match(engine, /observed_at:/);
  assert.match(engine, /recent:/);
});
