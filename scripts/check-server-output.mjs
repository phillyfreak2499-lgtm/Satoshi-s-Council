/** A successful bundle must also be valid JavaScript that Node can load. */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function modules(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : modules(path);
    return /\.(mjs|cjs|js)$/.test(entry.name) ? [path] : [];
  });
}

const files = modules(".output/server");
if (!files.length) throw new Error("No built server modules to check");
for (const file of files) {
  const checked = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (checked.error) throw checked.error;
  if (checked.status !== 0) {
    console.error(file, checked.stderr || checked.stdout);
    process.exit(1);
  }
}
console.log(`Checked ${files.length} built server modules`);
