import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function navigation() {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read("src/lib/desk/navigation.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, URLSearchParams });
  return exports;
}

test("the Observatory adds wayfinding without dropping any existing destination", () => {
  const { SITE_DESTINATIONS } = navigation();
  const paths = Array.from(SITE_DESTINATIONS, item => item.href);
  for (const href of ["/", "/chamber", "/training", "/books", "/lab", "/arena", "/board", "/about", "/faq", "/legal", "/gallery", "/?tab=settings", "/?tab=crew", "/?tab=structure", "/?view=guided"]) {
    assert.equal(paths.filter(path => path === href).length, 1, `${href} remains reachable exactly once in the canonical map`);
  }
  const shared = read("src/components/desk/CouncilNavigation.tsx");
  assert.match(shared, /const PRIMARY[^;]*"\/desk"[^;]*"\/books"[^;]*"\/training"[^;]*"\/lab"[^;]*"\/board"[^;]*"\/about"/);
  assert.doesNotMatch(shared, /PRIMARY[^;]*SHOP_URL/);
  assert.match(shared, /const SHORTCUTS = PRIMARY;/);
  assert.ok(paths.includes("/?tab=settings"));
  assert.match(shared, /const menu: MenuItem\[\] = SITE_DESTINATIONS\.map/);
  assert.match(shared, /More<span/);
  assert.match(read("src/components/desk/GlobalHeader.tsx"), /searchOverride \?\? location.searchStr/);
});

test("existing Gallery, Settings and specialist bookmarks have correct active navigation", () => {
  const { sitePathActive } = navigation();
  assert.equal(sitePathActive("/", "/gallery", "?tab=atelier&room=streamer"), true);
  assert.equal(sitePathActive("/", "/?tab=atelier", "?tab=atelier&room=streamer"), true);
  assert.equal(sitePathActive("/", "/?tab=settings", "?tab=settings"), true);
  assert.equal(sitePathActive("/", "/", "?tab=settings"), false);
  assert.equal(sitePathActive("/", "/?tab=atelier", "?tab=settings"), false);
  assert.equal(sitePathActive("/lab", "/?tab=atelier", "?tab=atelier"), false);
  for (const desk of ["structure", "tape", "derivs", "book", "context"]) assert.equal(sitePathActive("/", "/?tab=structure", `?tab=${desk}`), true);
  assert.equal(sitePathActive("/", "/?view=guided", "?view=guided"), true);
  assert.equal(sitePathActive("/", "/?view=guided", "?view=guided&tab=settings"), false);
  assert.equal(sitePathActive("/window/EXAMPLE", "/books"), true);
  assert.equal(sitePathActive("/training/wick", "/training"), true);
});

test("the full application keeps rooms, floor choices, search, welcome and tours", () => {
  const app = read("src/components/desk/DeskApp.tsx");
  for (const component of ["SatoshiTab", "GuidedFloor", "BotCard", "AtelierTab", "BoardTab", "CrewTab", "ArenaTab", "BooksTab", "SettingsTab", "Palette", "Welcome", "Tour", "TopStrip", "MetaFooter"]) {
    assert.match(app, new RegExp(`<${component}[ >\\n]`), `${component} is retained`);
  }
  assert.match(app, /density=\{floorDensity\}/);
  assert.match(app, /onDensityChange=\{setFloorDensity\}/);
  assert.match(app, /tab === "atelier" && <AtelierTab \/>/);
  assert.match(app, /tab === "settings" && <SettingsTab settings=\{frame.settings\}/);
  const home = read("src/components/desk/CouncilHome.tsx");
  assert.match(home, /<CouncilGuides \/>/);
  assert.match(home, /href="\/desk"/);
  assert.doesNotMatch(app, /<CouncilEntrance|<CouncilGuides/);
  assert.doesNotMatch(app, /from ["'][^"']*preview\/|DEMO-PREVIEW/);
});

test("focus and presentation never replace data or make research decisions", () => {
  const source = read("src/components/desk/CouncilExperience.tsx");
  assert.doesNotMatch(source, /fetch\(|useDesk|setInterval|localStorage|server-engine|chair\.lean\s*=/);
  assert.match(source, /aria-pressed=\{focused\}/);
  const styles = read("src/components/desk/observatory.css");
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(styles, /html\[data-motion="reduce"\]/);
  assert.match(styles, /\.observatory \.obs-icon \{/);
  assert.doesNotMatch(styles, /\.observatory (?:svg|button|select|a)\s*\{/);
  assert.match(read("src/components/desk/SiteHeader.tsx"), /className="council-site-bar gutter/);
  assert.match(styles, /\.council-site-header > \.council-site-bar \{ height:/);
  assert.doesNotMatch(styles, /\.council-site-header > \.gutter\s*\{/,
    "header bar height must not constrain the full mobile menu");
  assert.doesNotMatch(styles, /(?:#floor-main|\.atelier|\.council-floor-tools|\.council-site-header)[^{]*\{[^}]*display:\s*none/);
});

test("home and the dedicated floor keep distinct navigation while legacy room bookmarks survive", () => {
  const { sitePathActive } = navigation();
  assert.equal(sitePathActive("/", "/"), true);
  assert.equal(sitePathActive("/desk", "/"), false);
  assert.equal(sitePathActive("/desk", "/desk"), true);
  assert.equal(sitePathActive("/", "/desk", "?tab=satoshi"), true);
  assert.equal(sitePathActive("/", "/", "?tab=satoshi"), false);
  assert.equal(sitePathActive("/desk", "/?tab=structure", "?tab=tape"), true);
  assert.equal(sitePathActive("/desk", "/?tab=atelier", "?tab=atelier&room=streamer"), true);
  assert.equal(sitePathActive("/desk", "/gallery", "?tab=atelier&room=streamer"), true);
  assert.equal(sitePathActive("/", "/", "?view=guided"), false);
  assert.equal(sitePathActive("/desk", "https://satoshis-council-shop.fourthwall.com/"), false);
});
