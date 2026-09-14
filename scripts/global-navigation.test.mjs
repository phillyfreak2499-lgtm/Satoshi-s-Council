import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");

test("every public room and reading page uses one navigation map", () => {
  const map = read("src/lib/desk/navigation.ts");
  for (const path of ["/", "/training", "/chamber", "/lab", "/arena", "/about", "/faq", "/legal"]) {
    assert.match(map, new RegExp(`href: "${path === "/" ? "\\/" : path}"`), `${path} is in the public navigation`);
  }

  for (const path of [
    "src/components/desk/ChamberRoom.tsx",
    "src/components/desk/LabRoom.tsx",
    "src/components/desk/PitRoom.tsx",
    "src/components/desk/Page.tsx",
    "src/components/desk/DeskApp.tsx",
  ]) {
    const source = read(path);
    assert.match(source, /<GlobalHeader/, `${path} uses the shared header`);
    assert.doesNotMatch(source, /<SiteHeader/, `${path} does not fork its own navigation`);
  }

  for (const path of [
    "src/components/desk/Palette.tsx",
  ]) {
    assert.match(read(path), /SITE_DESTINATIONS/, `${path} consumes the same destination map`);
  }
});

test("Arena is the one public name for the paper-call room", () => {
  const visibleSources = [
    read("src/routes/arena.tsx"),
    read("src/components/desk/PitRoom.tsx"),
    read("src/components/desk/PitTour.tsx"),
    read("src/components/desk/Palette.tsx"),
    read("src/lib/desk/navigation.ts"),
  ].join("\n");

  assert.doesNotMatch(
    visibleSources,
    /"THE PIT|>THE PIT<|Join the pit|>pit<|PIT —|How the pit works/,
  );
  assert.match(visibleSources, /Arena · Satoshi's Council/);
  assert.match(visibleSources, /Enter the Arena/);
});

