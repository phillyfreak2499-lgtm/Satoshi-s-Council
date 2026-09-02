import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { projectRoot, report, scanTree } from "./check-tree.mjs";

test("this repo has no dead copies at the root", () => {
  assert.deepEqual(scanTree(projectRoot()), []);
  assert.equal(report([]).ok, true);
});

test("flags a dumped agents/ + index.html tree", () => {
  const dir = mkdtempSync(join(tmpdir(), "check-tree-"));
  mkdirSync(join(dir, "agents"));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "index.html"), "<html></html>");
  const hits = scanTree(dir);
  assert.ok(hits.includes("agents/"));
  assert.ok(hits.includes("index.html"));
  assert.ok(!hits.includes("src/"));
  assert.equal(report(hits).ok, false);
});

test("backend/ and services/ fail even without index.html", () => {
  const dir = mkdtempSync(join(tmpdir(), "check-tree-"));
  mkdirSync(join(dir, "backend"));
  mkdirSync(join(dir, "services"));
  const hits = scanTree(dir);
  assert.deepEqual(hits.sort(), ["backend/", "services/"]);
});
