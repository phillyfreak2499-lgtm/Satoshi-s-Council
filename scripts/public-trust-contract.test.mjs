import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (rel) => readFileSync(join(process.cwd(), rel), "utf8");

test("public Council copy matches the roster the Chair actually uses", () => {
  const types = read("src/lib/desk/types.ts");
  const block = types.slice(types.indexOf("export const SEAT_IDS"), types.indexOf("export type SeatTab"));
  const ids = [...block.matchAll(/"([A-Z0-9_]+)"/g)].map((m) => m[1]);
  assert.equal(ids.length, 21, "the source roster has 21 specialist seats");

  const chair = read("src/lib/desk/chair.ts");
  assert.match(
    chair,
    /const CHAIR_NON_VOTERS = new Set<SeatId>\(\["WARDEN", "ORBIT", "WIRE"\]\)/,
    "the three pit-crew seats remain outside the vote",
  );

  const about = read("src/routes/about.tsx");
  const faq = read("src/routes/faq.tsx");
  assert.match(about, /twenty-one specialist seats/i);
  assert.match(about, /Eighteen of the seats vote UP, DOWN or WAIT/);
  assert.match(about, /three — WARDEN, ORBIT and WIRE — sit as non-voting pit crew/);
  assert.match(faq, /Twenty-one of them sit at five desks; eighteen vote UP, DOWN or WAIT/);
  assert.match(faq, /three — WARDEN, ORBIT and WIRE — sit as non-voting pit crew/);
});

test("the live Floor separates the standing read from the current signal frame", () => {
  const floor = read("src/components/desk/SatoshiTab.tsx");
  const signal = read("src/lib/desk/chair-signal.ts");
  const gauge = read("src/components/desk/ChairSignalGauge.tsx");

  assert.match(floor, /Standing Chair read/);
  assert.match(floor, /Current frame · the gauge below moves live/);
  assert.match(floor, /Paper entry is separate/);
  assert.match(signal, /Current Chair frame:/);
  assert.match(signal, /Standing Chair read:/);
  assert.match(signal, /earlier qualifying frame/);
  assert.match(gauge, /This instrument is the current frame/);
  assert.doesNotMatch(signal, /Actual Chair decision:/);
});

test("an empty Arena describes ranking eligibility instead of inventing inactivity", () => {
  const pit = read("src/components/desk/PitRoom.tsx");
  const tab = read("src/components/desk/ArenaTab.tsx");

  assert.match(pit, /No human callsign currently qualifies for the 7-day board/);
  assert.match(pit, /after 3 settled paper calls; no users or rows are seeded/);
  assert.doesNotMatch(pit, /Nobody has locked in the last 7 days/);
  assert.match(tab, /No human callsign qualifies yet/);
  assert.match(tab, /no users or rows are seeded/);
});

test("Legal keeps a real contact path without inventing a mailbox", () => {
  const legal = read("src/routes/legal.tsx");
  assert.match(legal, /Questions about the desk: post on the Board/);
  assert.match(legal, /href="\/board"/);
  assert.doesNotMatch(legal, /mailto:|@satoshiscouncil\.com|@gmail\.com/);
});
