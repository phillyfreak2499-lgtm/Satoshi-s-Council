import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const gallery = readFileSync("src/components/atelier/gallery.tsx", "utf8");
const tab = readFileSync("src/components/desk/AtelierTab.tsx", "utf8");
const field = readFileSync("src/lib/atelier/rooms/field.ts", "utf8");
const ceiling = readFileSync("src/lib/atelier/rooms/ceiling.ts", "utf8");
const arcade = readFileSync("src/lib/atelier/rooms/arcade.ts", "utf8");
const council = readFileSync("src/lib/atelier/rooms/council.ts", "utf8");
const rooms = readFileSync("src/lib/atelier/rooms/index.ts", "utf8");
const catalog = readFileSync("src/lib/atelier/catalog.ts", "utf8");
const wave = readFileSync("src/lib/atelier/rooms/wave.ts", "utf8");
const finish = readFileSync("src/lib/atelier/finish.ts", "utf8");
const styles = readFileSync(
  existsSync("src/styles.css") ? "src/styles.css" : "atelier-signal-v4.css",
  "utf8",
);

test("the Gallery presents the live SATOSHI call as display art", () => {
  assert.match(gallery, /Signal Gallery/);
  assert.match(gallery, /data-stance=\{stance\}/);
  assert.match(gallery, /gate confidence/);
  assert.match(gallery, /weighted vote/);
  assert.match(gallery, /Recent SATOSHI calls/);
  assert.match(gallery, /paper only · not a trade/);
  assert.match(gallery, /requestFullscreen/);
  assert.match(gallery, /Enter display mode/);
  assert.match(gallery, /hashWindow\(satoshi\.ticker/);
});

test("the Gallery receives display-only facts from the existing desk frame", () => {
  assert.match(tab, /confidence: frame\.chair\?\.confidence/);
  assert.match(tab, /score: frame\.chair\?\.score/);
  assert.match(tab, /bar: frame\.chair\?\.bar/);
  assert.match(tab, /brainAge: frame\.brain_age_s/);
  assert.match(tab, /source: frame\.settings\.source/);
  assert.match(tab, /phase: frame\.snap\?\.phase/);
  assert.match(tab, /spot: frame\.snap\?\.spot/);
  assert.match(tab, /strike: frame\.snap\?\.strike/);
  assert.match(tab, /yesMid: frame\.snap\?\.yes_mid/);
  assert.match(tab, /settleAvg: frame\.snap\?\.lab_settle_avg/);
  assert.match(tab, /locked: frame\.snap\?\.lab_locked/);
  assert.match(tab, /votes: frame\.votes\.map/);
  assert.match(tab, /official_settles\.find/);
  assert.match(tab, /lastOfficial/);
  assert.match(tab, /lastSettledTicker/);
});

test("Cloud Ceiling tells the final-minute settlement truth", () => {
  assert.match(catalog, /name: "Cloud Ceiling"/);
  assert.match(rooms, /ceiling: createCeiling/);
  assert.match(gallery, /settleAvg: satoshi\.settleAvg \?\? 0/);
  assert.match(ceiling, /const finalApproach = seconds <= 60/);
  assert.match(ceiling, /locked > 0 && settleAvg > 0/);
  assert.match(ceiling, /SETTLEMENT GHOST/);
  assert.match(ceiling, /AVG ALT/);
  assert.match(ceiling, /BRTI PRINTS OBSERVED/);
  assert.match(ceiling, /WAITING FOR BRTI PRINTS/);
  assert.match(ceiling, /CEILING BROKEN/);
  assert.match(ceiling, /REJECTED/);
});

test("Tape Arcade keeps player skill separate from settlement", () => {
  assert.match(catalog, /name: "Tape Arcade"/);
  assert.match(rooms, /arcade: createArcade/);
  assert.match(arcade, /mode === "drive"/);
  assert.match(arcade, /GRIP/);
  assert.match(arcade, /RAILS/);
  assert.match(arcade, /LANDING/);
  assert.match(arcade, /BLUE LANE SETTLES/);
  assert.match(arcade, /CONTRACT: SETTLED/);
  assert.match(arcade, /AWAITING OFFICIAL SETTLEMENT/);
  assert.match(arcade, /CHECKERED · LAST WINDOW/);
  assert.match(arcade, /DRIVE: \$\{priorRun\.grip\}% GRIP/);
  assert.match(arcade, /lastSettledTicker === priorRun\.ticker/);
  assert.match(arcade, /sessionStorage\.setItem\(RUN_STORE/);
  assert.doesNotMatch(arcade, /boost|power-up|extra lives|betting/i);
  assert.match(styles, /atelier\[data-room="arcade"\] \.atelier-frame canvas/);
});

test("Council Constellation renders all existing votes without authority", () => {
  assert.match(catalog, /name: "Council Constellation"/);
  assert.match(rooms, /council: createCouncil/);
  assert.match(council, /COUNCIL CONSTELLATION/);
  assert.match(council, /RING IS NOT PROBABILITY/);
  assert.match(council, /stars\.filter\(\(star\) => star\.lean === "UP"\)/);
  assert.match(council, /stars\.filter\(\(star\) => star\.lean === "DOWN"\)/);
  assert.match(council, /stars\.filter\(\(star\) => star\.lean === "WAIT"\)/);
  assert.match(gallery, /votes: councilState/);
});

test("the new veil uses distinct call climates and motion can freeze", () => {
  assert.match(field, /hold:\s*\{/);
  assert.match(field, /wait:\s*\{/);
  assert.match(field, /up:\s*\{/);
  assert.match(field, /let phase = 0/);
  assert.match(field, /phase \+= dt/);
  assert.match(wave, /phase \+= dt \* speed \* 4/);
  assert.doesNotMatch(field, /draw\(ctx,\s*\w+,\s*\w+,\s*t\)/);
  assert.doesNotMatch(wave, /draw\(ctx,\s*\w+,\s*\w+,\s*t\)/);
  assert.doesNotMatch(finish, /performance\.now\(\)/);
  assert.match(styles, /SIGNAL GALLERY v4/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
  assert.match(styles, /html\[data-motion="reduce"\] \.atelier-signal-meter/);
});

test("the Gallery remains a read-only paper presentation", () => {
  const source = `${gallery}\n${tab}\n${field}\n${wave}\n${ceiling}\n${arcade}\n${council}`;
  assert.doesNotMatch(source, /runChair|noteCall|paperBookEdgeOk|promoteToLive/);
  assert.doesNotMatch(source, /method:\s*["']POST["']|fetch\(|\/api\//);
});
