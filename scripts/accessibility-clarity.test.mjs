import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");

function token(css, name) {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"));
  assert.ok(m, `missing --${name}`);
  return m[1];
}
function luminance(hex) {
  const rgb = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = rgb.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

test("small interface text meets its minimum size and token contrast", () => {
  const css = read("src/styles.css");
  assert.match(css, /--text-micro:\s*12px/);
  assert.doesNotMatch(css, /\.table-research th\s*\{[\s\S]*?font-size:\s*11px/);
  const raised = token(css, "raised");
  assert.ok(contrast(token(css, "text-3"), raised) >= 4.5, "subtle text must pass AA on raised panels");
  assert.ok(contrast(token(css, "down"), raised) >= 4.5, "DOWN text must pass AA on raised panels");
});

test("the Floor has one semantic call heading and no fake zero quorum", () => {
  const floor = read("src/components/desk/SatoshiTab.tsx");
  assert.match(floor, /<h1[^>]*>[\s\S]*Chair call:/);
  assert.match(floor, /Why WAIT:/);
  assert.match(floor, /waiting for the current-window vote/);
  assert.doesNotMatch(floor, /chair\?\.quorum\s*\?\?\s*\{\s*up:\s*0/);
});

test("seat counts and the two status vocabularies stay canonical", () => {
  const readme = read("README.md");
  const faq = read("src/routes/faq.tsx");
  const prompt = read("docs/SATOSHI_DESK_FULL_PROMPT.md");
  assert.match(readme, /21 seats: 18 vote, 3 pit crew/);
  for (const word of ["CANDIDATE", "SHADOW", "LIVE", "BENCH"]) {
    assert.match(faq, new RegExp(word));
    assert.match(prompt, new RegExp(word));
  }
  assert.match(faq, /WAIT and SIT are current-window reads, not status levels/);
});
