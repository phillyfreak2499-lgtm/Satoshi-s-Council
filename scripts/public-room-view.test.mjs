import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("public-room interaction and evidence regressions", () => {
  execFileSync(process.execPath, ["--experimental-strip-types", "--test", "src/lib/desk/public-room-view.test.ts"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8",
  });
});
