// The existing npm test script discovers *.test.mjs; Node 22 needs TS stripping enabled.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
test("Bitcoin Wire database, filter, feed and endpoint contracts", () => {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--test", "src/lib/news/news.test.ts"], { encoding: "utf8", timeout: 60000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
