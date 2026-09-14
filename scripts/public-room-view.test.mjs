import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("public-room interaction and evidence regressions", () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const output = execFileSync(process.execPath, ["--experimental-strip-types", "--test", "src/lib/desk/public-room-view.test.ts"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", env,
  });
  assert.match(output, /(?:#|ℹ) tests 6\b/);
});
