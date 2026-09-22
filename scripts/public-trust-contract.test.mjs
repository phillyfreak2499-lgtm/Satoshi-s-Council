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

  const seats = read("src/lib/desk/seats.ts");
  assert.match(seats, /export const RETIRED_SEAT_IDS: readonly SeatId\[\] = \["ODDS", "CHEAP", "FADE"\]/);

  const publicCopy = read("src/lib/desk/council-public.ts");
  const about = read("src/routes/about.tsx");
  const faq = read("src/routes/faq.tsx");
  const root = read("src/routes/__root.tsx");
  const og = read("server/routes/og/page.get.ts");

  assert.match(publicCopy, /COUNCIL_TOTAL_SEATS = 21/);
  assert.match(publicCopy, /COUNCIL_VOTING_SEATS = 15/);
  assert.match(publicCopy, /COUNCIL_RETIRED_SEATS = 3/);
  assert.match(publicCopy, /COUNCIL_PIT_CREW_SEATS = 3/);
  for (const id of ["WARDEN", "ORBIT", "WIRE", "ODDS", "CHEAP", "FADE"]) assert.match(publicCopy, new RegExp(id));

  assert.match(about, /COUNCIL_STRUCTURE_SHORT/);
  assert.match(about, /Only the 15 currently voting specialists cast UP, DOWN or WAIT votes/);
  assert.match(about, /WARDEN, ORBIT and WIRE never count as votes/);
  assert.doesNotMatch(about, /twenty-one specialist seats/i);
  assert.equal((about.match(/The live floor grades 15-minute/g) ?? []).length, 1, "About does not repeat the live-floor sentence");

  assert.match(faq, /How many Council seats actually vote\?/);
  assert.match(faq, /Only the 15 currently voting specialists can cast UP, DOWN or WAIT votes/);
  assert.match(faq, /The three pit-crew seats never count as votes/);
  assert.match(faq, /COUNCIL_STRUCTURE_SHORT/);
  assert.doesNotMatch(faq, /Twenty-one of them sit at five desks/);

  assert.match(root, /The Council has 21 seats: 15 currently voting, 3 retired from votes, and 3 non-voting pit crew/);
  assert.match(og, /21 SEATS \/ 15 VOTE \/ 3 RETIRED \/ 3 PIT CREW/);
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
  assert.match(legal, /Public questions about the desk stay on the Board/);
  assert.match(legal, /href="\/board"/);
  assert.match(legal, /LEGAL, TRADEMARK or SECURITY/);
  assert.match(legal, /hidden from the public Board on submission/);
  assert.doesNotMatch(legal, /The desk has no mailbox/);
  assert.doesNotMatch(legal, /mailto:|@satoshiscouncil\.com|@gmail\.com/);
});
