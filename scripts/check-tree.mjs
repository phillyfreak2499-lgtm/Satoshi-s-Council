#!/usr/bin/env node
/**
 * Fail the build if a dead copy of the old FastAPI Council is dropped next to
 * this tree. Those folders are never loaded here — they silently drift.
 *
 * Allowed at root: src/, public/, scripts/, server/, docs/, migrations/.
 */
import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const FORBIDDEN_DIRS = [
  "agents",
  "backend",
  "css",
  "data",
  "frontend",
  "js",
  "learning",
  "protected",
  "risk",
  "services",
  "storage",
  "tests",
];

export const FORBIDDEN_FILES = ["index.html"];

export function projectRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export function scanTree(root = projectRoot()) {
  const hits = [];
  for (const name of FORBIDDEN_DIRS) {
    const p = join(root, name);
    try {
      if (existsSync(p) && statSync(p).isDirectory()) hits.push(`${name}/`);
    } catch {
      /* ignore unreadable */
    }
  }
  for (const name of FORBIDDEN_FILES) {
    const p = join(root, name);
    try {
      if (existsSync(p) && statSync(p).isFile()) hits.push(name);
    } catch {
      /* ignore unreadable */
    }
  }
  return hits;
}

export function report(hits) {
  if (!hits.length) {
    return { ok: true, message: "[check-tree] one source tree — src/ only" };
  }
  return {
    ok: false,
    message:
      "[check-tree] dead Council copies at repo root (the app never loads these):\n  " +
      hits.join("\n  ") +
      "\nKeep backend/frontend only in the tabled zip — not next to src/.",
  };
}

function main() {
  const { ok, message } = report(scanTree());
  console[ok ? "log" : "error"](message);
  process.exit(ok ? 0 : 1);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main();
