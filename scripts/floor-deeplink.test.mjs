/**
 * /desk?view=pro must open — and stay on — the Pro Floor.
 *
 * ROOT CAUSE (2026-09-27). DeskApp's mount effect asked a hand-rolled
 * `urlPinsFloorMode()` whether the address pinned a view. It recognised
 * `?view=guided`, `?tab=` and `?seat=`, but not `?view=pro`, so on
 * /desk?view=pro it fell through to `readFloorMode()`: the stored choice, else
 * the first-visit default (Guided). The URL-sync effect then wrote
 * `?view=guided`. It looked intermittent because a browser that had once
 * clicked Guided → Pro had "pro" stored, which masked the bug.
 *
 * These tests replay the component's three steps with the SAME helpers the
 * component calls: the server/first-paint state, the mount resolution, and the
 * address it writes back.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { floorModeFromSearch, floorViewParam, initialFloorMode, mountedFloorMode } from "../src/lib/desk/floor-view-url.ts";
import { FIRST_VISIT_FLOOR_MODE } from "../src/components/desk/prefs.ts";

const read = (rel) => readFileSync(join(process.cwd(), rel), "utf8");
const codeOf = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const APP = "src/components/desk/DeskApp.tsx";

/** One fresh load: SSR state → hydration (identical) → mount → the address the floor writes back. */
function freshLoad(search, stored) {
  const ssr = initialFloorMode(search);
  const hydrated = initialFloorMode(search);
  const mounted = mountedFloorMode(search, stored, FIRST_VISIT_FLOOR_MODE);
  const sp = new URLSearchParams(search);
  const onFloor = !sp.has("tab");
  const view = floorViewParam(sp.get("view"), mounted, onFloor);
  return { ssr, hydrated, mounted, view };
}

test("fresh load: an explicit ?view= wins over every stored preference and the first-visit default", () => {
  assert.equal(FIRST_VISIT_FLOOR_MODE, "guided", "the first-visit default this test must beat");
  for (const stored of [null, "guided", "pro"]) {
    const pro = freshLoad("?view=pro", stored);
    assert.deepEqual(pro, { ssr: "pro", hydrated: "pro", mounted: "pro", view: "pro" }, `?view=pro with stored=${stored}`);
    const guided = freshLoad("?view=guided", stored);
    assert.deepEqual(guided, { ssr: "guided", hydrated: "guided", mounted: "guided", view: "guided" }, `?view=guided with stored=${stored}`);
    // Extra parameters do not weaken the pin.
    assert.equal(freshLoad("?view=pro&utm_source=x", stored).mounted, "pro");
    // A Pro deep link still pins Pro.
    assert.equal(freshLoad("?tab=books", stored).mounted, "pro");
    assert.equal(freshLoad("?seat=INDEX", stored).mounted, "pro");
  }
});

test("fresh load: the bare /desk keeps its intended first-visit and stored-preference behaviour", () => {
  assert.equal(freshLoad("", null).mounted, "guided", "a browser that never chose opens Guided");
  assert.equal(freshLoad("", null).view, "guided", "…and the address says so");
  assert.equal(freshLoad("", "guided").mounted, "guided");
  assert.deepEqual(freshLoad("", "pro"), { ssr: "pro", hydrated: "pro", mounted: "pro", view: null }, "a stored Pro stays Pro on the bare address");
});

test("hydration: the server and the first client paint agree, and read only the URL", () => {
  for (const search of ["", "?view=pro", "?view=guided", "?tab=books", "?seat=INDEX", "?view=nonsense"]) {
    const { ssr, hydrated } = freshLoad(search, "guided");
    assert.equal(ssr, hydrated, search);
  }
  assert.equal(initialFloorMode("?view=pro"), "pro");
  assert.equal(initialFloorMode("?view=guided"), "guided");
  assert.equal(initialFloorMode(""), "pro", "no storage read during render: the bare address paints Pro, then mount applies the preference");
  assert.equal(initialFloorMode.length, 1, "the render-time state takes the URL and nothing else");
});

test("the address: Guided always names itself, Pro keeps an explicit ?view=pro, leaving Guided drops the parameter", () => {
  assert.equal(floorViewParam("pro", "pro", true), "pro", "/desk?view=pro is not rewritten");
  assert.equal(floorViewParam(null, "pro", true), null, "Pro never adds a parameter to a bare address");
  assert.equal(floorViewParam("guided", "pro", true), null, "clicking Guided → Pro removes view=guided");
  assert.equal(floorViewParam("pro", "guided", true), "guided", "clicking Pro → Guided writes view=guided");
  assert.equal(floorViewParam(null, "guided", true), "guided");
  assert.equal(floorViewParam("pro", "pro", false), null, "off the floor (a ?tab= section) there is no view parameter");
  assert.equal(floorViewParam("guided", "guided", false), null);
  assert.equal(floorModeFromSearch("?view=pro"), "pro");
  assert.equal(floorModeFromSearch("?view=PRO"), null, "only the exact value pins");
});

test("DeskApp uses these helpers — no second, hand-rolled 'does the URL pin a view' predicate", () => {
  const app = codeOf(APP);
  assert.match(app, /import \{ floorViewParam, initialFloorMode, mountedFloorMode \} from "@\/lib\/desk\/floor-view-url";/);
  assert.match(app, /useState<FloorMode>\(\(\) => initialFloorMode\(initialSearch\)\)/, "first render: URL only");
  assert.match(app, /setFloorModeState\(mountedFloorMode\(window\.location\.search, readStoredFloorMode\(\), FIRST_VISIT_FLOOR_MODE\)\);/, "mount: URL, then stored, then default");
  assert.match(app, /const view = floorViewParam\(u\.searchParams\.get\("view"\), floorMode, tab === "satoshi"\);/, "the address sync");
  assert.doesNotMatch(app, /function urlPinsFloorMode/, "the predicate that forgot ?view=pro is gone");
  assert.doesNotMatch(app, /readFloorMode\(\)/, "the preference-or-default read never runs on its own at mount");
  // The explicit-view deep link saves the choice for both views, not only Guided.
  assert.match(app, /sp\.get\("view"\) === "guided" \|\| sp\.get\("view"\) === "pro"/);
});
