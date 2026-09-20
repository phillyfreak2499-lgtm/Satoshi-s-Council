import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const root = read("src/routes/__root.tsx");
const tracker = read("src/components/analytics/GaPageViews.tsx");
const ga = read("src/lib/desk/ga.ts");
const feedback = read("src/components/desk/Feedback.tsx");
const arena = read("src/components/desk/ArenaPanel.tsx");

test("GA4 root wiring uses the production measurement id without an automatic duplicate pageview", () => {
  assert.match(root, /G-JMQGD1WTVT/);
  assert.match(root, /send_page_view: false/);
  assert.match(root, /<GaPageViews \/>/);
  assert.match(root, /data-sc-ga4="loader"/);
});

test("GA4 tracks the initial route and SPA navigations through one route bridge", () => {
  assert.match(tracker, /state\.location\.pathname/);
  assert.match(tracker, /state\.location\.searchStr/);
  assert.match(tracker, /gtagPageView\(routeKey\)/);
  assert.match(ga, /__scGa4LastPageView/);
  assert.match(ga, /g\("event", "page_view"\)/);
});

test("Floor success events keep their literal names and success-only call sites", () => {
  assert.match(feedback, /gtagEventAfterSuccess\("feedback_submitted", post\)/);
  assert.match(arena, /gtagEventAfterSuccess\("paper_call_locked"/);
  assert.doesNotMatch(feedback, /form_submit|form_start/);
  assert.doesNotMatch(arena, /form_submit|form_start/);
});

test("GA helper can restore a missing loader and keeps product events parameter-free", () => {
  assert.match(ga, /document\.createElement\("script"\)/);
  assert.match(ga, /googletagmanager\.com\/gtag\/js\?id=/);
  assert.match(ga, /g\("event", name\)/);
});
