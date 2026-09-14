import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const gallery = readFileSync("src/components/atelier/gallery.tsx", "utf8");
const tab = readFileSync("src/components/desk/AtelierTab.tsx", "utf8");
const field = readFileSync("src/lib/atelier/rooms/field.ts", "utf8");
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
  const source = `${gallery}\n${tab}\n${field}\n${wave}`;
  assert.doesNotMatch(source, /runChair|noteCall|paperBookEdgeOk|promoteToLive/);
  assert.doesNotMatch(source, /method:\s*["']POST["']|fetch\(|\/api\//);
});
